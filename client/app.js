const $ = (s) => document.querySelector(s);

const joinPanel = $("#joinPanel");
const roomPanel = $("#roomPanel");
const nameInput = $("#name");
const roomInput = $("#room");
const joinError = $("#joinError");
const connection = $("#connection");
const membersEl = $("#members");
const roomTitle = $("#roomTitle");
const roomCodeEl = $("#roomCode");
const roomMessage = $("#roomMessage");
const muteBtn = $("#muteBtn");

const socket = new WebSocket(
  (location.protocol === "https:" ? "wss://" : "ws://") + location.host
);

const peers = new Map();
let localStream = null;
let myId = null;
let currentRoom = null;
let muted = false;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

function setConnection(text, online=false) {
  connection.textContent = text;
  connection.className = "status " + (online ? "online" : "offline");
}

socket.addEventListener("open", () => setConnection("SERVER ONLINE", true));
socket.addEventListener("close", () => setConnection("SERVER OFFLINE"));
socket.addEventListener("error", () => setConnection("SERVER ERROR"));

async function getMic() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Browser tidak mendukung akses microphone.");
  }
  return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
}

function send(message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function showRoom() {
  joinPanel.classList.add("hidden");
  roomPanel.classList.remove("hidden");
  roomTitle.textContent = "🎮 " + currentRoom;
  roomCodeEl.textContent = "ROOM: " + currentRoom;
}

function renderMember(id, name, speaking=false, mutedState=false) {
  let el = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (!el) {
    el = document.createElement("div");
    el.className = "member";
    el.dataset.id = id;
    membersEl.appendChild(el);
  }
  el.classList.toggle("speaking", speaking);
  el.innerHTML = `
    <div class="avatar">${(name || "?").slice(0,1).toUpperCase()}</div>
    <div class="memberText">
      <div class="memberName">${escapeHtml(name)}${id === myId ? " (kamu)" : ""}</div>
      <div class="memberState">${speaking ? "Speaking..." : "Connected"}</div>
    </div>
    <div class="micState">${mutedState ? "MUTED" : "MIC"}</div>`;
}

function removeMember(id) {
  document.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove();
  const peer = peers.get(id);
  if (peer) peer.close();
  peers.delete(id);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function addSpeakingDetector(id, audio) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const source = ctx.createMediaStreamSource(audio);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const loop = () => {
    if (!peers.has(id)) { ctx.close(); return; }
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (const v of data) sum += v;
    const speaking = (sum / data.length) > 18;
    const peer = peers.get(id);
    if (peer && peer.lastSpeaking !== speaking) {
      peer.lastSpeaking = speaking;
      send({type:"speaking", target:id, value:speaking});
      const el = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (el) el.classList.toggle("speaking", speaking);
    }
    requestAnimationFrame(loop);
  };
  loop();
}

async function createPeer(peerId, initiator) {
  const pc = new RTCPeerConnection(rtcConfig);
  peers.set(peerId, { pc, lastSpeaking:false });

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = e => {
    if (e.candidate) send({type:"ice", target:peerId, candidate:e.candidate});
  };

  pc.ontrack = e => {
    const stream = e.streams[0];
    let audio = document.querySelector(`audio[data-peer="${CSS.escape(peerId)}"]`);
    if (!audio) {
      audio = document.createElement("audio");
      audio.autoplay = true;
      audio.dataset.peer = peerId;
      document.body.appendChild(audio);
    }
    audio.srcObject = stream;
    addSpeakingDetector(peerId, stream);
  };

  pc.onconnectionstatechange = () => {
    if (["failed","closed","disconnected"].includes(pc.connectionState)) {
      removeMember(peerId);
    }
  };

  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({type:"offer", target:peerId, offer:pc.localDescription});
  }
  return pc;
}

socket.addEventListener("message", async (event) => {
  const msg = JSON.parse(event.data);

  try {
    if (msg.type === "joined") {
      myId = msg.id;
      currentRoom = msg.room;
      showRoom();
      membersEl.innerHTML = "";
      msg.members.forEach(m => renderMember(m.id, m.name, false, m.muted));
      for (const m of msg.members) {
        if (m.id !== myId) await createPeer(m.id, true);
      }
      roomMessage.textContent = "Terhubung. Izinkan microphone kalau browser memintanya.";
    }

    if (msg.type === "member-joined") {
      renderMember(msg.id, msg.name, false, false);
      await createPeer(msg.id, false);
    }

    if (msg.type === "member-left") removeMember(msg.id);

    if (msg.type === "offer") {
      let peer = peers.get(msg.from)?.pc;
      if (!peer) peer = (await createPeer(msg.from, false));
      await peer.setRemoteDescription(msg.offer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      send({type:"answer", target:msg.from, answer:peer.localDescription});
    }

    if (msg.type === "answer") {
      const peer = peers.get(msg.from)?.pc;
      if (peer) await peer.setRemoteDescription(msg.answer);
    }

    if (msg.type === "ice") {
      const peer = peers.get(msg.from)?.pc;
      if (peer) await peer.addIceCandidate(msg.candidate);
    }

    if (msg.type === "member-state") {
      renderMember(msg.id, msg.name, false, msg.muted);
    }

    if (msg.type === "speaking") {
      const el = document.querySelector(`[data-id="${CSS.escape(msg.id)}"]`);
      if (el) el.classList.toggle("speaking", !!msg.value);
    }

    if (msg.type === "error") {
      joinError.textContent = msg.message;
    }
  } catch (err) {
    console.error(err);
    roomMessage.textContent = err.message || "Terjadi error.";
  }
});

async function enterRoom() {
  joinError.textContent = "";
  const name = nameInput.value.trim().slice(0,20);
  const room = roomInput.value.trim().replace(/[^a-zA-Z0-9_-]/g,"").slice(0,24).toUpperCase();
  if (!name || !room) {
    joinError.textContent = "Isi nama dan kode room dulu.";
    return;
  }
  try {
    localStream = await getMic();
    currentRoom = room;
    send({type:"join", name, room});
  } catch (e) {
    joinError.textContent = e.message;
  }
}

$("#createBtn").addEventListener("click", enterRoom);
$("#joinBtn").addEventListener("click", enterRoom);

muteBtn.addEventListener("click", () => {
  if (!localStream) return;
  muted = !muted;
  localStream.getAudioTracks().forEach(t => t.enabled = !muted);
  muteBtn.textContent = muted ? "MIC OFF" : "MIC ON";
  send({type:"state", muted});
});

$("#leaveBtn").addEventListener("click", () => {
  send({type:"leave"});
  for (const p of peers.values()) p.pc.close();
  peers.clear();
  localStream?.getTracks().forEach(t => t.stop());
  location.reload();
});

$("#copyBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(currentRoom || "");
    roomMessage.textContent = "Kode room disalin.";
  } catch {
    roomMessage.textContent = "Kode room: " + currentRoom;
  }
});
