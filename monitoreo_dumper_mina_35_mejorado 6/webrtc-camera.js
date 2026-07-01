import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, push, onValue, remove } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const phoneBtn = document.getElementById("phoneCameraBtn");
const macBtn = document.getElementById("macViewerBtn");
const hangupBtn = document.getElementById("hangupWebrtcBtn");
const roomInput = document.getElementById("webrtcRoom");
const statusBox = document.getElementById("webrtcStatus");

let db = null;
let pc = null;
let localStream = null;
let unsubscribers = [];

const iceServers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

function setStatus(message, type = "warn") {
  if (!statusBox) return;
  statusBox.textContent = message;
  statusBox.className = type === "ok" ? "alert ok" : type === "bad" ? "alert bad" : "alert";
}

function hasFirebaseConfig() {
  const c = window.FIREBASE_CONFIG;
  return Boolean(c && c.apiKey && c.databaseURL && !String(c.apiKey).startsWith("TU_"));
}

function initFirebase() {
  if (db) return true;
  if (!hasFirebaseConfig()) {
    setStatus("Primero pega tu firebaseConfig real en config.js. WebRTC usa Firebase para conectar iPhone y Mac.", "bad");
    return false;
  }
  const app = initializeApp(window.FIREBASE_CONFIG, "webrtc-camera");
  db = getDatabase(app);
  return true;
}

function roomId() {
  return (roomInput?.value || "DUMPER01").trim().replace(/[.#$/\[\]]/g, "-") || "DUMPER01";
}

function roomRef(path = "") {
  const base = `monitoreoDumper/videoRooms/${roomId()}`;
  return ref(db, path ? `${base}/${path}` : base);
}

function clearListeners() {
  unsubscribers.forEach((unsub) => {
    try { unsub(); } catch (e) {}
  });
  unsubscribers = [];
}

async function closeConnection(clearRoom = false) {
  clearListeners();
  if (pc) {
    pc.getSenders().forEach((sender) => sender.track?.stop());
    pc.close();
    pc = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
  if (clearRoom && db) await remove(roomRef());
  setStatus("Conexión cerrada.", "warn");
}

function createPeerConnection(role) {
  pc = new RTCPeerConnection(iceServers);

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") setStatus("Video conectado correctamente.", "ok");
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
      setStatus("Conexión interrumpida. Verifica que ambos equipos usen la misma sala.", "bad");
    }
  };

  pc.onicecandidate = async (event) => {
    if (!event.candidate) return;
    await push(roomRef(role === "phone" ? "candidatesPhone" : "candidatesMac"), event.candidate.toJSON());
  };

  pc.ontrack = (event) => {
    const remoteStream = event.streams[0];
    if (remoteStream && window.DumperCamera?.useExternalStream) {
      window.DumperCamera.useExternalStream(remoteStream);
      setStatus("Mac recibiendo cámara del iPhone. El monitoreo analizará este video.", "ok");
    }
  };
}

async function startPhoneCamera() {
  if (!initFirebase()) return;
  await closeConnection(true);
  setStatus("iPhone: solicitando cámara posterior...", "warn");

  localStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  });
  window.DumperCamera?.useExternalStream(localStream);

  createPeerConnection("phone");
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await set(roomRef("offer"), { type: offer.type, sdp: offer.sdp, createdAt: Date.now() });

  unsubscribers.push(onValue(roomRef("answer"), async (snapshot) => {
    const answer = snapshot.val();
    if (!answer || pc.currentRemoteDescription) return;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    setStatus("iPhone transmitiendo. Mantén esta página abierta.", "ok");
  }));

  unsubscribers.push(onValue(roomRef("candidatesMac"), async (snapshot) => {
    for (const candidate of Object.values(snapshot.val() || {})) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
    }
  }));

  setStatus(`iPhone listo. En la Mac usa la sala ${roomId()} y presiona "Mac: ver cámara iPhone".`, "ok");
}

async function startMacViewer() {
  if (!initFirebase()) return;
  await closeConnection(false);
  setStatus("Mac: esperando señal del iPhone...", "warn");

  createPeerConnection("mac");

  unsubscribers.push(onValue(roomRef("offer"), async (snapshot) => {
    const offer = snapshot.val();
    if (!offer || pc.currentRemoteDescription) return;
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await set(roomRef("answer"), { type: answer.type, sdp: answer.sdp, createdAt: Date.now() });
    setStatus("Mac conectando con iPhone...", "warn");
  }));

  unsubscribers.push(onValue(roomRef("candidatesPhone"), async (snapshot) => {
    for (const candidate of Object.values(snapshot.val() || {})) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
    }
  }));
}

phoneBtn?.addEventListener("click", () => startPhoneCamera().catch((error) => setStatus(`Error iPhone: ${error.message}`, "bad")));
macBtn?.addEventListener("click", () => startMacViewer().catch((error) => setStatus(`Error Mac: ${error.message}`, "bad")));
hangupBtn?.addEventListener("click", () => closeConnection(false));

if (!("RTCPeerConnection" in window)) setStatus("Este navegador no soporta WebRTC.", "bad");
