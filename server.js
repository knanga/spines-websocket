const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Spines WebSocket Server Running ✅ - Different Networks Fixed\n');
});

const wss = new WebSocket.Server({ server });

let rooms = {}; // room_code => [{id, name, isHost, wantsToSpeak, ws}]

function broadcastPresence(roomCode) {
  if (!rooms[roomCode]) return;
  rooms[roomCode] = rooms[roomCode].filter(u => u.ws && u.ws.readyState === 1);

  // DEDUP by ID only - usifukuze watu wa jina sawa
  let unique = [];
  let seenId = new Set();
  rooms[roomCode].forEach(u => {
    if (seenId.has(u.id)) return;
    seenId.add(u.id);
    unique.push(u);
  });
  rooms[roomCode] = unique;

  let usersList = rooms[roomCode].map(u => ({
    id: u.id,
    name: u.name,
    isHost: u.isHost,
    wantsToSpeak: u.wantsToSpeak || 0
  }));

  let payload = JSON.stringify({ type: 'presence', users: usersList });
  rooms[roomCode].forEach(u => {
    try { if (u.ws.readyState === 1) u.ws.send(payload); } catch {}
  });
  console.log(`[${roomCode}] Presence: ${usersList.length} users`);
}

wss.on('connection', (ws) => {
  console.log('New client connected');
  let currentRoom = null;
  let currentId = null;

  ws.on('message', (msg) => {
    try {
      let data = JSON.parse(msg);
      let room = data.room;
      if (!room) return;
      currentRoom = room;
      if (!rooms[room]) rooms[room] = [];

      // PING - keep alive for Render free tier (muhimu!)
      if (data.type === 'ping') {
        try { ws.send(JSON.stringify({ type: 'pong' })); } catch {}
        return;
      }

      // JOIN
      if (data.type === 'join') {
        currentId = data.user_id;
        console.log(`JOIN ${room} - ${data.name} ID:${data.user_id} Host:${data.is_host}`);
        rooms[room] = rooms[room].filter(u => u.id!== data.user_id);
        rooms[room].push({
          id: data.user_id,
          name: data.name || 'User',
          isHost: data.is_host == 1,
          wantsToSpeak: 0,
          ws: ws
        });
        broadcastPresence(room);
      }

      // LEAVE
      if (data.type === 'leave') {
        console.log(`LEAVE ${room} ID:${data.user_id}`);
        if (rooms[room]) {
          rooms[room] = rooms[room].filter(u => u.id!== data.user_id);
          broadcastPresence(room);
        }
      }

      // CHAT - ulisahau hii boss!
      if (data.type === 'chat') {
        if (rooms[room]) {
          let payload = JSON.stringify(data);
          rooms[room].forEach(u => {
            try { if (u.ws.readyState === 1) u.ws.send(payload); } catch {}
          });
        }
      }

      // PRIVATE CHAT - ulisahau hii pia!
      if (data.type === 'private_chat') {
        if (rooms[room]) {
          let target = rooms[room].find(u => u.id === data.to_id || u.id === parseInt(data.to_id));
          if (target && target.ws.readyState === 1) {
            try { target.ws.send(JSON.stringify(data)); } catch {}
          }
          // also send back to sender for confirmation
          let sender = rooms[room].find(u => u.id === data.from_id);
          if (sender && sender.id!== data.to_id) {
            // optional
          }
        }
      }

      // REQUEST MIC - join.php inatuma request_mic
      if (data.type === 'request_mic') {
        console.log(`REQUEST MIC ${room} from ${data.name}`);
        if (rooms[room]) {
          // notify all hosts
          rooms[room].forEach(u => {
            if (u.isHost) {
              try { u.ws.send(JSON.stringify(data)); } catch {}
            }
          });
        }
      }

      // MIC GRANTED
      if (data.type === 'mic_granted') {
        console.log(`MIC GRANTED ${room} to ${data.to_id}`);
        if (rooms[room]) {
          let target = rooms[room].find(u => u.id === data.to_id || u.id === parseInt(data.to_id));
          if (target && target.ws.readyState === 1) {
            try { target.ws.send(JSON.stringify(data)); } catch {}
          }
        }
      }

      // REQUEST (old)
      if (data.type === 'request') {
        if (rooms[room]) {
          let user = rooms[room].find(u => u.id === data.user_id);
          if (user) user.wantsToSpeak = 1;
          rooms[room].forEach(u => {
            if (u.isHost) { try { u.ws.send(JSON.stringify(data)); } catch {} }
          });
          broadcastPresence(room);
        }
      }

      if (data.type === 'allow' || data.type === 'approved') {
        if (rooms[room]) {
          let target = rooms[room].find(u => u.id === data.target_id);
          if (target) target.wantsToSpeak = 2;
          rooms[room].forEach(u => {
            if (u.id === data.target_id) { try { u.ws.send(JSON.stringify(data)); } catch {} }
          });
          broadcastPresence(room);
        }
      }

      if (data.type === 'force_mute') {
        if (rooms[room]) {
          let target = rooms[room].find(u => u.id === data.target_id);
          if (target) target.wantsToSpeak = 0;
          rooms[room].forEach(u => {
            if (u.id === data.target_id) { try { u.ws.send(JSON.stringify(data)); } catch {} }
          });
          broadcastPresence(room);
        }
      }

      if (data.type === 'mute_all') {
        if (rooms[room]) {
          rooms[room].forEach(u => {
            if (!u.isHost) {
              u.wantsToSpeak = 0;
              try { u.ws.send(JSON.stringify(data)); } catch {}
            }
          });
          broadcastPresence(room);
        }
      }

      // SIGNAL - WebRTC (muhimu kwa different networks)
      if (data.type === 'signal') {
        if (rooms[room]) {
          let target = rooms[room].find(u => u.id === data.target_id || u.id === parseInt(data.target_id));
          if (target && target.ws && target.ws.readyState === 1) {
            try { target.ws.send(JSON.stringify(data)); } catch {}
          } else {
            // fallback: broadcast to all except sender if target not found
            rooms[room].forEach(u => {
              if (u.id!== data.from && u.ws.readyState === 1) {
                try { u.ws.send(JSON.stringify(data)); } catch {}
              }
            });
          }
        }
      }

      if (data.type === 'screen_signal' || data.type === 'screen_share' || data.type === 'emoji') {
        if (rooms[room]) {
          let msg = JSON.stringify(data);
          rooms[room].forEach(u => {
            try { if (u.ws.readyState === 1 && u.id!== data.from) u.ws.send(msg); } catch {}
          });
        }
      }

      if (data.type === 'end_meeting') {
        console.log(`END MEETING ${room}`);
        if (rooms[room]) {
          let endMsg = JSON.stringify({ type: 'meeting_ended' });
          rooms[room].forEach(u => { try { if (u.ws.readyState === 1) u.ws.send(endMsg); } catch {} });
          delete rooms[room];
        }
      }

    } catch (e) { console.log('Error:', e.message); }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    if (currentRoom && rooms[currentRoom]) {
      setTimeout(() => {
        if (rooms[currentRoom]) {
          let before = rooms[currentRoom].length;
          rooms[currentRoom] = rooms[currentRoom].filter(u => u.ws!== ws);
          if (rooms[currentRoom].length!== before) {
            console.log(`Cleaned up ${currentRoom}, ${before} -> ${rooms[currentRoom].length}`);
            broadcastPresence(currentRoom);
          }
        }
      }, 2000);
    }
  });

  ws.on('error', (err) => { console.log('WS error', err.message); });
});

server.listen(PORT, () => { console.log(`✅ Server running on port ${PORT}`); });
