/**
 * MentorLink — Mentor Client (simplified)
 * No session codes. Auto-connects when student is online.
 */

(function () {
  'use strict';

  const mentorDashboard = document.getElementById('mentorDashboard');
  const videoPlaceholder = document.getElementById('videoPlaceholder');
  const remoteVideo = document.getElementById('remoteVideo');
  const topStatusDot = document.getElementById('topStatusDot');
  const sessionTimer = document.getElementById('sessionTimer');
  const hintsList = document.getElementById('hintsList');
  const hintInput = document.getElementById('hintInput');
  const btnSendHint = document.getElementById('btnSendHint');
  const hintCount = document.getElementById('hintCount');
  const btnDisconnect = document.getElementById('btnDisconnect');
  const studentSelect = document.getElementById('studentSelect');
  const btnViewStudent = document.getElementById('btnViewStudent');
  const connectionStatusText = document.getElementById('connectionStatusText');

  let socket = null;
  let peerConnection = null;
  let sentHintsCount = 0;
  let timerInterval = null;
  let sessionStartTime = null;
  let currentStudentId = null;

  const iceConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:185.170.153.153:3478' },
      {
        urls: 'turn:185.170.153.153:3478',
        username: 'mentorlink',
        credential: 'mentorlink2026'
      }
    ]
  };

  function init() {
    socket = io({ query: { role: 'mentor' } });

    socket.on('connect', () => {
      console.log('[Mentor] Connected to server');
    });

    socket.on('students-update', (list) => {
      const currentSelected = studentSelect.value;
      studentSelect.innerHTML = '<option value="">-- Выберите ученика --</option>';
      let foundCurrent = false;

      list.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `Ученик (IP: ${s.ip})`;
        if (s.id === currentSelected) {
          opt.selected = true;
          foundCurrent = true;
        }
        studentSelect.appendChild(opt);
      });

      if (!foundCurrent && currentSelected) {
        handleStudentDisconnect();
      }

      btnViewStudent.disabled = studentSelect.options.length <= 1;
    });

    btnViewStudent.addEventListener('click', () => {
      const selectedId = studentSelect.value;
      if (!selectedId) return;
      
      if (peerConnection) peerConnection.close();
      peerConnection = null;
      if (remoteVideo.srcObject) remoteVideo.srcObject = null;
      remoteVideo.style.display = 'none';
      videoPlaceholder.style.display = 'flex';
      
      currentStudentId = selectedId;
      btnDisconnect.disabled = false;
      topStatusDot.className = 'status-dot offline';
      connectionStatusText.textContent = 'Запрос подключения...';
      
      socket.emit('mentor-request-view', currentStudentId);
    });

    socket.on('webrtc-offer', async ({ offer, studentId }) => {
      if (studentId !== currentStudentId) return; // ignore offers from others
      console.log('[WebRTC] Received offer from', studentId);
      await handleOffer(offer);
    });

    socket.on('webrtc-ice-candidate', async ({ candidate, studentId }) => {
      if (studentId !== currentStudentId) return;
      if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    socket.on('hint-sent', (hint) => {
      addHintToList(hint);
    });

    socket.on('hint-acknowledged', () => {
      showToast('Студент прочитал подсказку ✓', 'success');
      const bubbles = hintsList.querySelectorAll('.hint-bubble.sent:not(.acknowledged)');
      if (bubbles.length > 0) {
        const last = bubbles[bubbles.length - 1];
        last.classList.add('acknowledged');
        const s = document.createElement('div');
        s.className = 'hint-status';
        s.textContent = '✓ Прочитано';
        last.appendChild(s);
      }
    });

    btnSendHint.addEventListener('click', sendHint);
    hintInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendHint(); });

    btnDisconnect.addEventListener('click', () => {
      if (!currentStudentId) return;
      if (confirm('Завершить сессию текущего студента?')) {
        socket.emit('end-session', currentStudentId);
        setTimeout(() => location.reload(), 300);
      }
    });
  }

  function handleStudentDisconnect() {
    console.log('[Mentor] Current student is offline');
    topStatusDot.className = 'status-dot offline';
    connectionStatusText.textContent = 'Отключён';
    btnDisconnect.disabled = true;
    currentStudentId = null;
    if (remoteVideo.srcObject) remoteVideo.srcObject = null;
    remoteVideo.style.display = 'none';
    videoPlaceholder.style.display = 'flex';
    videoPlaceholder.querySelector('p').textContent = 'Студент отключился...';
  }

  // === WebRTC ===
  async function handleOffer(offer) {
    peerConnection = new RTCPeerConnection(iceConfig);

    peerConnection.ontrack = (event) => {
      console.log('[WebRTC] Remote track received!');
      console.log('[WebRTC] Track kind:', event.track.kind, 'readyState:', event.track.readyState);
      console.log('[WebRTC] Streams:', event.streams.length);
      const stream = event.streams[0];
      remoteVideo.srcObject = stream;
      remoteVideo.style.display = 'block';
      videoPlaceholder.style.display = 'none';
      topStatusDot.className = 'status-dot online';
      remoteVideo.play().then(() => {
        console.log('[WebRTC] Video playing!');
      }).catch(e => {
        console.error('[WebRTC] Play failed:', e);
      });
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && currentStudentId) {
        socket.emit('webrtc-ice-candidate', { candidate: event.candidate, target: currentStudentId });
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE state:', peerConnection.iceConnectionState);
    };

    peerConnection.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state:', peerConnection.connectionState);
      if (peerConnection.connectionState === 'connected') {
        connectionStatusText.textContent = 'Трансляция активна';
        if (!timerInterval) startTimer();
      }
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('webrtc-answer', { answer, target: currentStudentId });
    console.log('[WebRTC] Answer sent');
  }

  // === Hints ===
  function sendHint() {
    if (!currentStudentId) return;
    const text = hintInput.value.trim();
    if (!text) return;
    socket.emit('send-hint', { text, target: currentStudentId });
    hintInput.value = '';
    hintInput.focus();
  }

  function addHintToList(hint) {
    sentHintsCount++;
    hintCount.textContent = `${sentHintsCount} отправлено`;

    const timeStr = new Date(hint.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    const bubble = document.createElement('div');
    bubble.className = 'hint-bubble sent';
    bubble.id = 'mentor-hint-' + hint.id;
    bubble.style.position = 'relative';

    bubble.innerHTML = `
      <div style="padding-right: 20px;">${escapeHtml(hint.text)}</div>
      <div class="hint-time">${timeStr}</div>
      <button class="hint-delete-btn" style="position: absolute; top: 4px; right: 4px; background: none; border: none; color: #ff6b6b; cursor: pointer; font-size: 12px; padding: 2px;">✕</button>
    `;

    bubble.querySelector('.hint-delete-btn').addEventListener('click', () => {
      socket.emit('delete-hint', { id: hint.id, target: currentStudentId });
      bubble.style.animation = 'fadeOut 0.25s ease forwards';
      setTimeout(() => bubble.remove(), 250);
    });

    hintsList.appendChild(bubble);
    hintsList.scrollTop = hintsList.scrollHeight;
  }

  // === Timer ===
  function startTimer() {
    sessionStartTime = Date.now();
    timerInterval = setInterval(() => {
      const elapsed = Date.now() - sessionStartTime;
      const h = String(Math.floor(elapsed / 3600000)).padStart(2, '0');
      const m = String(Math.floor((elapsed % 3600000) / 60000)).padStart(2, '0');
      const s = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');
      sessionTimer.textContent = `${h}:${m}:${s}`;
    }, 1000);
  }

  function escapeHtml(t) {
    const d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'fadeOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  init();
})();
