// Detección de atajos globales: mantener presionado, doble toque (manos
// libres) y Esc para cancelar. `crearDetector` es puro (reloj y temporizador
// inyectados); `conectarUiohook` lo une al teclado real.

const MIN_MANTENER_MS = 300;
const VENTANA_DOBLE_MS = 400;
const ESC = 1;
const MODIFICADORES = new Set([29, 3613, 42, 54, 56, 3640, 3675, 3676]);

function crearDetector({ combo, ahora, programar }) {
  const presionadas = new Set();
  const oyentes = { iniciar: [], detener: [], cancelar: [] };
  let estado = 'inactivo'; // inactivo | mantener | esperandoSegundo | manosLibres | ignorar
  let inicio = 0;
  let cancelarTimer = null;
  let comboCompleto = false;
  let completoDesde = 0;

  const emitir = (nombre, ...args) => oyentes[nombre].forEach((fn) => fn(...args));
  const limpiarTimer = () => { if (cancelarTimer) cancelarTimer(); cancelarTimer = null; };

  function alPresionar() {
    if (estado === 'inactivo') {
      estado = 'mantener';
      inicio = ahora();
      emitir('iniciar', 'mantener');
    } else if (estado === 'esperandoSegundo') {
      limpiarTimer();
      estado = 'manosLibres';
      emitir('iniciar', 'manos-libres');
    } else if (estado === 'manosLibres') {
      estado = 'ignorar';
      emitir('detener');
    }
  }

  function alSoltar() {
    if (estado === 'mantener') {
      if (ahora() - inicio >= MIN_MANTENER_MS) {
        estado = 'inactivo';
        emitir('detener');
      } else {
        estado = 'esperandoSegundo';
        cancelarTimer = programar(() => {
          cancelarTimer = null;
          estado = 'inactivo';
          emitir('cancelar');
        }, VENTANA_DOBLE_MS);
      }
    } else if (estado === 'ignorar') {
      estado = 'inactivo';
    }
  }

  function tecla({ tipo, keycode }) {
    if (tipo === 'down') {
      if (keycode === ESC && estado !== 'inactivo' && estado !== 'ignorar') {
        limpiarTimer();
        estado = comboCompleto ? 'ignorar' : 'inactivo';
        emitir('cancelar');
        return;
      }
      presionadas.add(keycode);
    } else {
      presionadas.delete(keycode);
    }
    const ahoraCompleto = combo.every((k) => presionadas.has(k));
    if (ahoraCompleto && !comboCompleto) { comboCompleto = true; completoDesde = ahora(); alPresionar(); }
    else if (!ahoraCompleto && comboCompleto) { comboCompleto = false; alSoltar(); }
  }

  // Corrige eventos de "soltar" que Windows no entregó: `abajo` son las
  // teclas del combo que de verdad están presionadas ahora.
  function sincronizar(abajo) {
    if (!comboCompleto) return;
    for (const k of combo) {
      if (!abajo.includes(k)) tecla({ tipo: 'up', keycode: k });
    }
  }

  // Vuelve a reposo (p. ej. cuando la grabación se detuvo con un botón).
  function reiniciar() {
    limpiarTimer();
    estado = comboCompleto ? 'ignorar' : 'inactivo';
  }

  return {
    tecla,
    sincronizar,
    reiniciar,
    necesitaSincronizar: () => comboCompleto,
    completoDesde: () => completoDesde,
    combo,
    on(nombre, fn) { oyentes[nombre].push(fn); },
  };
}

// Conecta detectores al hook de teclado real. Solo para el proceso main.
function conectarUiohook(detectores) {
  const { uIOhook } = require('uiohook-napi');
  const presionadas = new Set();
  let pausado = false;
  const capturas = [];

  uIOhook.on('keydown', (e) => {
    presionadas.add(e.keycode);
    capturas.forEach((fn) => fn(e.keycode));
    if (!pausado) detectores.forEach((d) => d.tecla({ tipo: 'down', keycode: e.keycode }));
  });
  uIOhook.on('keyup', (e) => {
    presionadas.delete(e.keycode);
    if (!pausado) detectores.forEach((d) => d.tecla({ tipo: 'up', keycode: e.keycode }));
  });
  uIOhook.start();

  return {
    pausar() { pausado = true; },
    reanudar() { pausado = false; },
    estaPausado: () => pausado,
    modificadoresPresionados: () => [...presionadas].some((k) => MODIFICADORES.has(k)),
    // Olvida teclas cuyo evento de soltar se perdió.
    olvidar(codigos) { codigos.forEach((k) => presionadas.delete(k)); },
    alPresionarCualquiera(fn) { capturas.push(fn); return () => capturas.splice(capturas.indexOf(fn), 1); },
    detener() { uIOhook.stop(); },
  };
}

module.exports = { crearDetector, conectarUiohook };
