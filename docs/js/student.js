/**
 * MentorLink — Student Client (Firebase version)
 */

(function () {
  'use strict';

  const hintStack = document.getElementById('hintStack');

  let peerConnection = null;
  let localStream = null;
  let shareStarted = false;
  let pendingCandidates = [];
  let currentMentorId = null;

  const iceConfig = {
    iceTransportPolicy: 'relay',
    iceServers: [
      {
        urls: [
          'turn:wb-stream-turn-1.wb.ru:3478',
          'turn:wb-stream-turn-1.wb.ru:3478?transport=tcp'
        ],
        username: 'eeaMmFicg5GYwVhscg2R',
        credential: 'xtj4wgmXKcfu1Y6ulhg8'
      }
    ]
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

  // Generate permanent Student ID
  let studentId = localStorage.getItem('ml_student_id');
  if (!studentId) {
    studentId = 'student_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('ml_student_id', studentId);
  }

  // Set online presence
  const presenceRef = db.ref('students/' + studentId);
  presenceRef.set({ isOnline: true, lastSeen: firebase.database.ServerValue.TIMESTAMP });
  presenceRef.onDisconnect().remove();

  console.log('[Student] Connected to Firebase as', studentId);

  // Listen for commands from Mentor
  const myInboxRef = db.ref('messages/to_student/' + studentId);
  myInboxRef.on('child_added', async (snapshot) => {
    const msg = snapshot.val();
    snapshot.ref.remove();

    if (!msg || !msg.type) return;

    if (msg.type === 'mentor-request-view') {
      // Debounce: ignore rapid repeated requests (within 5 sec)
      const now = Date.now();
      if (window._lastRequestTime && (now - window._lastRequestTime) < 5000) {
        console.log('[Student] Ignoring duplicate request (debounce)');
        return;
      }
      window._lastRequestTime = now;

      console.log('[Student] Mentor requested view');
      currentMentorId = msg.mentorId || null;
      if (!localStream) {
        try { await startScreenShare(); }
        catch (e) {
          console.error('[Student] Screen share blocked:', e);
          sendToMentor('share-error', 'Нет доступа к экрану или пользователь отменил выбор.');
          return;
        }
      }
      createAndSendOffer();
    }
    else if (msg.type === 'webrtc-answer') {
      if (peerConnection && peerConnection.signalingState === 'have-local-offer') {
        try {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.data));
          for (const c of pendingCandidates) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(c)).catch(console.error);
          }
          pendingCandidates = [];
        } catch (e) {
          console.warn('[Student] Stale answer ignored:', e.message);
        }
      }
    }
    else if (msg.type === 'webrtc-ice-candidate') {
      if (peerConnection && peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(msg.data)).catch(console.error);
      } else {
        pendingCandidates.push(msg.data);
      }
    }
    else if (msg.type === 'force-redirect') {
      window.location.href = msg.data;
    }
    else if (msg.type === 'new-hint') {
      receiveHint(msg.data);
    }
    else if (msg.type === 'delete-hint') {
      const card = document.getElementById(msg.data);
      if (card) {
        stopTitleScroll(msg.data);
        card.style.animation = 'fadeOut 0.25s ease forwards';
        setTimeout(() => card.remove(), 250);
      }
    }
  });

  // Auto start helper
  function onFirstClick() {
    if (!shareStarted) startScreenShare();
  }

  startScreenShare().catch(() => {
    console.log('[Student] Auto-start blocked, waiting for click...');
    document.addEventListener('click', onFirstClick, { once: true });
    document.addEventListener('touchstart', onFirstClick, { once: true });
  });

  function sendToMentor(type, data) {
    const path = currentMentorId
      ? 'messages/to_mentor/' + currentMentorId
      : 'messages/to_mentor';
    db.ref(path).push({
      studentId: studentId,
      type: type,
      data: data,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    });
  }

  async function startScreenShare() {
    if (shareStarted) return;
    shareStarted = true;

    try {
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: 'monitor',
          width: { ideal: 1920, max: 2560 },
          height: { ideal: 1080, max: 1440 },
          frameRate: { ideal: 30, max: 60 }
        },
        audio: false
      });

      localStream.getVideoTracks()[0].onended = () => {
        localStream = null;
        shareStarted = false;
        if (peerConnection) { peerConnection.close(); peerConnection = null; }
      };
      console.log('[Student] Screen stream acquired');
    } catch (e) {
      shareStarted = false;
      sendToMentor('share-error', 'Нет доступа к экрану или пользователь отменил выбор.');
      throw e;
    }
  }

  async function createAndSendOffer() {
    if (!localStream) return;
    if (peerConnection) peerConnection.close();

    peerConnection = new RTCPeerConnection(iceConfig);

    localStream.getTracks().forEach(track => {
      const sender = peerConnection.addTrack(track, localStream);
      const params = sender.getParameters();
      if (!params.encodings) params.encodings = [{}];
      params.encodings[0].maxBitrate = 5000000;
      sender.setParameters(params).catch(e => console.log('Bitrate tweak not supported', e));
    });

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        sendToMentor('webrtc-ice-candidate', {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex
        });
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log('[Student] ICE state:', peerConnection.iceConnectionState);
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendToMentor('webrtc-offer', { type: offer.type, sdp: offer.sdp });
    console.log('[Student] WebRTC offer sent');
  }

  // === Hints UI ===
  let titleScrollInterval = null;
  const originalTitle = 'Яндекс — быстрый поиск в интернете';
  let activeHintsObj = {};
  let currentlyRenderingId = null;

  function receiveHint(hint) {
    if (!hint.id) hint.id = 'hint-' + Date.now();
    showHintCard(hint);
    startTitleScroll(hint.id, hint.text);

    // Also push to Android app through Firebase (MentorService will read it)
    db.ref('messages/to_android').push({
      type: 'new-hint',
      data: hint
    });
  }

  function startTitleScroll(id, text) {
    activeHintsObj[id] = text;
    renderTitle();
  }

  function stopTitleScroll(id) {
    delete activeHintsObj[id];
    renderTitle();
  }

  function renderTitle() {
    const keys = Object.keys(activeHintsObj);
    if (keys.length === 0) {
      if (titleScrollInterval) { clearInterval(titleScrollInterval); titleScrollInterval = null; }
      document.title = originalTitle;
      currentlyRenderingId = null;
      return;
    }
    const targetId = keys[0];
    if (currentlyRenderingId === targetId) return;
    if (titleScrollInterval) { clearInterval(titleScrollInterval); titleScrollInterval = null; }

    currentlyRenderingId = targetId;
    const activeHintText = activeHintsObj[targetId];

    if (activeHintText.length <= 25) {
      document.title = activeHintText;
    } else {
      let scrollText = `${activeHintText}       `;
      document.title = scrollText;
      titleScrollInterval = setInterval(() => {
        const arr = Array.from(scrollText);
        arr.push(arr.shift());
        scrollText = arr.join('');
        document.title = scrollText;
      }, 600);
    }
  }

  function showHintCard(hint) {
    const card = document.createElement('div');
    card.className = 'hint-expanded small-hint';
    card.style.cssText = 'position: relative; padding: 12px 32px 12px 16px; border-radius: 8px; width: fit-content; max-width: 300px; min-width: 150px; background: rgba(30,30,30,0.9); backdrop-filter: blur(10px); box-shadow: 0 4px 15px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); margin-top: 10px; margin-right: auto; display: flex; align-items: center; min-height: 48px; box-sizing: border-box;';
    card.id = hint.id;

    card.innerHTML = `
      <div style="font-size: 0.95rem; color: #fff; word-break: break-word; line-height: 1.4; flex-grow: 1;">
        ${escapeHtml(hint.text)}
      </div>
      <button class="hint-close-btn" style="position: absolute; top: 50%; right: 8px; transform: translateY(-50%); background: none; border: none; color: #888; cursor: pointer; font-size: 16px; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; padding: 0; outline: none; transition: color 0.2s;">✕</button>
    `;

    card.querySelector('.hint-close-btn').addEventListener('click', () => {
      // Send ack back to mentor
      sendToMentor('hint-acknowledged', { id: hint.id });

      // Send delete signal to Android
      db.ref('messages/to_android').push({ type: 'delete-hint', data: hint.id });

      stopTitleScroll(hint.id);
      card.style.animation = 'fadeOut 0.25s ease forwards';
      setTimeout(() => card.remove(), 250);
    });

    hintStack.appendChild(card);
  }

  function escapeHtml(t) {
    const d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
  }

})();
