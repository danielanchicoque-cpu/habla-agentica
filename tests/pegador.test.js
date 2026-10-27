import { describe, it, expect } from 'vitest';
import { crearPegador, portapapelesElectron } from '../src/main/pegador.js';

// Portapapeles falso con la interfaz que usa el pegador.
function fakePortapapeles(inicial = '') {
  const estado = { texto: inicial, extra: inicial ? 'formatos-originales' : null };
  const log = [];
  return {
    log,
    estado,
    respaldar: async () => ({ texto: estado.texto, extra: estado.extra }),
    restaurar: async (r) => { log.push(r.texto || r.extra ? 'restaurar' : 'limpiar'); Object.assign(estado, r); },
    escribirTexto: async (t) => { log.push(`escribir:${t}`); estado.texto = t; estado.extra = null; },
    leerTexto: async () => estado.texto,
    limpiar: async () => { log.push('limpiar'); estado.texto = ''; estado.extra = null; },
  };
}

const esperarFalso = (log) => async (ms) => { log.push(`esperar:${ms}`); };

describe('pegador.pegar', () => {
  it('escribe, pega con ctrl+v y restaura el portapapeles a los 400 ms', async () => {
    const pp = fakePortapapeles('anterior');
    const log = pp.log;
    const p = crearPegador({
      portapapeles: pp,
      teclado: { tap: (t) => log.push(`tap:${t.join('+')}`) },
      modificadoresPresionados: () => false,
      esperar: esperarFalso(log),
    });
    await p.pegar('hola');
    expect(log).toEqual(['escribir:hola', 'tap:ctrl+v', 'esperar:400', 'restaurar']);
    expect(pp.estado).toEqual({ texto: 'anterior', extra: 'formatos-originales' });
  });

  it('espera a que se suelten los modificadores antes de pegar', async () => {
    const pp = fakePortapapeles();
    let chequeos = 0;
    const log = pp.log;
    const p = crearPegador({
      portapapeles: pp,
      teclado: { tap: (t) => log.push(`tap:${t.join('+')}`) },
      modificadoresPresionados: () => { chequeos += 1; return chequeos <= 3; },
      esperar: esperarFalso(log),
    });
    await p.pegar('x');
    expect(log.slice(0, 3)).toEqual(['esperar:20', 'esperar:20', 'esperar:20']);
    expect(log.indexOf('tap:ctrl+v')).toBeGreaterThan(3);
  });
});

describe('pegador con varias operaciones', () => {
  it('I2: mientras se graba otro dictado, espera sin límite a que suelten las teclas', async () => {
    const pp = fakePortapapeles();
    let chequeos = 0;
    const log = pp.log;
    const p = crearPegador({
      portapapeles: pp,
      teclado: { tap: (t) => log.push(`tap:${t.join('+')}`) },
      modificadoresPresionados: () => { chequeos += 1; return chequeos <= 120; }, // 2,4 s presionadas
      esperar: async () => {},
      grabando: () => chequeos <= 120,
    });
    await p.pegar('x');
    expect(chequeos).toBeGreaterThan(120);
    expect(log).toContain('tap:ctrl+v');
  });

  it('I6: pegar y copiar la selección no se mezclan en el portapapeles', async () => {
    const pp = fakePortapapeles('original');
    const log = pp.log;
    const p = crearPegador({
      portapapeles: pp,
      teclado: { tap: (t) => log.push(`tap:${t.join('+')}`) },
      modificadoresPresionados: () => false,
      esperar: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 30))),
    });
    await Promise.all([p.pegar('dictado'), p.copiarSeleccion()]);
    const iRestaurar = log.indexOf('restaurar');
    const iLimpiar = log.indexOf('limpiar');
    expect(iRestaurar).toBeLessThan(iLimpiar);
    expect(pp.estado.texto).toBe('original');
  });
});

describe('pegador.copiarSeleccion', () => {
  it('sin selección devuelve "" y restaura lo anterior', async () => {
    const pp = fakePortapapeles('guardado');
    const p = crearPegador({ portapapeles: pp, teclado: { tap() {} }, modificadoresPresionados: () => false, esperar: async () => {} });
    expect(await p.copiarSeleccion()).toBe('');
    expect(pp.estado.texto).toBe('guardado');
  });

  it('con selección devuelve el texto copiado', async () => {
    const pp = fakePortapapeles('guardado');
    const p = crearPegador({
      portapapeles: pp,
      teclado: { tap: (t) => { if (t.join('+') === 'ctrl+c') pp.estado.texto = 'hola amigo'; } },
      modificadoresPresionados: () => false,
      esperar: async () => {},
    });
    expect(await p.copiarSeleccion()).toBe('hola amigo');
    expect(pp.estado.texto).toBe('guardado');
  });
});

describe('portapapelesElectron', () => {
  // Imita la API de Electron 44: read() devuelve ClipboardItems que no se pueden
  // volver a escribir; write() exige ClipboardItems nuevos.
  class FakeItem {
    constructor(datos) { this.datos = datos; this.types = Object.keys(datos); this.leido = false; }
    async getType(t) { return this.datos[t]; }
  }
  function fakeElectron(itemsIniciales) {
    let items = itemsIniciales;
    return {
      read: async () => items.map((i) => Object.assign(new FakeItem(i.datos), { leido: true })),
      write: async (nuevos) => {
        if (nuevos.some((i) => i.leido)) throw new TypeError('no se puede reescribir un item leído');
        items = nuevos;
      },
      writeText: (t) => { items = [new FakeItem({ 'text/plain': new Blob([t]) })]; },
      readText: async () => (items[0] && items[0].datos['text/plain'] ? items[0].datos['text/plain'].text() : ''),
      clear: () => { items = []; },
      items: () => items,
    };
  }

  it('respalda y restaura html e imagen, no solo texto', async () => {
    const png = new Blob(['PNG'], { type: 'image/png' });
    const cb = fakeElectron([new FakeItem({ 'text/plain': new Blob(['t']), 'text/html': new Blob(['<b>t</b>']), 'image/png': png })]);
    const pp = portapapelesElectron(cb, FakeItem);
    const r = await pp.respaldar();
    await pp.escribirTexto('nuevo');
    expect(await pp.leerTexto()).toBe('nuevo');
    await pp.restaurar(r);
    const restaurado = cb.items()[0];
    expect(restaurado.types.sort()).toEqual(['image/png', 'text/html', 'text/plain']);
    expect(await (await restaurado.getType('text/html')).text()).toBe('<b>t</b>');
  });

  it('si estaba vacío, al restaurar lo deja vacío', async () => {
    const cb = fakeElectron([]);
    const pp = portapapelesElectron(cb, FakeItem);
    const r = await pp.respaldar();
    await pp.escribirTexto('nuevo');
    await pp.restaurar(r);
    expect(cb.items()).toEqual([]);
  });
});
