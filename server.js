const WebSocket = require('ws');
const http = require('http');
const server = http.createServer((req,res)=>{res.writeHead(200);res.end("SpinesMeet WS Running");});
const wss = new WebSocket.Server({ server });
let rooms={};
wss.on('connection',ws=>{
 ws.on('message',raw=>{
  try{
   let d=JSON.parse(raw);
   if(d.type=='join'){
    ws.room=d.room; ws.userId=d.user_id;
    if(!rooms[d.room]) rooms[d.room]=[];
    rooms[d.room]=rooms[d.room].filter(u=>u.id!=d.user_id);
    rooms[d.room].push({id:d.user_id,name:d.name,isHost:d.is_host,ws:ws,wantsToSpeak:0});
    broadcast(d.room);
   }
   if(d.type=='request'){let u=rooms[d.room]?.find(x=>x.id==d.user_id); if(u) u.wantsToSpeak=1; broadcast(d.room);}
   if(d.type=='allow'){rooms[d.room]?.forEach(u=>{if(!u.isHost) u.wantsToSpeak=0}); let t=rooms[d.room]?.find(x=>x.id==d.target_id); if(t){t.wantsToSpeak=2; t.ws.send(JSON.stringify({type:'approved'}));} broadcast(d.room);}
   if(d.type=='signal'){let target=rooms[d.room]?.find(x=>x.id==d.target_id); if(target) target.ws.send(raw.toString());}
   if(d.type=='mute_all'){rooms[d.room]?.forEach(u=>{if(!u.isHost) u.ws.send(JSON.stringify({type:'force_mute'}));});}
  }catch(e){}
 });
 ws.on('close',()=>{if(ws.room&&rooms[ws.room]){rooms[ws.room]=rooms[ws.room].filter(u=>u.ws!==ws); broadcast(ws.room);}});
});
function broadcast(room){if(!rooms[room]) return; let list=rooms[room].map(u=>({id:u.id,name:u.name,isHost:u.isHost,wantsToSpeak:u.wantsToSpeak})); rooms[room].forEach(u=>{try{u.ws.send(JSON.stringify({type:'presence',users:list}))}catch(e){}});}
server.listen(process.env.PORT||10000);
