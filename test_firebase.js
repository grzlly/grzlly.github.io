const firebase = require('firebase/app');
require('firebase/database');

const firebaseConfig = {
  apiKey: "AIzaSyBmssIL_Njtw_YSKu0xqYqCjKT-9FZTx28",
  projectId: "mentorlink-school",
  databaseURL: "https://mentorlink-school-default-rtdb.europe-west1.firebasedatabase.app",
  authDomain: "mentorlink-school.firebaseapp.com",
  storageBucket: "mentorlink-school.firebasestorage.app",
  messagingSenderId: "566701278681",
  appId: "1:566701278681:web:f7be1fa2d1eab3d9f445c8",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

async function test() {
  console.log('Testing Firebase RTDB access...');
  try {
    const ref = db.ref('messages/test');
    await ref.set({ time: Date.now() });
    console.log('WRITE: Success!');
    
    const snapshot = await ref.once('value');
    console.log('READ: Success! Value:', snapshot.val());
  } catch (e) {
    console.error('ERROR:', e.message);
  }
  process.exit(0);
}

test();
