// server.js - FIX allow na mute_all
if(data.type==='allow'){
  // Find user and mark as LIVE (2)
  if(rooms[data.room]){
    let user = rooms[data.room].find(u=>u.id===data.target_id);
    if(user) user.wantsToSpeak = 2;
  }
  // Send ONLY to target, not broadcast
  if(rooms[data.room]){
    rooms[data.room].forEach(u=>{
      if(u.id===data.target_id){
        try{ u.ws.send(JSON.stringify({type:'approved', target_id:data.target_id})); }catch{}
      }
    });
  }
  broadcastPresence(data.room);
}

if(data.type==='force_mute'){
  if(rooms[data.room]){
    let user = rooms[data.room].find(u=>u.id===data.target_id);
    if(user) user.wantsToSpeak = 0;
    rooms[data.room].forEach(u=>{
      if(u.id===data.target_id){
        try{ u.ws.send(JSON.stringify({type:'force_mute', target_id:data.target_id})); }catch{}
      }
    });
  }
  broadcastPresence(data.room);
}

if(data.type==='mute_all'){
  if(rooms[data.room]){
    rooms[data.room].forEach(u=>{
      if(!u.isHost){
        u.wantsToSpeak = 0;
        try{ u.ws.send(JSON.stringify({type:'mute_all'})); }catch{}
        try{ u.ws.send(JSON.stringify({type:'force_mute', target_id:u.id})); }catch{}
      }
    });
  }
  broadcastPresence(data.room);
}

if(data.type==='request'){
  if(rooms[data.room]){
    let user = rooms[data.room].find(u=>u.id===data.user_id);
    if(user) user.wantsToSpeak = 1;
  }
  // Notify host
  if(rooms[data.room]){
    rooms[data.room].forEach(u=>{
      if(u.isHost){
        try{ u.ws.send(JSON.stringify({type:'request', user_id:data.user_id, name:data.name})); }catch{}
      }
    });
  }
  broadcastPresence(data.room);
}
