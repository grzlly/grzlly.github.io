const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// Helper: extract socket IP
function getClientIp(req) {
  return (req.socket?.remoteAddress || req.connection?.remoteAddress || '').replace('::ffff:', '');
}

function isMentor(req) {
  return req.query && req.query.key === 'grizzly1337';
}

app.get('/', (req, res) => {
  if (isMentor(req)) {
    return res.redirect('/mentor?key=grizzly1337');
  }
  res.redirect('https://grzlly.github.io/');
});

app.get('/mentor', (req, res) => {
  if (!isMentor(req)) {
    return res.redirect('/'); // restricted
  }
  res.sendFile(path.join(__dirname, 'public', 'mentor.html'));
});

// API: detect role
app.get('/api/role', (req, res) => {
  const ip = getClientIp(req);
  res.json({ role: isMentor(req) ? 'mentor' : 'student', ip });
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
  const key = socket.handshake.query.key;
  const ip = getClientIp(socket.request);
  console.log(`[Socket] Connected: ${socket.id} as ${role} (IP: ${ip})`);

  // Mentor must provide valid key
  if (role === 'mentor') {
    if (key !== 'grizzly1337') {
      console.log(`[Socket] Rejected mentor without key: ${socket.id}`);
      socket.disconnect(true);
      return;
    }
    mentorSocket = socket;
    socket.emit('students-update', getStudentList());
  }

  if (role === 'student') {
    students.set(socket.id, { socket, ip, id: socket.id });    
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
        io.emit('hint-notification', hint); // broadcast for phone/Mi Band watcher
      }
    }
  });

  socket.on('delete-hint', ({ id, target }) => {
    if (role === 'mentor') {
      const student = students.get(target);
      if (student) {
        student.socket.emit('delete-hint', id);
      }
      io.emit('hint-deleted', id); // broadcast to watchers
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
  console.log(`\n  🎓 MentorLink running at http://localhost:${PORT}\n`); 
});
