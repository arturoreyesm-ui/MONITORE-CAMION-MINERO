import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, onValue, set, push, query, limitToLast } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const statusListeners = [];
let app = null;
let db = null;
let datosActualesRef = null;
let historialRef = null;
let ready = false;
let lastPublishAt = 0;
let lastHistoryAt = 0;
let lastHistorySignature = "";

function cfg() {
  return window.FIREBASE_SYNC_CONFIG || {};
}

function hasFirebaseConfig(config) {
  if (!config) return false;
  return Boolean(config.apiKey && config.databaseURL && !String(config.apiKey).startsWith("TU_") && !String(config.projectId || "").startsWith("TU_"));
}

function emitStatus(state, message) {
  const detail = { state, message, ready };
  window.dispatchEvent(new CustomEvent("dumper-firebase-status", { detail }));
  statusListeners.forEach((fn) => fn(detail));
}

function obtenerDispositivo() {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("iphone")) return "iPhone";
  if (userAgent.includes("ipad")) return "iPad";
  if (userAgent.includes("macintosh")) return "MacBook";
  if (userAgent.includes("android")) return "Android";
  return "Otro dispositivo";
}

function number(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function diff(real, teorico) {
  return number(real) - number(teorico);
}

function pctDiff(real, teorico) {
  real = number(real);
  teorico = number(teorico);
  if (!teorico) return 0;
  return Math.abs((real - teorico) / teorico) * 100;
}

function estadoPorProductividad(real, teorico) {
  const pct = pctDiff(real, teorico);
  if (pct <= 10) return "NORMAL";
  if (pct <= 20) return "ALERTA";
  return "CRÍTICO";
}

function crearDatosMonitoreo(datosEntrada = {}) {
  const data = {
    velocidadReal: number(datosEntrada.velocidadReal),
    velocidadTeorica: number(datosEntrada.velocidadTeorica),
    cargaReal: number(datosEntrada.cargaReal),
    cargaTeorica: number(datosEntrada.cargaTeorica),
    distanciaReal: number(datosEntrada.distanciaReal),
    distanciaTeorica: number(datosEntrada.distanciaTeorica),
    tiempoCicloReal: number(datosEntrada.tiempoCicloReal),
    tiempoCicloTeorico: number(datosEntrada.tiempoCicloTeorico),
    productividadReal: number(datosEntrada.productividadReal),
    productividadTeorica: number(datosEntrada.productividadTeorica),
    confianzaVisual: number(datosEntrada.confianzaVisual),
    aceptacion: number(datosEntrada.aceptacion),
    deteccion: datosEntrada.deteccion !== false,
    fechaHora: new Date().toLocaleString(),
    timestamp: Date.now(),
    dispositivoOrigen: obtenerDispositivo()
  };

  data.diferenciaVelocidad = diff(data.velocidadReal, data.velocidadTeorica);
  data.diferenciaCarga = diff(data.cargaReal, data.cargaTeorica);
  data.diferenciaProductividad = diff(data.productividadReal, data.productividadTeorica);
  data.estado = datosEntrada.estado || estadoPorProductividad(data.productividadReal, data.productividadTeorica);
  return data;
}

function fromLocal(live = {}, theory = {}) {
  const velocidadReal = number(live.speedKmh);
  const velocidadTeorica = number(theory.avgSpeed);
  const cargaTeorica = number(theory.effLoad || theory.cap);
  const cargaReal = cargaTeorica ? cargaTeorica * Math.max(0, Math.min(1.2, number(live.confidence) / 100)) : 0;
  const distanciaReal = number(live.distanceM);
  const distanciaTeorica = number(theory.dist);
  const tiempoCicloTeorico = number(theory.cycle);
  const tiempoCicloReal = velocidadReal > 0 && distanciaReal > 0 ? (distanciaReal / 1000) / velocidadReal * 60 : 0;
  const productividadTeorica = number(theory.net);
  const productividadReal = productividadTeorica && velocidadTeorica ? productividadTeorica * (velocidadReal / velocidadTeorica) : 0;
  const aceptacion = number(live.acceptance || live.aceptacion || 0);
  const pct = pctDiff(productividadReal, productividadTeorica);
  let estado = "NORMAL";
  if (live.detected === false) estado = "CRÍTICO";
  else if (pct > 20 || live.offRoute || live.stoppedTooLong) estado = "CRÍTICO";
  else if (pct > 10 || aceptacion && aceptacion < 80) estado = "ALERTA";

  return crearDatosMonitoreo({
    velocidadReal,
    velocidadTeorica,
    cargaReal,
    cargaTeorica,
    distanciaReal,
    distanciaTeorica,
    tiempoCicloReal,
    tiempoCicloTeorico,
    productividadReal,
    productividadTeorica,
    confianzaVisual: live.confidence,
    aceptacion,
    deteccion: live.detected,
    estado
  });
}

async function publicar(datosEntrada, options = {}) {
  if (!ready) return false;
  const now = Date.now();
  const publishEveryMs = number(cfg().publishEveryMs) || 1000;
  const historyEveryMs = number(cfg().historyEveryMs) || 5000;
  const force = Boolean(options.force);
  if (!force && now - lastPublishAt < publishEveryMs) return false;

  const data = datosEntrada.estado ? crearDatosMonitoreo(datosEntrada) : datosEntrada;
  lastPublishAt = now;
  await set(datosActualesRef, data);

  const signature = [
    Math.round(data.velocidadReal * 100),
    Math.round(data.distanciaReal * 100),
    Math.round(data.productividadReal * 100),
    data.estado
  ].join("|");
  const historyEnabled = options.history !== false;
  const shouldSaveHistory = historyEnabled && (force || (now - lastHistoryAt >= historyEveryMs && signature !== lastHistorySignature));
  if (shouldSaveHistory) {
    await push(historialRef, data);
    lastHistoryAt = now;
    lastHistorySignature = signature;
  }
  return true;
}

async function publishFromLocal(live, theory, options = {}) {
  return publicar(fromLocal(live, theory), options);
}

function listenCurrent(callback) {
  if (!ready) return () => {};
  return onValue(datosActualesRef, (snapshot) => callback(snapshot.val()));
}

function listenHistory(callback, last = 30) {
  if (!ready) return () => {};
  const q = query(historialRef, limitToLast(last));
  return onValue(q, (snapshot) => {
    const value = snapshot.val() || {};
    const rows = Object.entries(value).map(([id, row]) => ({ id, ...row })).sort((a, b) => number(a.timestamp) - number(b.timestamp));
    callback(rows);
  });
}

function onStatus(callback) {
  statusListeners.push(callback);
  callback({ state: ready ? "connected" : "local", message: ready ? "Firebase conectado" : "Modo local", ready });
}

async function testUpdate() {
  const datosPrueba = {
    velocidadReal: Math.floor(Math.random() * 20) + 20,
    velocidadTeorica: 30,
    cargaReal: Math.floor(Math.random() * 15) + 20,
    cargaTeorica: 30,
    distanciaReal: Math.floor(Math.random() * 1000) + 500,
    distanciaTeorica: 1000,
    tiempoCicloReal: Math.floor(Math.random() * 20) + 10,
    tiempoCicloTeorico: 20,
    productividadReal: Math.floor(Math.random() * 80) + 100,
    productividadTeorica: 150,
    aceptacion: Math.floor(Math.random() * 35) + 60,
    deteccion: true
  };
  return publicar(crearDatosMonitoreo(datosPrueba), { force: true });
}

function init() {
  const syncCfg = cfg();
  if (syncCfg.enabled === false) {
    emitStatus("local", "Firebase desactivado en config.js");
    return;
  }
  const firebaseConfig = window.FIREBASE_CONFIG;
  if (!hasFirebaseConfig(firebaseConfig)) {
    emitStatus("local", "Modo local: pega firebaseConfig real en config.js");
    return;
  }
  try {
    const basePath = syncCfg.basePath || "monitoreoDumper";
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    datosActualesRef = ref(db, `${basePath}/${syncCfg.currentPath || "datosActuales"}`);
    historialRef = ref(db, `${basePath}/${syncCfg.historyPath || "historial"}`);
    ready = true;
    emitStatus("connected", "Firebase conectado. Datos sincronizados en tiempo real.");
    window.dispatchEvent(new CustomEvent("dumper-firebase-ready"));
  } catch (error) {
    ready = false;
    emitStatus("error", `Error Firebase: ${error.message}`);
  }
}

window.DumperFirebase = {
  isReady: () => ready,
  crearDatosMonitoreo,
  fromLocal,
  publicar,
  publishFromLocal,
  listenCurrent,
  listenHistory,
  onStatus,
  testUpdate,
  obtenerDispositivo
};

// Alias solicitados en las instrucciones: permiten probar desde consola,
// botones HTML o simuladores externos sin conocer la implementacion interna.
window.actualizarDatosActuales = (datosEntrada) => publicar(crearDatosMonitoreo(datosEntrada), { force: true });
window.probarActualizacion = testUpdate;

init();
