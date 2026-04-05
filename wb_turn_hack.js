const https = require('https');
const WebSocket = require('ws'); // Requires 'ws' to be installed

function wbRequest(method, path, body, token) {
    return new Promise((resolve, reject) => {
        const bodyStr = body ? JSON.stringify(body) : '';
        const req = https.request({
            hostname: 'stream.wb.ru',
            port: 443,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr),
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                ...(token ? {'Authorization': 'Bearer ' + token} : {})
            }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

async function getWBIceServers() {
    try {
        console.log('[WB Hack] Registering guest...');
        const reg = await wbRequest('POST', '/auth/api/v1/auth/user/guest-register', {displayName: "lh_42"});
        const token = reg.accessToken;
        
        console.log('[WB Hack] Creating room...');
        const room = await wbRequest('POST', '/api-room/api/v2/room', {
            roomType: "ROOM_TYPE_ALL_ON_SCREEN",
            roomPrivacy: "ROOM_PRIVACY_FREE"
        }, token);
        const roomId = room.roomId;
        
        console.log('[WB Hack] Joining room...');
        await wbRequest('POST', `/api-room/api/v1/room/${roomId}/join`, {}, token);
        
        console.log('[WB Hack] Getting LiveKit token...');
        const roomTokenRes = await wbRequest('GET', `/api-room-manager/api/v1/room/${roomId}/token?deviceType=PARTICIPANT_DEVICE_TYPE_WEB_DESKTOP&displayName=lh_42`, null, token);
        const livekitToken = roomTokenRes.roomToken;
        
        console.log('[WB Hack] Connecting WebSocket to extract TURN...');
        return new Promise((resolve) => {
            const ws = new WebSocket(`wss://wbstream01-el.wb.ru:7880/rtc?access_token=${livekitToken}&auto_subscribe=1&sdk=js&version=2.15.3&protocol=16&adaptive_stream=1`);
            ws.on('message', (buffer) => {
                const str = buffer.toString('binary');
                if (str.includes('turn:wb-stream')) {
                    const turnMatch = str.match(/(turn:wb-stream-turn-[^:]+:\d+)/);
                    if (turnMatch) {
                        const urls = [turnMatch[1]];
                        const pieces = str.split(/(turn:wb-stream-turn-[^:]+:\d+)/);
                        const afterTurn = pieces[pieces.length - 1];
                        const words = afterTurn.match(/[a-zA-Z0-9]{15,40}/g);
                        if (words && words.length >= 2) {
                            ws.close();
                            resolve({ urls, username: words[0], credential: words[1] });
                        }
                    }
                }
            });
            ws.on('error', () => resolve(null));
        });
    } catch(e) {
        console.error(e);
        return null;
    }
}

getWBIceServers().then(console.log);
