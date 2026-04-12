/**
 * MentorLink — Mentor Client (Firebase, auto-connect)
 */

(function () {
  'use strict';

  const videoPlaceholder = document.getElementById('videoPlaceholder');
  const remoteVideo = document.getElementById('remoteVideo');
  const topStatusDot = document.getElementById('topStatusDot');
  const sessionTimer = document.getElementById('sessionTimer');
  const hintsList = document.getElementById('hintsList');
  const hintInput = document.getElementById('hintInput');
  const btnSendHint = document.getElementById('btnSendHint');
  const hintCount = document.getElementById('hintCount');
  const btnDisconnect = document.getElementById('btnDisconnect');
  const connectionStatusText = document.getElementById('connectionStatusText');

  // Hide student select UI if present
  const studentSelect = document.getElementById('studentSelect');
  const btnViewStudent = document.getElementById('btnViewStudent');
  if (studentSelect) studentSelect.parentElement.style.display = 'none';
  if (btnViewStudent) btnViewStudent.style.display = 'none';

  let peerConnection = null;
  let pendingCandidates = [];
  let sentHintsCount = 0;
  let timerInterval = null;
  let sessionStartTime = null;
  let currentStudentId = null;
  let connectAttempts = 0;
  let retryTimeout = null;
  let isConnecting = false;
  const mentorId = 'mentor_' + Math.random().toString(36).substr(2, 9);

  const iceConfig = {
    iceServers: [
      {
        urls: [
          'turn:wb-stream-turn-1.wb.ru:3478',
          'turn:wb-stream-turn-1.wb.ru:3478?transport=tcp'
        ],
        username: 'eeaMmFicg5GYwVhscg2R',
        credential: 'xtj4wgmXKcfu1Y6ulhg8'
      },
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      {
        urls: 'turn:185.170.153.153:3478',
        username: 'mentorlink',
        credential: 'mentorlink2026'
      }
    ],
    iceCandidatePoolSize: 5
  };

  // Firebase Init
  const firebaseConfig = {
    apiKey: "AIzaSyBmssIL_Njtw_YSKu0xqYqCjKT-9FZTx28",
    projectId: "mentorlink-school",
    databaseURL: "https://mentorlink-school-default-rtdb.europe-west1.firebasedatabase.app",
    authDomain: "mentorlink-school.firebaseapp.com",
    storageBucket: "mentorlink-school.firebasestorage.app",
    messagingSenderId: "566701278681",
    appId: "1:566701278681:web:f7be1fa2d1eab3d9f445c8",
  };

  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const db = firebase.database();

  function init() {
    console.log('[Mentor] Connected to Firebase, mentor ID:', mentorId);
    connectionStatusText.textContent = 'Ожидание студента...';

    // Listen on our PRIVATE inbox
    db.ref('messages/to_mentor/' + mentorId).on('child_added', async (snapshot) => {
      const msg = snapshot.val();
      snapshot.ref.remove();
      if (!msg || !msg.type) return;

      if (msg.type === 'webrtc-offer') {
        console.log('[WebRTC] Received offer from', msg.studentId);
        await handleOffer(msg.data);
      }
      else if (msg.type === 'webrtc-ice-candidate') {
        if (peerConnection && peerConnection.remoteDescription) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(msg.data)).catch(console.error);
        } else {
          pendingCandidates.push(msg.data);
        }
      }
      else if (msg.type === 'share-error') {
        connectionStatusText.textContent = 'Ошибка: ' + msg.data;
        topStatusDot.className = 'status-dot offline';
        scheduleRetry(3000);
      }
      else if (msg.type === 'hint-acknowledged') {
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
      }
    });

    // Watch for students — auto-connect to first one
    let disconnectGrace = null;
    db.ref('students').on('value', (snapshot) => {
      const list = snapshot.val() || {};
      const onlineStudents = Object.keys(list).filter(id => list[id].isOnline);

      if (onlineStudents.length > 0) {
        // Cancel any pending disconnect
        if (disconnectGrace) { clearTimeout(disconnectGrace); disconnectGrace = null; }

        const studentId = onlineStudents[0];

        // Already connecting or connected — don't interrupt
        if (currentStudentId === studentId && (isConnecting || 
            (peerConnection && (peerConnection.connectionState === 'connected' || 
             peerConnection.connectionState === 'connecting')))) {
          return;
        }

        // New student or need fresh connection
        if (currentStudentId !== studentId) {
          connectAttempts = 0;
          isConnecting = false;
        }
        currentStudentId = studentId;
        if (!isConnecting) requestView();
      } else {
        // Grace period — wait 3s before declaring student offline
        // (handles Firebase presence flicker)
        if (!disconnectGrace && currentStudentId) {
          disconnectGrace = setTimeout(() => {
            disconnectGrace = null;
            // Re-check if student is still offline
            db.ref('students').once('value', (snap) => {
              const l = snap.val() || {};
              const still = Object.keys(l).filter(id => l[id].isOnline);
              if (still.length === 0) {
                handleStudentDisconnect();
                connectionStatusText.textContent = 'Ожидание студента...';
                videoPlaceholder.querySelector('p').textContent = 'Студент не в сети...';
              }
            });
          }, 3000);
        }
      }
    });

    btnSendHint.addEventListener('click', sendHint);
    hintInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendHint(); });

    btnDisconnect.addEventListener('click', () => {
      if (!currentStudentId) return;
      db.ref('messages/to_student/' + currentStudentId).push({
        type: 'force-redirect',
        data: 'https://ya.ru/',
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });
      handleStudentDisconnect();
      connectionStatusText.textContent = 'Ожидание студента...';
      videoPlaceholder.querySelector('p').textContent = 'Ожидание подключения студента...';
    });
  }

  function requestView() {
    if (!currentStudentId) return;
    isConnecting = true;

    connectAttempts++;
    console.log('[Mentor] Requesting view from', currentStudentId, '(attempt ' + connectAttempts + ')');

    if (peerConnection) peerConnection.close();
    peerConnection = null;
    pendingCandidates = [];
    if (remoteVideo.srcObject) remoteVideo.srcObject = null;
    remoteVideo.style.display = 'none';
    videoPlaceholder.style.display = 'flex';
    videoPlaceholder.querySelector('p').textContent = 'Подключение к студенту...';

    btnDisconnect.disabled = false;
    topStatusDot.className = 'status-dot offline';
    connectionStatusText.textContent = 'Подключение... (попытка ' + connectAttempts + ')';

    db.ref('messages/to_student/' + currentStudentId).push({
      type: 'mentor-request-view',
      mentorId: mentorId,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    });

    // Auto-retry if no connection in 8 seconds
    scheduleRetry(8000);
  }

  function scheduleRetry(ms) {
    if (retryTimeout) clearTimeout(retryTimeout);
    retryTimeout = setTimeout(() => {
      if (currentStudentId && (!peerConnection || peerConnection.connectionState !== 'connected')) {
        console.log('[Mentor] Connection timeout, retrying...');
        requestView();
      }
    }, ms);
  }

  function handleStudentDisconnect() {
    console.log('[Mentor] Student disconnected');
    if (retryTimeout) clearTimeout(retryTimeout);
    topStatusDot.className = 'status-dot offline';
    connectionStatusText.textContent = 'Отключён';
    btnDisconnect.disabled = true;
    currentStudentId = null;
    connectAttempts = 0;
    isConnecting = false;
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (remoteVideo.srcObject) remoteVideo.srcObject = null;
    remoteVideo.style.display = 'none';
    videoPlaceholder.style.display = 'flex';
    videoPlaceholder.querySelector('p').textContent = 'Студент отключился...';
  }

  // === WebRTC ===
  async function handleOffer(offer) {
    if (retryTimeout) clearTimeout(retryTimeout);
    isConnecting = false;

    peerConnection = new RTCPeerConnection(iceConfig);

    peerConnection.ontrack = (event) => {
      console.log('[WebRTC] Remote track received!');
      const stream = event.streams[0];
      remoteVideo.srcObject = stream;
      remoteVideo.style.display = 'block';
      videoPlaceholder.style.display = 'none';
      topStatusDot.className = 'status-dot online';
      remoteVideo.play().catch(e => console.error('[WebRTC] Play failed:', e));
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && currentStudentId) {
        db.ref('messages/to_student/' + currentStudentId).push({
          type: 'webrtc-ice-candidate',
          data: {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex
          },
          timestamp: firebase.database.ServerValue.TIMESTAMP
        });
      }
    };

    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      console.log('[WebRTC] Connection state:', state);
      if (state === 'connected') {
        if (retryTimeout) clearTimeout(retryTimeout);
        connectAttempts = 0;
        topStatusDot.className = 'status-dot online';
        if (!timerInterval) startTimer();
        // Detect connection type
        detectConnectionType();
      } else if (state === 'disconnected' || state === 'failed') {
        connectionStatusText.textContent = 'Соединение потеряно, переподключение...';
        topStatusDot.className = 'status-dot offline';
        scheduleRetry(3000);
      }
    };

    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      for (const c of pendingCandidates) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(c)).catch(console.error);
      }
      pendingCandidates = [];
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      db.ref('messages/to_student/' + currentStudentId).push({
        type: 'webrtc-answer',
        data: { type: answer.type, sdp: answer.sdp },
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });
      console.log('[WebRTC] Answer sent');
    } catch (e) {
      console.error('[WebRTC] handleOffer error:', e);
      scheduleRetry(3000);
    }
  }

  async function detectConnectionType() {
    if (!peerConnection) return;
    try {
      const stats = await peerConnection.getStats();
      let activePairId = null;
      let candidateType = 'unknown';
      let relayServer = '';
      let protocol = '';

      // Find active candidate pair via transport
      stats.forEach(report => {
        if (report.type === 'transport' && report.selectedCandidatePairId) {
          activePairId = report.selectedCandidatePairId;
        }
      });

      // Fallback: find succeeded/in-use candidate pair
      if (!activePairId) {
        stats.forEach(report => {
          if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.nominated)) {
            activePairId = report.id;
          }
        });
      }

      if (activePairId) {
        const pair = stats.get(activePairId);
        if (pair && pair.localCandidateId) {
          const local = stats.get(pair.localCandidateId);
          if (local) {
            candidateType = local.candidateType || 'unknown';
            protocol = local.protocol || '';
            if (local.relayProtocol) protocol = local.relayProtocol;
            if (local.url) relayServer = local.url;
          }
        }
      }

      let label = '';
      if (candidateType === 'relay') {
        const server = relayServer.replace(/^turns?:/, '').split(':')[0].split('?')[0];
        label = '🔄 TURN (' + (server || 'relay') + ', ' + protocol + ')';
      } else if (candidateType === 'srflx') {
        label = '⚡ STUN (P2P)';
      } else if (candidateType === 'host') {
        label = '🏠 Direct (LAN)';
      } else if (candidateType === 'prflx') {
        label = '⚡ P2P (peer-reflexive)';
      } else {
        label = '🔗 ' + candidateType;
      }

      connectionStatusText.textContent = 'Трансляция — ' + label;
      console.log('[WebRTC] Connected via:', candidateType, relayServer, protocol);
    } catch (e) {
      connectionStatusText.textContent = 'Трансляция активна';
    }
  }

  // === Hints ===
  function sendHint() {
    if (!currentStudentId) return;
    const text = hintInput.value.trim();
    if (!text) return;

    const hint = { text: text, timestamp: Date.now(), id: 'hint-' + Date.now() };

    db.ref('messages/to_student/' + currentStudentId).push({
      type: 'new-hint',
      data: hint,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    });

    addHintToList(hint);
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
      db.ref('messages/to_student/' + currentStudentId).push({
        type: 'delete-hint',
        data: hint.id,
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });
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
