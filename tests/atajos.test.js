import { describe, it, expect, beforeEach } from 'vitest';
import { crearDetector } from '../src/main/atajos.js';

const SHIFT_DER = 54;
const CTRL_DER = 3613;
const ESC = 1;

let t;
let timers;
let eventos;
let det;

function avanzar(ms) {
  const fin = t + ms;
  for (;;) {
    const prox = timers.filter((x) => !x.cancelado).sort((a, b) => a.en - b.en)[0];
    if (!prox || prox.en > fin) break;
    t = prox.en;
    prox.cancelado = true;
    prox.fn();
  }
  t = fin;
}
const down = (k) => det.tecla({ tipo: 'down', keycode: k });
const up = (k) => det.tecla({ tipo: 'up', keycode: k });
const presionarCombo = () => { down(SHIFT_DER); down(CTRL_DER); };
const soltarCombo = () => { up(CTRL_DER); up(SHIFT_DER); };

beforeEach(() => {
  t = 0;
  timers = [];
  eventos = [];
  det = crearDetector({
    combo: [SHIFT_DER, CTRL_DER],
    ahora: () => t,
    programar: (fn, ms) => {
      const x = { fn, en: t + ms, cancelado: false };
      timers.push(x);
      return () => { x.cancelado = true; };
    },
  });
  det.on('iniciar', (modo) => eventos.push(`iniciar:${modo}`));
  det.on('detener', () => eventos.push('detener'));
  det.on('cancelar', () => eventos.push('cancelar'));
});

describe('detector de atajos', () => {
  it('mantener presionado graba y al soltar detiene', () => {
    presionarCombo(); avanzar(1000); soltarCombo();
    expect(eventos).toEqual(['iniciar:mantener', 'detener']);
  });

  it('un toque corto aislado se cancela a los 400 ms', () => {
    presionarCombo(); avanzar(100); soltarCombo(); avanzar(500);
    expect(eventos).toEqual(['iniciar:mantener', 'cancelar']);
  });

  it('doble toque pasa a manos libres y el siguiente combo detiene', () => {
    presionarCombo(); avanzar(100); soltarCombo();
    avanzar(150); presionarCombo(); avanzar(80); soltarCombo();
    avanzar(5000);
    presionarCombo(); avanzar(80); soltarCombo();
    expect(eventos).toEqual(['iniciar:mantener', 'iniciar:manos-libres', 'detener']);
  });

  it('Esc mientras graba cancela y soltar después no emite nada', () => {
    presionarCombo(); avanzar(1000); down(ESC); up(ESC); soltarCombo();
    expect(eventos).toEqual(['iniciar:mantener', 'cancelar']);
  });

  it('solo una de las teclas no hace nada', () => {
    down(CTRL_DER); avanzar(1000); up(CTRL_DER);
    expect(eventos).toEqual([]);
  });

  it('sincronizar con el teclado real detiene si se perdió el evento de soltar', () => {
    presionarCombo(); avanzar(1000);
    det.sincronizar([SHIFT_DER]); // Ctrl der ya no está físicamente presionado
    expect(eventos).toEqual(['iniciar:mantener', 'detener']);
    expect(det.necesitaSincronizar()).toBe(false);
  });

  it('sincronizar no hace nada si el combo sigue presionado', () => {
    presionarCombo(); avanzar(1000);
    expect(det.necesitaSincronizar()).toBe(true);
    det.sincronizar([SHIFT_DER, CTRL_DER]);
    expect(eventos).toEqual(['iniciar:mantener']);
  });

  it('reiniciar saca de manos libres (cuando se detiene con el botón ✓)', () => {
    presionarCombo(); avanzar(100); soltarCombo();
    avanzar(150); presionarCombo(); avanzar(80); soltarCombo();
    det.reiniciar();
    avanzar(2000);
    presionarCombo(); avanzar(1000); soltarCombo();
    expect(eventos).toEqual(['iniciar:mantener', 'iniciar:manos-libres', 'iniciar:mantener', 'detener']);
  });

  it('teclas repetidas (autorepeat) no reinician la grabación', () => {
    presionarCombo(); down(CTRL_DER); down(CTRL_DER); avanzar(1000); soltarCombo();
    expect(eventos).toEqual(['iniciar:mantener', 'detener']);
  });
});
