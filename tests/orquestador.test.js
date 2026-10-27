import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crearOrquestador } from '../src/main/orquestador.js';
import { crearAlmacen } from '../src/main/almacen.js';
import { copiaFabrica } from '../src/main/promptsFabrica.js';
import { ErrorGroq } from '../src/main/groq.js';

let dir;
let almacen;
let pegados;
let llamadasPulir;
let llamadasTranscribir;
let estados;
let enviados;
let deps;

const esperarCola = (o) => o.colaVacia();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-'));
  almacen = crearAlmacen(dir);
  almacen.escribir('prompts', copiaFabrica());
  almacen.escribir('diccionario', {
    palabras: [{ id: 'p', frase: 'Avalom', reemplazo: null }],
    snippets: [{ id: 's', frase: 'Claude Peligroso', texto: 'claude --dangerously-skip-permissions ' }],
  });
  almacen.escribir('ajustes', { silenciarAudio: true, sonidos: true, micId: 'mic1', modeloVoz: 'whisper-large-v3-turbo', modeloPulido: 'openai/gpt-oss-120b' });
  pegados = [];
  llamadasPulir = [];
  llamadasTranscribir = 0;
  estados = [];
  enviados = [];
  let n = 0;
  deps = {
    almacen,
    dirAudios: path.join(dir, 'audios'),
    generarId: () => `id${++n}`,
    ahora: () => new Date('2026-10-16T12:00:00Z'),
    secretos: { obtenerKey: async () => 'gsk_k' },
    sistema: { procesoActivo: async () => 'claude', silenciar: async () => enviados.push('silenciar'), restaurarAudio: async () => enviados.push('restaurar') },
    pegador: { pegar: async (t) => { pegados.push(t); }, copiarSeleccion: async () => '' },
    pastilla: { enviar: (canal, ...args) => enviados.push(canal) },
    groq: {
      transcribir: async () => { llamadasTranscribir++; return 'eh hola avalom'; },
      pulir: async (op) => { llamadasPulir.push(op); return 'Hola, Avalom.'; },
    },
  };
});

function crear(extra = {}) {
  const o = crearOrquestador({ ...deps, ...extra });
  o.on('estado', (e, t) => estados.push(t ? `${e}:${t}` : e));
  return o;
}

async function dictar(o, dur = 3, modo = 'dictado') {
  o.iniciar(modo);
  await o.detener();
  o.recibirAudio(Buffer.from('audio'), dur);
  await esperarCola(o);
}

describe('orquestador', () => {
  it('camino feliz: pega el texto pulido con el prompt de la app', async () => {
    const o = crear();
    await dictar(o);
    expect(pegados).toEqual(['Hola, Avalom.']);
    expect(llamadasPulir[0].texto).toBe('eh hola Avalom');
    expect(llamadasPulir[0].instruccionSistema).toContain('asistente de IA');
    const h = almacen.leer('historial', []);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ id: 'id1', estado: 'pulido', promptUsado: 'claude-ia', app: 'claude', crudo: 'eh hola avalom', pulido: 'Hola, Avalom.', duracionSeg: 3, palabras: 2 });
    expect(enviados).toEqual(expect.arrayContaining(['grabar:iniciar', 'restaurar', 'grabar:detener']));
  });

  it('si el pulido falla pega el texto crudo con diccionario', async () => {
    const o = crear({ groq: { ...deps.groq, pulir: async () => { throw new ErrorGroq('timeout'); } } });
    await dictar(o);
    expect(pegados).toEqual(['eh hola Avalom']);
    expect(almacen.leer('historial', [])[0].estado).toBe('crudo');
    expect(estados).toContain('aviso:Pegado sin pulir');
  });

  it('si la transcripción falla guarda el audio y no pega', async () => {
    const o = crear({ groq: { ...deps.groq, transcribir: async () => { throw new ErrorGroq('red'); } } });
    await dictar(o);
    expect(pegados).toEqual([]);
    const h = almacen.leer('historial', [])[0];
    expect(h.estado).toBe('error');
    expect(fs.existsSync(path.join(deps.dirAudios, h.audio))).toBe(true);
    expect(estados).toContain('error:Sin conexión, audio guardado');
  });

  it('sin key avisa que revise la key', async () => {
    const o = crear({ secretos: { obtenerKey: async () => null } });
    await dictar(o);
    expect(estados).toContain('error:Revisa tu key de Groq');
    expect(pegados).toEqual([]);
  });

  it('una grabación de menos de 0,5 s no llama a Groq', async () => {
    const o = crear();
    await dictar(o, 0.3);
    expect(llamadasTranscribir).toBe(0);
    expect(almacen.leer('historial', [])[0].estado).toBe('vacio');
  });

  it('una grabación en silencio no llama a Groq (evita textos inventados como "Gracias.")', async () => {
    const o = crear();
    o.iniciar('dictado');
    await o.detener();
    o.recibirAudio(Buffer.from('audio'), 5, 0.004);
    await esperarCola(o);
    expect(llamadasTranscribir).toBe(0);
    expect(pegados).toEqual([]);
    expect(almacen.leer('historial', [])[0].estado).toBe('vacio');
  });

  it('descarta las frases que Whisper inventa sobre el silencio', async () => {
    for (const inventada of ['Gracias.', 'Subtítulos realizados por la comunidad de Amara.org', '¡Gracias por ver el video!']) {
      const o = crear({ groq: { ...deps.groq, transcribir: async () => inventada } });
      await dictar(o);
    }
    expect(pegados).toEqual([]);
    expect(llamadasPulir).toEqual([]);
  });

  it('"gracias" dentro de un dictado real sí se pega', async () => {
    const o = crear({ groq: { ...deps.groq, transcribir: async () => 'gracias por la ayuda con avalom' } });
    await dictar(o);
    expect(pegados).toHaveLength(1);
  });

  it('una grabación con voz sí se procesa', async () => {
    const o = crear();
    o.iniciar('dictado');
    await o.detener();
    o.recibirAudio(Buffer.from('audio'), 5, 0.2);
    await esperarCola(o);
    expect(llamadasTranscribir).toBe(1);
  });

  it('dos dictados seguidos se pegan en orden aunque el primero tarde más', async () => {
    let i = 0;
    const o = crear({
      groq: {
        transcribir: async () => { const yo = ++i; if (yo === 1) await new Promise((r) => setTimeout(r, 100)); return `texto ${yo}`; },
        pulir: async ({ texto }) => texto.toUpperCase(),
      },
    });
    o.iniciar('dictado'); await o.detener(); o.recibirAudio(Buffer.from('a'), 2);
    o.iniciar('dictado'); await o.detener(); o.recibirAudio(Buffer.from('b'), 2);
    await esperarCola(o);
    expect(pegados).toEqual(['TEXTO 1', 'TEXTO 2']);
  });

  it('modo comando aplica la orden a la selección', async () => {
    const o = crear({
      pegador: { pegar: async (t) => pegados.push(t), copiarSeleccion: async () => 'hola amigo' },
      groq: { transcribir: async () => 'más formal', pulir: async (op) => { llamadasPulir.push(op); return 'Saludos, estimado.'; } },
    });
    await dictar(o, 2, 'comando');
    expect(llamadasPulir[0].texto).toBe('hola amigo');
    expect(llamadasPulir[0].instruccionSistema).toContain('más formal');
    expect(pegados).toEqual(['Saludos, estimado.']);
    expect(almacen.leer('historial', [])[0].promptUsado).toBe('comando');
  });

  it('modo comando sin selección se comporta como dictado', async () => {
    const o = crear();
    await dictar(o, 2, 'comando');
    expect(llamadasPulir[0].texto).toBe('eh hola Avalom');
    expect(almacen.leer('historial', [])[0].promptUsado).toBe('claude-ia');
  });

  it('procesa el audio aunque llegue antes de que detener() termine', async () => {
    let soltarAudio;
    const o = crear({ sistema: { ...deps.sistema, restaurarAudio: () => new Promise((r) => { soltarAudio = r; }) } });
    o.iniciar('dictado');
    const fin = o.detener();
    o.recibirAudio(Buffer.from('audio'), 3);
    soltarAudio();
    await fin;
    await esperarCola(o);
    expect(pegados).toEqual(['Hola, Avalom.']);
  });

  it('I1: si pegar falla, el dictado queda guardado en el historial y avisa', async () => {
    const o = crear({ pegador: { pegar: async () => { throw new Error('portapapeles bloqueado'); }, copiarSeleccion: async () => '' } });
    await dictar(o);
    const h = almacen.leer('historial', []);
    expect(h).toHaveLength(1);
    expect(h[0].pulido).toBe('Hola, Avalom.');
    expect(estados).toContain('error:No se pudo pegar, quedó en el historial');
  });

  it('I1: si copiar la selección falla, el comando sigue como dictado', async () => {
    const o = crear({ pegador: { pegar: async (t) => pegados.push(t), copiarSeleccion: async () => { throw new Error('x'); } } });
    await dictar(o, 2, 'comando');
    expect(pegados).toEqual(['Hola, Avalom.']);
  });

  it('I3: mientras se graba otro dictado, no manda "reposo" a la pastilla', async () => {
    let soltar;
    const o = crear({ groq: { ...deps.groq, transcribir: () => new Promise((r) => { soltar = () => r('hola'); }) } });
    o.iniciar('dictado'); await o.detener(); o.recibirAudio(Buffer.from('a'), 2);
    await new Promise((r) => setTimeout(r, 10));
    o.iniciar('dictado'); // segunda grabación en curso
    soltar();
    await new Promise((r) => setTimeout(r, 10));
    expect(estados).not.toContain('reposo');
  });

  it('I4: una orden que coincide con un comando guardado usa su texto', async () => {
    const prompts = almacen.leer('prompts', null);
    prompts.comandos.find((c) => c.id === 'formal').texto = 'TEXTO EDITADO POR EL USUARIO';
    almacen.escribir('prompts', prompts);
    const o = crear({
      pegador: { pegar: async (t) => pegados.push(t), copiarSeleccion: async () => 'hola amigo' },
      groq: { transcribir: async () => 'Más formal.', pulir: async (op) => { llamadasPulir.push(op); return 'x'; } },
    });
    await dictar(o, 2, 'comando');
    expect(llamadasPulir[0].instruccionSistema).toContain('TEXTO EDITADO POR EL USUARIO');
  });

  it('I5: en una terminal, el modo comando no manda Ctrl+C', async () => {
    let copio = false;
    const o = crear({
      sistema: { ...deps.sistema, procesoActivo: async () => 'WindowsTerminal' },
      pegador: { pegar: async (t) => pegados.push(t), copiarSeleccion: async () => { copio = true; return 'linea'; } },
    });
    await dictar(o, 2, 'comando');
    expect(copio).toBe(false);
  });

  it('no silencia al iniciar: espera a que la pastilla avise que ya sonó el tono', async () => {
    const o = crear();
    o.iniciar('dictado');
    expect(enviados).not.toContain('silenciar');
    o.grabacionIniciada();
    await new Promise((r) => setTimeout(r, 250));
    expect(enviados).toContain('silenciar');
  });

  it('si se detiene antes de silenciar, ya no silencia', async () => {
    const o = crear();
    o.iniciar('dictado');
    o.grabacionIniciada();
    await o.detener();
    await new Promise((r) => setTimeout(r, 250));
    expect(enviados).not.toContain('silenciar');
  });

  it('manos libres avisa a la pastilla', () => {
    const o = crear();
    o.iniciar('dictado');
    o.manosLibres();
    expect(enviados).toContain('grabar:manos-libres');
  });

  it('deshacer una cancelación procesa ese audio y lo pega', async () => {
    const o = crear();
    o.iniciar('dictado');
    await o.cancelar();
    o.deshacerCancelacion(Buffer.from('audio'), 3, 0.3);
    await esperarCola(o);
    expect(pegados).toEqual(['Hola, Avalom.']);
  });

  it('deshacer sin cancelación previa no hace nada', async () => {
    const o = crear();
    o.deshacerCancelacion(Buffer.from('audio'), 3, 0.3);
    await esperarCola(o);
    expect(llamadasTranscribir).toBe(0);
  });

  it('cancelar descarta el audio que llegue después', async () => {
    const o = crear();
    o.iniciar('dictado');
    await o.cancelar();
    o.recibirAudio(Buffer.from('x'), 3);
    await esperarCola(o);
    expect(llamadasTranscribir).toBe(0);
    expect(enviados).toContain('grabar:cancelar');
  });

  it('un snippet exacto se pega tal cual, sin pasar por la IA', async () => {
    const o = crear({ groq: { transcribir: async () => 'Claude peligroso.', pulir: async () => { throw new Error('no debía pulir'); } } });
    await dictar(o);
    expect(pegados).toEqual(['claude --dangerously-skip-permissions ']);
    expect(almacen.leer('historial', [])[0]).toMatchObject({ estado: 'pulido', promptUsado: 'snippet' });
  });

  it('un error de micrófono avisa y libera la grabación', async () => {
    const o = crear();
    o.iniciar('dictado');
    o.errorGrabacion('mic-no-encontrado');
    expect(estados).toContain('error:Micrófono no encontrado');
    o.iniciar('dictado');
    expect(enviados.filter((e) => e === 'grabar:iniciar')).toHaveLength(2);
  });

  it('reintentar reprocesa el audio guardado sin pegar', async () => {
    let falla = true;
    const o = crear({ groq: { transcribir: async () => { if (falla) throw new ErrorGroq('red'); return 'hola'; }, pulir: async () => 'Hola.' } });
    await dictar(o);
    falla = false;
    const id = almacen.leer('historial', [])[0].id;
    await o.reintentar(id);
    expect(pegados).toEqual([]);
    const h = almacen.leer('historial', []);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ id, estado: 'pulido', pulido: 'Hola.' });
  });

  it('limpia audios de más de 7 días salvo los de entradas con error', async () => {
    fs.mkdirSync(deps.dirAudios, { recursive: true });
    const viejo = path.join(deps.dirAudios, 'viejo.webm');
    const conError = path.join(deps.dirAudios, 'conerror.webm');
    fs.writeFileSync(viejo, 'a');
    fs.writeFileSync(conError, 'a');
    const hace8dias = new Date('2026-10-08T12:00:00Z');
    fs.utimesSync(viejo, hace8dias, hace8dias);
    fs.utimesSync(conError, hace8dias, hace8dias);
    almacen.escribir('historial', [{ id: 'e', estado: 'error', audio: 'conerror.webm' }]);
    crear().limpiarAudiosViejos();
    expect(fs.existsSync(viejo)).toBe(false);
    expect(fs.existsSync(conError)).toBe(true);
  });
});
