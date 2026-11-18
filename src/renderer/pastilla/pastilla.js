// Grabadora y estado visual de la pastilla flotante.
const elPastilla = document.getElementById('pastilla');
const mensaje = document.getElementById('mensaje');
const lienzo = document.getElementById('ondas');
const progreso = document.getElementById('progreso');
const ctx2d = lienzo.getContext('2d');

let grabacion = null; // { stream, recorder, trozos, inicio, audioCtx, analizador, cancelada, nivelMax }
let sonidos = true;
let timerMensaje = null;
let arrancando = false;
let terminarPendiente = null; // true = cancelar, false = detener
let estadoActual = 'reposo';
let ratonEncima = false;
let arrastrando = false;
let cancelacion = null; // { audio, duracionSeg, nivelMax } disponible para "Deshacer"

const DURACION_AVISO_CANCELADO_MS = 5000;
const MIN_SEG_PARA_DESHACER = 1;

function pintarClase() {
  elPastilla.className = estadoActual
    + (estadoActual === 'reposo' && ratonEncima ? ' encima' : '')
    + (arrastrando ? ' arrastrando' : '');
  informarRect();
}

// Main necesita saber dónde está la pastilla dentro de la ventana para
// detectar el mouse encima (la ventana deja pasar los clics el resto del tiempo).
function informarRect() {
  requestAnimationFrame(() => {
    const r = elPastilla.getBoundingClientRect();
    window.pastilla.enviar('pastilla:rect', { x: r.x, y: r.y, width: r.width, height: r.height });
  });
}
elPastilla.addEventListener('transitionend', informarRect);
window.addEventListener('load', informarRect);

function ponerEstado(estado, texto) {
  clearTimeout(timerMensaje);
  estadoActual = estado;
  mensaje.textContent = texto || '';
  pintarClase();
  if (estado === 'grabando' || estado === 'procesando') arrancarAnimacion();
  if (estado === 'error' || estado === 'aviso') {
    timerMensaje = setTimeout(() => ponerEstado('reposo'), 3000);
  }
  if (estado === 'cancelado') {
    progreso.classList.remove('corriendo');
    void progreso.offsetWidth; // reinicia la animación de la barrita
    progreso.classList.add('corriendo');
    timerMensaje = setTimeout(() => { cancelacion = null; ponerEstado('reposo'); }, DURACION_AVISO_CANCELADO_MS);
  }
}

function tono(frecuencias) {
  if (!sonidos) return;
  const ac = new AudioContext();
  let t = ac.currentTime;
  for (const f of [].concat(frecuencias)) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.09);
    t += 0.1;
  }
  setTimeout(() => ac.close(), (t - ac.currentTime) * 1000 + 100);
}

// ---------- ondas ----------
const ANCHO_CSS = 62;
const ALTO_CSS = 18;
const BARRAS = 9;
const ANCHO_BARRA = 3;
const SEPARACION = 4;
const dpr = window.devicePixelRatio || 1;
lienzo.width = ANCHO_CSS * dpr;
lienzo.height = ALTO_CSS * dpr;
lienzo.style.width = `${ANCHO_CSS}px`;
lienzo.style.height = `${ALTO_CSS}px`;
ctx2d.scale(dpr, dpr);

const alturas = new Float32Array(BARRAS); // 0-1, suavizadas
let animando = false;

// Devuelve el volumen RMS actual (0-1) y lleva el máximo de la grabación.
function medirNivel() {
  const onda = new Float32Array(grabacion.analizador.fftSize);
  grabacion.analizador.getFloatTimeDomainData(onda);
  let suma = 0;
  for (const v of onda) suma += v * v;
  const rms = Math.sqrt(suma / onda.length);
  // Los primeros 300 ms traen el pitido de inicio y el clic del micrófono.
  if (performance.now() - grabacion.inicio > 300) grabacion.nivelMax = Math.max(grabacion.nivelMax, rms);
  return rms;
}

function objetivosGrabando(rms) {
  // El volumen manda la altura general; las frecuencias le dan textura.
  const volumen = Math.min(1, Math.sqrt(rms) * 2.2);
  const datos = new Uint8Array(grabacion.analizador.frequencyBinCount);
  grabacion.analizador.getByteFrequencyData(datos);
  const centro = (BARRAS - 1) / 2;
  const objetivos = new Float32Array(BARRAS);
  for (let i = 0; i < BARRAS; i++) {
    const d = Math.abs(i - centro);
    // El centro muestra las frecuencias graves (la voz) y es más alto.
    const v = datos[1 + Math.round(d * 2.4)] / 255;
    const envolvente = 1 - (d / (centro + 1)) * 0.6;
    objetivos[i] = Math.min(1, volumen * envolvente * (0.45 + 0.75 * v));
  }
  return objetivos;
}

function objetivosProcesando(t) {
  const objetivos = new Float32Array(BARRAS);
  for (let i = 0; i < BARRAS; i++) objetivos[i] = 0.14 + 0.32 * Math.pow(Math.sin(t / 180 - i * 0.55), 2);
  return objetivos;
}

function animar(t) {
  if (estadoActual !== 'grabando' && estadoActual !== 'procesando') { animando = false; alturas.fill(0); return; }
  const rms = grabacion ? medirNivel() : 0;
  const objetivos = estadoActual === 'grabando' && grabacion ? objetivosGrabando(rms) : objetivosProcesando(t);
  ctx2d.clearRect(0, 0, ANCHO_CSS, ALTO_CSS);
  const total = BARRAS * ANCHO_BARRA + (BARRAS - 1) * SEPARACION;
  let x = (ANCHO_CSS - total) / 2;
  const degradado = ctx2d.createLinearGradient(0, 0, ANCHO_CSS, 0);
  degradado.addColorStop(0, 'rgba(196, 181, 253, .75)');
  degradado.addColorStop(0.5, '#FFFFFF');
  degradado.addColorStop(1, 'rgba(196, 181, 253, .75)');
  ctx2d.fillStyle = degradado;
  for (let i = 0; i < BARRAS; i++) {
    // Sube rápido y baja despacio, como un vúmetro.
    const k = objetivos[i] > alturas[i] ? 0.55 : 0.14;
    alturas[i] += (objetivos[i] - alturas[i]) * k;
    const alto = Math.max(ANCHO_BARRA, alturas[i] * ALTO_CSS);
    ctx2d.beginPath();
    ctx2d.roundRect(x, (ALTO_CSS - alto) / 2, ANCHO_BARRA, alto, ANCHO_BARRA / 2);
    ctx2d.fill();
    x += ANCHO_BARRA + SEPARACION;
  }
  requestAnimationFrame(animar);
}

function arrancarAnimacion() {
  if (animando) return;
  animando = true;
  requestAnimationFrame(animar);
}

// ---------- grabación ----------
async function listarMics() {
  const dispositivos = await navigator.mediaDevices.enumerateDevices();
  return dispositivos
    .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications')
    .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Micrófono' }));
}

// Micrófono abierto y listo (sin grabar). Abrirlo en cada dictado tarda
// medio segundo o más; con `micListo` se deja abierto entre dictados y el
// inicio es instantáneo. Solo se graba mientras el MediaRecorder corre.
let mic = null; // { stream, deviceId, audioCtx, analizador }
let micListo = true;

function micVivo(deviceId) {
  return mic && mic.deviceId === (deviceId || null)
    && mic.stream.getAudioTracks().some((t) => t.readyState === 'live');
}

async function abrirMic(deviceId) {
  if (micVivo(deviceId)) return mic;
  cerrarMic();
  if (deviceId) {
    const mics = await listarMics();
    if (!mics.some((m) => m.deviceId === deviceId)) {
      const e = new Error('mic-no-encontrado'); e.name = 'NotFoundError'; throw e;
    }
  }
  const audio = { echoCancellation: false, noiseSuppression: true, autoGainControl: true };
  if (deviceId) audio.deviceId = { exact: deviceId };
  const stream = await navigator.mediaDevices.getUserMedia({ audio });
  const audioCtx = new AudioContext();
  const analizador = audioCtx.createAnalyser();
  analizador.fftSize = 256;
  analizador.minDecibels = -85;
  analizador.maxDecibels = -25;
  analizador.smoothingTimeConstant = 0.6;
  audioCtx.createMediaStreamSource(stream).connect(analizador);
  mic = { stream, deviceId: deviceId || null, audioCtx, analizador };
  return mic;
}

function cerrarMic() {
  if (!mic) return;
  mic.stream.getTracks().forEach((t) => t.stop());
  mic.audioCtx.close().catch(() => {});
  mic = null;
}

// Main pide dejar el micrófono listo al arrancar y cuando cambian los ajustes.
async function preparar({ deviceId, micListo: listo }) {
  micListo = listo !== false;
  if (grabacion || arrancando) return;
  if (!micListo) { cerrarMic(); return; }
  try { await abrirMic(deviceId); } catch { /* se reintenta al dictar */ }
}

// Si se conecta o desconecta un micrófono, se reabre (el "predeterminado"
// de Windows pudo cambiar).
navigator.mediaDevices.addEventListener('devicechange', () => {
  if (!mic || grabacion || arrancando) return;
  const id = mic.deviceId;
  cerrarMic();
  if (micListo) abrirMic(id).catch(() => {});
});

async function iniciar({ deviceId, sonidos: conSonidos, micListo: listo }) {
  if (grabacion || arrancando) return;
  arrancando = true;
  terminarPendiente = null;
  cancelacion = null;
  sonidos = conSonidos !== false;
  if (listo !== undefined) micListo = listo !== false;
  try {
    const m = await abrirMic(deviceId);
    if (m.audioCtx.state === 'suspended') m.audioCtx.resume();
    const recorder = new MediaRecorder(m.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 });
    const g = { stream: m.stream, recorder, trozos: [], inicio: performance.now(), audioCtx: m.audioCtx, analizador: m.analizador, cancelada: false, nivelMax: 0 };
    grabacion = g;
    recorder.ondataavailable = (e) => { if (e.data.size) g.trozos.push(e.data); };
    recorder.start(1000);
    ponerEstado('grabando');
    tono(TONOS.iniciar);
    // Main silencia el sistema poco después de este aviso, cuando ya sonó el tono.
    window.pastilla.enviar('grabar:iniciada');
  } catch (e) {
    terminarPendiente = null;
    grabacion = null;
    cerrarMic();
    const tipo = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'permiso'
      : e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') ? 'mic-no-encontrado' : 'otro';
    window.pastilla.enviar('grabar:error', tipo);
  } finally {
    arrancando = false;
    if (grabacion && terminarPendiente !== null) terminar(terminarPendiente);
  }
}

const TONOS = { iniciar: 660, detener: 440, cancelar: [520, 330] };

// `tono`: tocarlo ya (main lo pide después si el sistema estaba silenciado).
// `silencioso`: cancelación sin aviso ni Deshacer.
function terminar(cancelar, { tono: conTono = true, silencioso = false } = {}) {
  if (arrancando) { terminarPendiente = terminarPendiente === true ? true : cancelar; return; }
  const g = grabacion;
  if (!g) return;
  if (conTono) tono(cancelar ? TONOS.cancelar : TONOS.detener);
  grabacion = null;
  g.cancelada = cancelar;
  g.recorder.onstop = async () => {
    if (!micListo) cerrarMic();
    const duracionSeg = (performance.now() - g.inicio) / 1000;
    const blob = new Blob(g.trozos, { type: 'audio/webm' });
    if (g.cancelada) {
      // Un toque accidental no muestra aviso; una grabación real se puede deshacer.
      if (silencioso || duracionSeg < MIN_SEG_PARA_DESHACER) { ponerEstado('reposo'); return; }
      cancelacion = { audio: await blob.arrayBuffer(), duracionSeg, nivelMax: g.nivelMax };
      ponerEstado('cancelado', 'Transcripción cancelada');
      return;
    }
    window.pastilla.enviar('grabar:audio', await blob.arrayBuffer(), duracionSeg, g.nivelMax);
  };
  g.recorder.stop();
  if (!cancelar) ponerEstado('procesando');
}

// ---------- botones ----------
document.getElementById('btn-cancelar').addEventListener('click', (e) => {
  e.stopPropagation();
  window.pastilla.enviar('pastilla:cancelar');
});
document.getElementById('btn-terminar').addEventListener('click', (e) => {
  e.stopPropagation();
  window.pastilla.enviar('pastilla:detener');
});
document.getElementById('btn-deshacer').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!cancelacion) return;
  const c = cancelacion;
  cancelacion = null;
  window.pastilla.enviar('grabar:deshacer', c.audio, c.duracionSeg, c.nivelMax);
  ponerEstado('procesando');
});

// ---------- mouse y arrastre ----------
// Main avisa cuando el cursor entra o sale de la pastilla.
window.pastilla.on('pastilla:encima', (encima) => {
  if (ratonEncima === encima) return;
  ratonEncima = encima;
  pintarClase();
});
elPastilla.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.target.closest('button')) return;
  arrastrando = true;
  pintarClase();
  window.pastilla.enviar('pastilla:arrastrar', 'inicio');
});
window.addEventListener('mouseup', () => {
  if (!arrastrando) return;
  arrastrando = false;
  pintarClase();
  window.pastilla.enviar('pastilla:arrastrar', 'fin');
});

// ---------- mensajes de main ----------
window.pastilla.on('grabar:iniciar', (opciones) => iniciar(opciones || {}));
window.pastilla.on('grabar:detener', (op) => terminar(false, op || {}));
window.pastilla.on('grabar:cancelar', (op) => terminar(true, op || {}));
window.pastilla.on('grabar:preparar', (op) => preparar(op || {}));
window.pastilla.on('tono', (nombre) => TONOS[nombre] && tono(TONOS[nombre]));
window.pastilla.on('grabar:manos-libres', () => tono([660, 880]));
window.pastilla.on('estado', (estado, texto) => {
  // Un aviso de main no debe tapar el "Transcripción cancelada" con su Deshacer.
  if (estadoActual === 'cancelado' && estado === 'reposo') return;
  ponerEstado(estado, texto);
});
window.pastilla.on('mics:pedir', async () => window.pastilla.enviar('mics:lista', await listarMics()));
