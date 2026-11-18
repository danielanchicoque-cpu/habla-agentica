import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crearOrquestador } from '../src/main/orquestador.js';
import { crearAlmacen } from '../src/main/almacen.js';
import { copiaFabrica } from '../src/main/promptsFabrica.js';
import { ErrorGroq } from '../src/main/groq.js';

// Dónde se transcribe (nube, local o automático) y qué pasa sin key de Groq.

let dir;
let almacen;
let pegados;
let estados;
let llamadas; // { groqVoz, groqPulir, local, aWav }
let deps;
let localInstalado;

const esperarCola = (o) => o.colaVacia();

function ajustes(extra) {
  almacen.escribir('ajustes', { silenciarAudio: false, sonidos: true, micId: 'mic1', ...extra });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-motor-'));
  almacen = crearAlmacen(dir);
  almacen.escribir('prompts', copiaFabrica());
  almacen.escribir('diccionario', { palabras: [{ id: 'p', frase: 'Avalom', reemplazo: null }], snippets: [] });
  ajustes({});
  pegados = [];
  estados = [];
  llamadas = { groqVoz: 0, groqPulir: 0, local: [], aWav: 0 };
  localInstalado = true;
  deps = {
    almacen,
    dirAudios: path.join(dir, 'audios'),
    generarId: (() => { let n = 0; return () => `id${++n}`; })(),
    ahora: () => new Date('2026-10-16T12:00:00Z'),
    secretos: { obtenerKey: async () => 'gsk_k' },
    sistema: { procesoActivo: async () => 'notepad', silenciar: async () => {}, restaurarAudio: async () => {} },
    pegador: { pegar: async (t) => { pegados.push(t); }, copiarSeleccion: async () => 'texto seleccionado' },
    pastilla: { enviar() {} },
    groq: {
      transcribir: async () => { llamadas.groqVoz++; return 'hola desde la nube avalom'; },
      pulir: async () => { llamadas.groqPulir++; return 'Hola desde la nube, Avalom.'; },
    },
    motorLocal: {
      instalado: () => localInstalado,
      transcribir: async (p) => { llamadas.local.push(p); return 'hola desde el computador avalom'; },
    },
    aWav: async (audio) => { llamadas.aWav++; return Buffer.concat([Buffer.from('WAV:'), audio]); },
  };
});

function crear(extra = {}) {
  const o = crearOrquestador({ ...deps, ...extra });
  o.on('estado', (e, t) => estados.push(t ? `${e}:${t}` : e));
  return o;
}

async function dictar(o, modo = 'dictado') {
  o.iniciar(modo);
  await o.detener();
  o.recibirAudio(Buffer.from('audio'), 3);
  await esperarCola(o);
}

const historial = () => almacen.leer('historial', []);

describe('modo nube (el de siempre)', () => {
  it('sin ajuste usa Groq y no toca el motor local', async () => {
    await dictar(crear());
    expect(llamadas.groqVoz).toBe(1);
    expect(llamadas.local).toHaveLength(0);
    expect(pegados).toEqual(['Hola desde la nube, Avalom.']);
    expect(historial()[0].motor).toBe('nube');
  });
});

describe('modo local', () => {
  beforeEach(() => ajustes({ motorVoz: 'local' }));

  it('convierte el audio, transcribe en el computador y no llama a Groq para la voz', async () => {
    await dictar(crear());
    expect(llamadas.groqVoz).toBe(0);
    expect(llamadas.aWav).toBe(1);
    expect(llamadas.local).toHaveLength(1);
    expect(llamadas.local[0].wav.toString()).toBe('WAV:audio');
    expect(historial()[0]).toMatchObject({ motor: 'local', crudo: 'hola desde el computador avalom' });
  });

  it('le pasa el diccionario como pista de vocabulario', async () => {
    await dictar(crear());
    expect(llamadas.local[0].pista).toBe('Avalom');
  });

  it('con key y pulido activado, pule el texto con Groq (solo texto)', async () => {
    await dictar(crear());
    expect(llamadas.groqPulir).toBe(1);
    expect(pegados).toEqual(['Hola desde la nube, Avalom.']);
  });

  it('sin key funciona: pega el texto con el diccionario, sin aviso de "sin pulir"', async () => {
    await dictar(crear({ secretos: { obtenerKey: async () => null } }));
    expect(llamadas.groqPulir).toBe(0);
    expect(pegados).toEqual(['hola desde el computador Avalom']);
    expect(historial()[0]).toMatchObject({ estado: 'crudo', motor: 'local' });
    expect(estados).not.toContain('aviso:Pegado sin pulir');
  });

  it('con "pulir en la nube" apagado no manda nada a Groq', async () => {
    ajustes({ motorVoz: 'local', pulirEnNube: false });
    await dictar(crear());
    expect(llamadas.groqVoz).toBe(0);
    expect(llamadas.groqPulir).toBe(0);
    expect(pegados).toEqual(['hola desde el computador Avalom']);
  });

  it('si no está instalado avisa, guarda el audio y no pega', async () => {
    localInstalado = false;
    await dictar(crear());
    expect(pegados).toEqual([]);
    expect(estados).toContain('error:Instala el modo local en Ajustes');
    expect(historial()[0]).toMatchObject({ estado: 'error', audio: 'id1.webm' });
    expect(fs.existsSync(path.join(deps.dirAudios, 'id1.webm'))).toBe(true);
  });

  it('si falla la conversión del audio avisa', async () => {
    await dictar(crear({ aWav: async () => { throw new Error('sin decodificador'); } }));
    expect(estados).toContain('error:No se pudo preparar el audio');
    expect(pegados).toEqual([]);
  });

  it('si el motor local falla avisa y guarda el audio para reintentar', async () => {
    const motorLocal = { instalado: () => true, transcribir: async () => { throw Object.assign(new Error('boom'), { tipo: 'transcripcion' }); } };
    await dictar(crear({ motorLocal }));
    expect(estados).toContain('error:Falló el modo local, audio guardado');
    expect(historial()[0].estado).toBe('error');
  });

  it('un comando de voz sin key avisa y no pega nada sobre la selección', async () => {
    await dictar(crear({ secretos: { obtenerKey: async () => null } }), 'comando');
    expect(pegados).toEqual([]);
    expect(estados).toContain('error:Los comandos necesitan la IA de Groq');
  });
});

describe('modo automático', () => {
  beforeEach(() => ajustes({ motorVoz: 'auto' }));

  it('con internet usa Groq', async () => {
    await dictar(crear());
    expect(llamadas.groqVoz).toBe(1);
    expect(llamadas.local).toHaveLength(0);
    expect(historial()[0].motor).toBe('nube');
  });

  it.each(['red', 'timeout', 'servidor'])('si Groq falla por "%s" sigue en local', async (tipo) => {
    const groq = { ...deps.groq, transcribir: async () => { throw new ErrorGroq(tipo); } };
    await dictar(crear({ groq }));
    expect(llamadas.local).toHaveLength(1);
    expect(historial()[0]).toMatchObject({ motor: 'local', estado: expect.not.stringMatching(/error/) });
    expect(pegados).toHaveLength(1);
  });

  it('si la key es inválida no cambia a local: avisa que revise la key', async () => {
    const groq = { ...deps.groq, transcribir: async () => { throw new ErrorGroq('key'); } };
    await dictar(crear({ groq }));
    expect(llamadas.local).toHaveLength(0);
    expect(estados).toContain('error:Revisa tu key de Groq');
  });

  it('sin key y con el modo local instalado, va directo a local', async () => {
    await dictar(crear({ secretos: { obtenerKey: async () => null } }));
    expect(llamadas.groqVoz).toBe(0);
    expect(llamadas.local).toHaveLength(1);
  });

  it('si Groq cae y el modo local no está instalado, avisa el error de Groq', async () => {
    localInstalado = false;
    const groq = { ...deps.groq, transcribir: async () => { throw new ErrorGroq('red'); } };
    await dictar(crear({ groq }));
    expect(estados).toContain('error:Sin conexión, audio guardado');
    expect(pegados).toEqual([]);
  });
});
