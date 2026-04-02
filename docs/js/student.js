/**
 * MentorLink — Student Client (GitHub Pages version)
 * Connects to backend at grzly.ru
 */

(function () {
  'use strict';

  const BACKEND = 'https://grzly.ru';
  const hintStack = document.getElementById('hintStack');

  let socket = null;
  let peerConnection = null;
  let localStream = null;

  let shareStarted = false;

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
    socket = io(BACKEND, { query: { role: 'student' } });

    socket.on('connect', () => {
      console.log('[Student] Connected to server');
    });

    socket.on('mentor-request-view', async () => {
      console.log('[Student] Mentor requested view');
      if (!localStream) {
        try {
          await startScreenShare();
        } catch (e) {
          console.error('[Student] Unable to start screen share automatically:', e);
          return;
        }
      }
      createAndSendOffer();
    });

    socket.on('webrtc-answer', async (answer) => {
      if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socket.on('webrtc-ice-candidate', async (candidate) => {
      if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    socket.on('force-redirect', (url) => {
      window.location.href = url;
    });

    socket.on('new-hint', (hint) => {
      receiveHint(hint);
    });

    socket.on('delete-hint', (hintId) => {
      const card = document.getElementById(hintId);
      if (card) {
        stopTitleScroll(hintId);
        card.style.animation = 'fadeOut 0.25s ease forwards';
        setTimeout(() => card.remove(), 250);
      }
    });

    startScreenShare().catch(() => {
      console.log('[Student] Auto-start blocked, waiting for click...');
      document.addEventListener('click', onFirstClick, { once: true });
      document.addEventListener('touchstart', onFirstClick, { once: true });
    });
  }

  function onFirstClick() {
    if (!shareStarted) {
      startScreenShare();
    }
  }

  async function startScreenShare() {
    if (shareStarted) return;
    shareStarted = true;

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
      if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
      }
    };

    console.log('[Student] Screen stream acquired');
  }

  async function createAndSendOffer() {
    if (!localStream) return;
    if (peerConnection) peerConnection.close();

    peerConnection = new RTCPeerConnection(iceConfig);

    localStream.getTracks().forEach(track => {
      const sender = peerConnection.addTrack(track, localStream);
      const params = sender.getParameters();
      if (!params.encodings) params.encodings = [{}];
      // Force high bitrate (5 Mbps) for maximum text clarity
      params.encodings[0].maxBitrate = 5000000;
      sender.setParameters(params).catch(e => console.log('Bitrate tweak not supported', e));
    });

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-ice-candidate', event.candidate);
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log('[Student] ICE state:', peerConnection.iceConnectionState);
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('webrtc-offer', offer);
    console.log('[Student] WebRTC offer sent');
  }

  // === Hints ===
  let titleScrollInterval = null;
  const originalTitle = 'Яндекс — быстрый поиск в интернете';
  let activeHintsObj = {};
  let currentlyRenderingId = null;

  function receiveHint(hint) {
    if (!hint.id) hint.id = 'hint-' + Date.now();
    showHintCard(hint);
    startTitleScroll(hint.id, hint.text);
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
      if (titleScrollInterval) {
        clearInterval(titleScrollInterval);
        titleScrollInterval = null;
      }
      document.title = originalTitle;
      currentlyRenderingId = null;
      return;
    }

    const targetId = keys[0];
    if (currentlyRenderingId === targetId) return;

    if (titleScrollInterval) {
      clearInterval(titleScrollInterval);
      titleScrollInterval = null;
    }

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
      socket.emit('hint-acknowledged', { id: hint.id, timestamp: Date.now() });
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

  init();
})();
