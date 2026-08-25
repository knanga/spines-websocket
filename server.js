const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Spines WebSocket Server Running ✅\n');
});

const wss = new WebSocket.Server({ server });

let rooms = {}; // room_code => [{id, name, isHost, wantsToSpeak, ws}]

function broadcastPresence(roomCode) {
  if (!rooms[roomCode]) return;
  // Remove dead sockets
  rooms[roomCode] = rooms[roomCode].filter(u => u.ws && u.ws.readyState === 1);

  // DEDUP: remove duplicate by id and name
  let unique = [];
  let seenId = new Set();
  let seenName = new Set();
  rooms[roomCode].forEach(u => {
    let nameKey = (u.name || '').toLowerCase().trim();
    if (seenId.has(u.id)) return;
    if (!u.isHost && nameKey && seenName.has(nameKey)) return;
    seenId.add(u.id);
    if (nameKey) seenName.add(nameKey);
    unique.push(u);
  });
  rooms[roomCode] = unique;

  let usersList = rooms[roomCode].map(u => ({
    id: u.id,
    name: u.name,
    isHost: u.isHost,
    wantsToSpeak: u.wantsToSpeak || 0
  }));

  let payload = JSON.stringify({
    type: 'presence',
    users: usersList
  });

  rooms[roomCode].forEach(u => {
    try {
      if (u.ws.readyState === 1) u.ws.send(payload);
    } catch (e) {}
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

      // JOIN
      if (data.type === 'join') {
        currentId = data.user_id;
        console.log(`JOIN ${room} - ${data.name} ID:${data.user_id} Host:${data.is_host}`);

        // Remove old entry with same ID or same name (fix double entry)
        rooms[room] = rooms[room].filter(u => {
          if (u.id === data.user_id) return false;
          if (!data.is_host &&!u.isHost && u.name && data.name) {
            if (u.name.toLowerCase().trim() === data.name.toLowerCase().trim()) {
              try { u.ws.close(); } catch {}
              return false;
            }
          }
          return true;
        });

        // Add new
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

          // Notify others
          let leaveMsg = JSON.stringify({
            type: 'leave',
            user_id: data.user_id,
            name: data.name || 'User'
          });
          rooms[room].forEach(u => {
            try { if (u.ws.readyState === 1) u.ws.send(leaveMsg); } catch {}
          });
        }
      }

      // REQUEST MIC
      if (data.type === 'request') {
        console.log(`REQUEST ${room} from ${data.name} ID:${data.user_id}`);
        if (rooms[room]) {
          let user = rooms[room].find(u => u.id === data.user_id);
          if (user) user.wantsToSpeak = 1;
          // Notify host
          rooms[room].forEach(u => {
            if (u.isHost) {
              try { u.ws.send(JSON.stringify({ type: 'request', user_id: data.user_id, name: data.name })); } catch {}
            }
          });
          broadcastPresence(room);
        }
      }

      // ALLOW - mtu 1 tu!
      if (data.type === 'allow') {
        console.log(`ALLOW ${room} target:${data.target_id}`);
        if (rooms[room]) {
          let target = rooms[room].find(u => u.id === data.target_id);
          if (target) target.wantsToSpeak = 2;
          // Send ONLY to target
          rooms[room].forEach(u => {
            if (u.id === data.target_id) {
              try { u.ws.send(JSON.stringify({ type: 'approved', target_id: data.target_id })); } catch {}
            }
          });
          broadcastPresence(room);
        }
      }

      // FORCE MUTE - mtu 1 tu
      if (data.type === 'force_mute') {
        console.log(`FORCE MUTE ${room} target:${data.target_id}`);
        if (rooms[room]) {
          let target = rooms[room].find(u => u.id === data.target_id);
          if (target) target.wantsToSpeak = 0;
          rooms[room].forEach(u => {
            if (u.id === data.target_id) {
              try { u.ws.send(JSON.stringify({ type: 'force_mute', target_id: data.target_id })); } catch {}
            }
          });
          broadcastPresence(room);
        }
      }

      // MUTE ALL
      if (data.type === 'mute_all') {
        console.log(`MUTE ALL ${room}`);
        if (rooms[room]) {
          rooms[room].forEach(u => {
            if (!u.isHost) {
              u.wantsToSpeak = 0;
              try { u.ws.send(JSON.stringify({ type: 'mute_all' })); } catch {}
              try { u.ws.send(JSON.stringify({ type: 'force_mute', target_id: u.id })); } catch {}
            }
          });
          broadcastPresence(room);
        }
      }

      // SIGNAL - WebRTC (p2p)
      if (data.type === 'signal') {
        if (rooms[room]) {
          let target = rooms[room].find(u => u.id === data.target_id);
          if (target && target.ws.readyState === 1) {
            try { target.ws.send(JSON.stringify(data)); } catch {}
          } else if (data.target_id === 1) {
            // If target is host but not found by ID 1, find host
            let host = rooms[room].find(u => u.isHost);
            if (host && host.ws.readyState === 1) {
              try { host.ws.send(JSON.stringify(data)); } catch {}
            }
          }
        }
      }

      // SCREEN SIGNAL
      if (data.type === 'screen_signal') {
        if (rooms[room]) {
          let target = rooms[room].find(u => u.id === data.target_id);
          if (target && target.ws.readyState === 1) {
            try { target.ws.send(JSON.stringify(data)); } catch {}
          }
        }
      }

      // EMOJI
      if (data.type === 'emoji') {
        if (rooms[room]) {
          let emojiMsg = JSON.stringify(data);
          rooms[room].forEach(u => {
            try { if (u.ws.readyState === 1) u.ws.send(emojiMsg); } catch {}
          });
        }
      }

      // SCREEN SHARE STATUS
      if (data.type === 'screen_share') {
        if (rooms[room]) {
          let msg = JSON.stringify(data);
          rooms[room].forEach(u => {
            try { if (u.ws.readyState === 1 && u.id!== data.from) u.ws.send(msg); } catch {}
          });
        }
      }

      // END MEETING
      if (data.type === 'end_meeting') {
        console.log(`END MEETING ${room}`);
        if (rooms[room]) {
          let endMsg = JSON.stringify({ type: 'meeting_ended' });
          rooms[room].forEach(u => {
            try { if (u.ws.readyState === 1) u.ws.send(endMsg); } catch {}
          });
          delete rooms[room];
        }
      }

    } catch (e) {
      console.log('Error:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    if (currentRoom && rooms[currentRoom]) {
      // Delay cleanup 3 sec - if user refreshes quickly don't remove
      setTimeout(() => {
        if (rooms[currentRoom]) {
          let before = rooms[currentRoom].length;
          rooms[currentRoom] = rooms[currentRoom].filter(u => u.ws!== ws);
          if (rooms[currentRoom].length!== before) {
            console.log(`Cleaned up ${currentRoom}, ${before} -> ${rooms[currentRoom].length}`);
            broadcastPresence(currentRoom);
          }
        }
      }, 3000);
    }
  });

  ws.on('error', (err) => {
    console.log('WS error', err.message);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
