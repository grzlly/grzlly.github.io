const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const MENTOR_IP = '185.170.153.88';

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));


// Helper: extract real client IPs safely
function getClientIps(req) {
  const ips = [];
  if (req.ip) ips.push(req.ip.replace('::ffff:', ''));
  
  if (req.headers) {
    if (req.headers['x-forwarded-for']) {
      req.headers['x-forwarded-for'].split(',').forEach(i => ips.push(i.trim().replace('::ffff:', '')));
    }
    if (req.headers['x-real-ip']) {
      ips.push(req.headers['x-real-ip'].replace('::ffff:', ''));
    }
  }
  
  const sockIp = (req.socket?.remoteAddress || req.connection?.remoteAddress || '').replace('::ffff:', '');
  if (sockIp) ips.push(sockIp);
  
  return ips;
}

function isMentorIp(req) {
  // Secret token fallback bypass due to server SNAT destroying real IP
  if (req.query && req.query.key === 'grizzly1337') {
    return true;
  }

  const ips = getClientIps(req);
  
  // Nginx always connects to Node via 127.0.0.1 (or the VPS IP itself).
  // The actual user's IP is ALWAYS the first IP in the chain, received from X-Forwarded-For.
  const realIp = ips.length > 0 ? ips[0] : '';
  
  return realIp === MENTOR_IP;
}

app.get('/', (req, res) => {
  if (isMentorIp(req)) {
    return res.redirect('/mentor');
  }
  res.sendFile(path.join(__dirname, 'public', 'student.html'));
});

app.get('/mentor', (req, res) => {
  if (!isMentorIp(req)) {
    return res.redirect('/'); // restricted
  }
  res.sendFile(path.join(__dirname, 'public', 'mentor.html'));
});

// API: detect role by IP
app.get('/api/role', (req, res) => {
  const ips = getClientIps(req);
  res.json({ role: isMentorIp(req) ? 'mentor' : 'student', ips });
});

// === Multi-session state ===
let mentorSocket = null;
const students = new Map(); // socket.id -> { socket, ip, id }

function getStudentList() {
  return Array.from(students.values()).map(s => ({ id: s.id, ip: s.ip }));
}

// === Socket.IO ===
io.on('connection', (socket) => {
  const role = socket.handshake.query.role;
  const ips = getClientIps(socket.request);
  const displayIp = ips.length > 0 ? ips[0] : 'Unknown';
  console.log(`[Socket] Connected: ${socket.id} as ${role} (IPs: ${ips.join(', ')})`);

  if (role === 'mentor') {
    mentorSocket = socket;
    socket.emit('students-update', getStudentList());
  }

  if (role === 'student') {
    students.set(socket.id, { socket, ip: displayIp, id: socket.id });
    if (mentorSocket && mentorSocket.connected) {
      mentorSocket.emit('students-update', getStudentList());
    }
  }

  // === WebRTC Signaling ===
  socket.on('mentor-request-view', (studentId) => {
    if (role === 'mentor') {
      const student = students.get(studentId);
      if (student) student.socket.emit('mentor-request-view');
    }
  });

  socket.on('webrtc-offer', (offer) => {
    if (role === 'student' && mentorSocket && mentorSocket.connected) {
      mentorSocket.emit('webrtc-offer', { offer, studentId: socket.id });
    }
  });

  socket.on('webrtc-answer', ({ answer, target }) => {
    if (role === 'mentor') {
      const student = students.get(target);
      if (student) student.socket.emit('webrtc-answer', answer);
    }
  });

  socket.on('webrtc-ice-candidate', (data) => {
    if (role === 'student' && mentorSocket && mentorSocket.connected) {
      mentorSocket.emit('webrtc-ice-candidate', { candidate: data, studentId: socket.id });
    } else if (role === 'mentor') {
      const student = students.get(data.target);
      if (student) student.socket.emit('webrtc-ice-candidate', data.candidate);
    }
  });

  // === Hints ===
  socket.on('send-hint', (data) => {
    if (role === 'mentor') {
      const student = students.get(data.target);
      if (student) {
        const hint = { id: 'hint-' + Date.now() + '-' + Math.floor(Math.random() * 1000), text: data.text, type: 'info', timestamp: Date.now() };
        student.socket.emit('new-hint', hint);
        socket.emit('hint-sent', hint); // purely for mentor UI log
      }
    }
  });

  socket.on('delete-hint', ({ id, target }) => {
    if (role === 'mentor') {
      const student = students.get(target);
      if (student) {
        student.socket.emit('delete-hint', id);
      }
    }
  });

  socket.on('hint-acknowledged', (data) => {
    if (role === 'student' && mentorSocket && mentorSocket.connected) {
      mentorSocket.emit('hint-acknowledged', data);
    }
  });

  socket.on('end-session', (target) => {
    if (role === 'mentor') {
      const student = students.get(target);
      if (student) {
        student.socket.emit('force-redirect', 'https://ya.ru/');
      }
    }
  });

  // === Disconnect ===
  socket.on('disconnect', () => {
    console.log(`[Socket] Disconnected: ${socket.id} (${role})`);
    if (role === 'mentor') {
      mentorSocket = null;
    }
    if (role === 'student') {
      students.delete(socket.id);
      if (mentorSocket && mentorSocket.connected) {
        mentorSocket.emit('students-update', getStudentList());
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  ЁЯОУ MentorLink running at http://localhost:${PORT}\n`);
});
