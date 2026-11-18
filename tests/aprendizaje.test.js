import { describe, it, expect, beforeEach } from 'vitest';
import { extraerCorrecciones, aprender, crearAprendiz } from '../src/main/aprendizaje.js';

describe('extraerCorrecciones', () => {
  const pegado = 'Hola, hablé con Avalon sobre el pedido de Arauca.';

  it('detecta una palabra corregida', () => {
    const antes = `Mensaje: ${pegado}`;
    const despues = 'Mensaje: Hola, hablé con Avalom sobre el pedido de Arauca.';
    expect(extraerCorrecciones(antes, despues, pegado)).toEqual([{ de: 'Avalon', a: 'Avalom' }]);
  });

  it('detecta un cambio solo de mayúsculas o tildes', () => {
    const p = 'vivo en arauca ahora';
    expect(extraerCorrecciones(p, 'vivo en Arauca ahora', p)).toEqual([{ de: 'arauca', a: 'Arauca' }]);
    const q = 'la camara es nueva';
    expect(extraerCorrecciones(q, 'la cámara es nueva', q)).toEqual([{ de: 'camara', a: 'cámara' }]);
  });

  it('une varias palabras en una (un nombre que Whisper partió)', () => {
    const p = 'abre wis per para mí';
    expect(extraerCorrecciones(p, 'abre Wispr para mí', p)).toEqual([{ de: 'wis per', a: 'Wispr' }]);
  });

  it('si el usuario corrige a propósito, aprende aunque las letras no se parezcan', () => {
    const p = 'abre alto fi para mí';
    expect(extraerCorrecciones(p, 'abre Higgsfield para mí', p)).toEqual([]);
    expect(extraerCorrecciones(p, 'abre Higgsfield para mí', p, { explicito: true })).toEqual([{ de: 'alto fi', a: 'Higgsfield' }]);
  });

  it('ignora lo que el usuario escribió de más', () => {
    expect(extraerCorrecciones(pegado, `${pegado} Gracias por todo.`, pegado)).toEqual([]);
  });

  it('ignora una reescritura (palabras que no se parecen)', () => {
    const p = 'necesito el informe mañana';
    expect(extraerCorrecciones(p, 'necesito el resumen mañana', p)).toEqual([]);
  });

  it('ignora cambios de palabras cortas y de números', () => {
    const p = 'son 10 cajas de la casa';
    expect(extraerCorrecciones(p, 'son 11 cajas de la casa', p)).toEqual([]);
    expect(extraerCorrecciones(p, 'son 10 cajas de el casa', p)).toEqual([]);
  });

  it('solo aprende de lo que pegó la app, no de otro texto del campo', () => {
    const antes = 'Nota previa con Avalon escrita a mano. Hola mundo';
    const despues = 'Nota previa con Avalom escrita a mano. Hola mundo';
    expect(extraerCorrecciones(antes, despues, 'Hola mundo')).toEqual([]);
  });

  it('no hace nada si el texto es muy distinto', () => {
    const largo = Array.from({ length: 500 }, (_, i) => `palabra${i}`).join(' ');
    const otro = Array.from({ length: 500 }, (_, i) => `otra${i}`).join(' ');
    expect(extraerCorrecciones(largo, otro, largo)).toEqual([]);
  });
});

describe('aprender', () => {
  let almacen;
  let n;
  beforeEach(() => {
    const datos = {};
    almacen = {
      leer: (k, def) => (k in datos ? JSON.parse(JSON.stringify(datos[k])) : def),
      escribir: (k, v) => { datos[k] = JSON.parse(JSON.stringify(v)); },
    };
    n = 0;
  });
  const gid = () => `id${++n}`;

  it('la palabra correcta entra enseguida, sin reemplazo todavía', () => {
    const r = aprender([{ de: 'Avalon', a: 'Avalom' }], almacen, gid);
    expect(r).toEqual(['Avalom']);
    expect(almacen.leer('diccionario').palabras).toEqual([{ id: 'id1', frase: 'Avalom', reemplazo: null, auto: true }]);
  });

  it('el reemplazo automático entra al repetirse la corrección', () => {
    aprender([{ de: 'Avalon', a: 'Avalom' }], almacen, gid);
    const r = aprender([{ de: 'avalon', a: 'Avalom' }], almacen, gid);
    expect(r).toEqual(['avalon → Avalom']);
    const dic = almacen.leer('diccionario');
    expect(dic.palabras[0]).toMatchObject({ frase: 'avalon', reemplazo: 'Avalom', auto: true });
    expect(dic.palabras).toHaveLength(2);
  });

  it('no duplica lo que ya está en el diccionario', () => {
    almacen.escribir('diccionario', { palabras: [{ id: 'x', frase: 'Avalom', reemplazo: null }], snippets: [] });
    expect(aprender([{ de: 'Avalon', a: 'Avalom' }], almacen, gid)).toEqual([]);
    expect(almacen.leer('diccionario').palabras).toHaveLength(1);
  });

  it('corrige cómo estaba escrita una palabra existente', () => {
    almacen.escribir('diccionario', { palabras: [{ id: 'x', frase: 'arauca', reemplazo: null }], snippets: [] });
    expect(aprender([{ de: 'arauca', a: 'Arauca' }], almacen, gid)).toEqual(['Arauca']);
    expect(almacen.leer('diccionario').palabras[0].frase).toBe('Arauca');
  });

  it('un cambio solo de mayúsculas nunca crea reemplazo', () => {
    aprender([{ de: 'arauca', a: 'Arauca' }], almacen, gid);
    aprender([{ de: 'arauca', a: 'Arauca' }], almacen, gid);
    expect(almacen.leer('diccionario').palabras).toHaveLength(1);
  });
});

describe('crearAprendiz', () => {
  it('vigila el campo y aprende cuando el texto se estabiliza', async () => {
    let t = 0;
    const lecturas = [
      'Hola, hablé con Avalon ayer.',
      'Hola, hablé con Avalon ayer.',
      'Hola, hablé con Avalom ayer.',
      'Hola, hablé con Avalom ayer.',
      'Hola, hablé con Avalom ayer.',
      'Hola, hablé con Avalom ayer.',
    ];
    let i = 0;
    const datos = {};
    const almacen = {
      leer: (k, d) => (k in datos ? JSON.parse(JSON.stringify(datos[k])) : d),
      escribir: (k, v) => { datos[k] = v; },
    };
    const avisos = [];
    const aprendiz = crearAprendiz({
      sistema: { textoEnfocado: async () => lecturas[Math.min(i++, lecturas.length - 1)] },
      almacen,
      esperar: async (ms) => { t += ms; },
      ahora: () => t,
      generarId: () => 'id',
      avisar: (m) => avisos.push(m),
      intervaloMs: 1000,
      estableMs: 2000,
      duracionMs: 20000,
    });
    await aprendiz.observar({ pulido: 'Hola, hablé con Avalon ayer.' });
    expect(avisos).toEqual(['Aprendí: Avalom']);
    expect(datos.diccionario.palabras[0].frase).toBe('Avalom');
  });

  it('no vigila si el campo no deja leer el texto pegado', async () => {
    let llamadas = 0;
    const aprendiz = crearAprendiz({
      sistema: { textoEnfocado: async () => { llamadas++; return null; } },
      almacen: { leer: () => ({}), escribir() {} },
      esperar: async () => {},
      ahora: () => 0,
      generarId: () => 'id',
      avisar() {},
    });
    await aprendiz.observar({ pulido: 'texto' });
    expect(llamadas).toBe(1);
  });

  it('una observación nueva cancela la anterior', async () => {
    let t = 0;
    const aprendiz = crearAprendiz({
      sistema: { textoEnfocado: async () => 'texto pegado aquí' },
      almacen: { leer: () => ({}), escribir() {} },
      esperar: async (ms) => { t += ms; },
      ahora: () => t,
      generarId: () => 'id',
      avisar() {},
      intervaloMs: 1000,
      duracionMs: 60000,
    });
    const primera = aprendiz.observar({ pulido: 'texto pegado aquí' });
    aprendiz.cancelar();
    await primera;
    expect(t).toBeLessThan(5000);
  });
});
