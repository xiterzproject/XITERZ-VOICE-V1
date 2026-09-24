const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "..", "client");
const rooms = new Map();

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function broadcast(room, data, except) {
  for (const client of room.members.values()) {
    if (client.ws !== except) send(client.ws, data);
  }
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403); return res.end("Forbidden");
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404); return res.end("Not found");
    }
    const ext = path.extname(file);
    const types = {".html":"text/html",".css":"text/css",".js":"text/javascript"};
    res.writeHead(200, {"Content-Type": types[ext] || "application/octet-stream"});
    res.end(data);
  });
});

const wss = new WebSocket.Server({server});

function leave(ws) {
  const roomCode = ws.room;
  if (!roomCode || !rooms.has(roomCode)) return;
  const room = rooms.get(roomCode);
  room.members.delete(ws.id);
  broadcast(room, {type:"member-left", id:ws.id});
  if (room.members.size === 0) rooms.delete(roomCode);
  ws.room = null;
}

wss.on("connection", ws => {
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "join") {
      leave(ws);
      const roomCode = String(msg.room || "").toUpperCase();
      const name = String(msg.name || "Guest").slice(0,20);
      if (!roomCode) return send(ws, {type:"error", message:"Room tidak valid."});

      if (!rooms.has(roomCode)) rooms.set(roomCode, {members:new Map()});
      const room = rooms.get(roomCode);

      if (room.members.size >= 10)
        return send(ws, {type:"error", message:"Room sudah penuh (maks. 10 orang)."});

      ws.id = Math.random().toString(36).slice(2,10);
      ws.room = roomCode;
      ws.name = name;
      ws.muted = false;

      const members = [...room.members.values()].map(m => ({
        id:m.id, name:m.name, muted:m.muted
      }));
      room.members.set(ws.id, ws);

      send(ws, {type:"joined", id:ws.id, room:roomCode, members});
      broadcast(room, {type:"member-joined", id:ws.id, name:ws.name}, ws);
      return;
    }

    if (!ws.room || !rooms.has(ws.room)) return;
    const room = rooms.get(ws.room);

    if (msg.type === "offer" || msg.type === "answer" || msg.type === "ice") {
      const target = room.members.get(msg.target);
      if (target) send(target.ws, {...msg, from:ws.id});
    }

    if (msg.type === "state") {
      ws.muted = !!msg.muted;
      broadcast(room, {
        type:"member-state", id:ws.id, name:ws.name, muted:ws.muted
      });
    }

    if (msg.type === "speaking") {
      broadcast(room, {type:"speaking", id:ws.id, value:!!msg.value}, ws);
    }

    if (msg.type === "leave") leave(ws);
  });

  ws.on("close", () => leave(ws));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`XITERZ VOICE running on http://localhost:${PORT}`);
});
