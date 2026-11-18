import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { crearMotorLocal, detectarHardware, ErrorLocal, PAQUETES, MODELOS } from '../src/main/motorLocal.js';

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const ZIP = Buffer.from('zip-falso-del-motor');
const MODELO = Buffer.from('modelo-falso-de-voz');

const catalogo = {
  paquetes: {
    cpu: {
      id: 'cpu', nombre: 'Ligero', detalle: 'x', modelo: 'm',
      motor: { archivo: 'motor.zip', url: 'https://ejemplo.test/motor.zip', sha256: sha(ZIP), bytes: ZIP.length },
    },
  },
  modelos: { m: { archivo: 'm.bin', url: 'https://ejemplo.test/m.bin', sha256: sha(MODELO), bytes: MODELO.length } },
};

const respuesta = (buf, estado = 200) => new Response(buf, { status: estado, headers: { 'content-length': String(buf.length) } });

let dir;
let peticiones;
let procesos;
let enEscucha;

// Servidor falso: sabe contestar "/" e "/inference".
function crearFetch({ zip = ZIP, modelo = MODELO, texto = ' Hola, mundo.\n', fallaInferencia = null } = {}) {
  return async (url, opciones = {}) => {
    peticiones.push({ url, opciones });
    if (url.endsWith('motor.zip')) return respuesta(zip);
    if (url.endsWith('m.bin')) return respuesta(modelo);
    if (url.endsWith('/inference')) {
      if (fallaInferencia) throw fallaInferencia();
      return new Response(JSON.stringify({ text: texto }), { status: 200 });
    }
    if (/^http:\/\/127\.0\.0\.1:\d+\/$/.test(url)) {
      if (!enEscucha) throw new Error('conexión rechazada');
      return new Response('ok', { status: 200 });
    }
    throw new Error(`URL inesperada: ${url}`);
  };
}

function lanzarFalso({ saleAlArrancar = null } = {}) {
  return (exe, args, opciones) => {
    const p = new EventEmitter();
    p.pid = 4242;
    p.args = args;
    p.exe = exe;
    p.opciones = opciones;
    p.kill = () => { p.killed = true; enEscucha = false; setImmediate(() => p.emit('exit', 0)); };
    procesos.push(p);
    if (saleAlArrancar !== null) setImmediate(() => p.emit('exit', saleAlArrancar));
    else enEscucha = true;
    return p;
  };
}

const extraerFalso = async (_zip, destino) => {
  fs.mkdirSync(path.join(destino, 'Release'), { recursive: true });
  fs.writeFileSync(path.join(destino, 'Release', 'whisper-server.exe'), 'exe');
};

function crear(extra = {}) {
  const eventos = [];
  const motor = crearMotorLocal({
    dir,
    catalogo,
    fetchFn: crearFetch(),
    extraer: extraerFalso,
    lanzar: lanzarFalso(),
    elegirPuerto: async () => 5555,
    limpiarHuerfano: async () => {},
    alCambiar: (e) => eventos.push(e),
    ...extra,
  });
  return { motor, eventos };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'motor-local-'));
  peticiones = [];
  procesos = [];
  enEscucha = false;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('catálogo', () => {
  it('trae huellas SHA-256 de 64 caracteres y direcciones fijas', () => {
    for (const p of Object.values(PAQUETES)) {
      expect(p.motor.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(p.motor.url).toMatch(/^https:\/\/github\.com\/ggml-org\/whisper\.cpp\/releases\/download\/v1\.9\.2\//);
    }
    for (const m of Object.values(MODELOS)) {
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.url).toMatch(/^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/[0-9a-f]{40}\//);
    }
  });
});

describe('instalar', () => {
  it('descarga, verifica, descomprime y recuerda la instalación', async () => {
    const { motor, eventos } = crear();
    expect(motor.instalado()).toBe(false);
    const e = await motor.instalar('cpu');
    expect(e).toMatchObject({ instalado: true, variante: 'cpu', instalando: false, error: null });
    expect(fs.readFileSync(path.join(dir, 'modelos', 'm.bin'))).toEqual(MODELO);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'estado.json'), 'utf8')).variante).toBe('cpu');
    expect(fs.existsSync(path.join(dir, 'descargas'))).toBe(false); // el zip se borra
    const progresos = eventos.filter((x) => x.instalando).map((x) => x.progreso);
    expect(Math.max(...progresos)).toBe(1);
    // Otra instancia lee lo ya instalado.
    expect(crear().motor.instalado()).toBe(true);
  });

  it('rechaza una descarga con otra huella y no deja archivos', async () => {
    const { motor } = crear({ fetchFn: crearFetch({ modelo: Buffer.from('modelo-alterado!!') }) });
    const e = await motor.instalar('cpu');
    expect(e.instalado).toBe(false);
    expect(e.error).toContain('huella');
    expect(fs.existsSync(path.join(dir, 'modelos', 'm.bin'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'modelos', 'm.bin.parcial'))).toBe(false);
  });

  it('informa si la descarga falla por el servidor', async () => {
    const fetchFn = async () => respuesta(Buffer.from(''), 404);
    const e = await crear({ fetchFn }).motor.instalar('cpu');
    expect(e.error).toContain('404');
    expect(e.instalado).toBe(false);
  });

  it('no vuelve a descargar un archivo que ya está y es correcto', async () => {
    const { motor } = crear();
    await motor.instalar('cpu');
    peticiones.length = 0;
    fs.mkdirSync(path.join(dir, 'descargas'), { recursive: true });
    await motor.instalar('cpu');
    // El zip se baja otra vez (se borró), pero el modelo ya verificado no.
    expect(peticiones.some((p) => p.url.endsWith('m.bin'))).toBe(false);
  });

  it('se puede cancelar a mitad', async () => {
    let motorRef;
    const fetchFn = async (_url, { signal }) => {
      motorRef.cancelarInstalacion();
      if (signal.aborted) throw Object.assign(new Error('abortado'), { name: 'AbortError' });
      return respuesta(ZIP);
    };
    const { motor } = crear({ fetchFn });
    motorRef = motor;
    const e = await motor.instalar('cpu');
    expect(e.error).toBe('Instalación cancelada.');
    expect(e.instalado).toBe(false);
  });

  it('falla si el motor descomprimido no trae el servidor', async () => {
    const { motor } = crear({ extraer: async (_z, destino) => fs.mkdirSync(destino, { recursive: true }) });
    const e = await motor.instalar('cpu');
    expect(e.error).toContain('servidor');
    expect(e.instalado).toBe(false);
  });

  it('quitar borra todo y deja el motor sin instalar', async () => {
    const { motor } = crear();
    await motor.instalar('cpu');
    const e = await motor.quitar();
    expect(e.instalado).toBe(false);
    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe('transcribir', () => {
  async function instalado(extra) {
    const c = crear(extra);
    await c.motor.instalar('cpu');
    return c;
  }

  it('sin instalar avisa con un error claro', async () => {
    const { motor } = crear();
    await expect(motor.transcribir({ wav: Buffer.from('w') })).rejects.toMatchObject({ tipo: 'sin-instalar' });
  });

  it('arranca el servidor local con el modelo y manda el audio con la pista', async () => {
    const { motor } = await instalado();
    const texto = await motor.transcribir({ wav: Buffer.from('RIFF-falso'), pista: 'Avalom, Kabi' });
    expect(texto).toBe('Hola, mundo.');
    const p = procesos[0];
    expect(p.exe.endsWith('whisper-server.exe')).toBe(true);
    expect(p.args).toEqual(expect.arrayContaining(['-m', path.join(dir, 'modelos', 'm.bin'), '-l', 'es', '--host', '127.0.0.1', '--port', '5555']));
    const post = peticiones.find((x) => x.url.endsWith('/inference'));
    expect(post.url).toBe('http://127.0.0.1:5555/inference');
    const form = post.opciones.body;
    expect(form.get('prompt')).toBe('Avalom, Kabi');
    expect(form.get('language')).toBe('es');
    expect(form.get('response_format')).toBe('json');
    expect(await form.get('file').text()).toBe('RIFF-falso');
  });

  it('reutiliza el mismo servidor en varios dictados', async () => {
    const { motor } = await instalado();
    await motor.transcribir({ wav: Buffer.from('a') });
    await motor.transcribir({ wav: Buffer.from('b') });
    expect(procesos).toHaveLength(1);
  });

  it('si el servidor murió, lo reinicia y reintenta una vez', async () => {
    const normal = crearFetch();
    let intentos = 0;
    const { motor } = await instalado({
      fetchFn: async (url, o) => {
        // El primer pedido de transcripción falla como si el servidor hubiera muerto.
        if (url.endsWith('/inference') && intentos++ === 0) throw new TypeError('fetch failed');
        return normal(url, o);
      },
    });
    expect(await motor.transcribir({ wav: Buffer.from('a') })).toBe('Hola, mundo.');
    expect(intentos).toBe(2);
    expect(procesos).toHaveLength(2); // el servidor se volvió a lanzar
    expect(procesos[0].killed).toBe(true);
  });

  it('si el servidor sigue caído tras el reintento, informa el error', async () => {
    const normal = crearFetch();
    const { motor } = await instalado({
      fetchFn: async (url, o) => {
        if (url.endsWith('/inference')) throw new TypeError('fetch failed');
        return normal(url, o);
      },
    });
    await expect(motor.transcribir({ wav: Buffer.from('a') })).rejects.toMatchObject({ tipo: 'transcripcion' });
  });

  it('un error del servidor se informa sin reintentar', async () => {
    const fetchFn = async (url) => {
      if (url.endsWith('/inference')) return new Response(JSON.stringify({ error: 'audio inválido' }), { status: 200 });
      if (url.endsWith('motor.zip')) return respuesta(ZIP);
      if (url.endsWith('m.bin')) return respuesta(MODELO);
      return new Response('ok');
    };
    const { motor } = await instalado({ fetchFn });
    await expect(motor.transcribir({ wav: Buffer.from('a') })).rejects.toMatchObject({ tipo: 'transcripcion', message: 'audio inválido' });
  });

  it('si el servidor se cierra al arrancar por falta de Visual C++, lo explica', async () => {
    const { motor } = await instalado({ lanzar: lanzarFalso({ saleAlArrancar: 3221225781 }) });
    const e = await motor.transcribir({ wav: Buffer.from('a') }).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorLocal);
    expect(e.tipo).toBe('arranque');
    expect(e.message).toContain('Visual C++');
  });

  it('apaga el servidor tras un rato sin usarse', async () => {
    const pendientes = [];
    const { motor } = await instalado({
      programar: (fn) => { pendientes.push(fn); return { unref() {} }; },
      cancelarProgramado: () => {},
    });
    await motor.transcribir({ wav: Buffer.from('a') });
    expect(motor.estado().listo).toBe(true);
    pendientes.at(-1)();
    expect(motor.estado().listo).toBe(false);
    expect(procesos[0].killed).toBe(true);
  });

  it('detener cierra el servidor', async () => {
    const { motor } = await instalado();
    await motor.transcribir({ wav: Buffer.from('a') });
    await motor.detener();
    expect(procesos[0].killed).toBe(true);
    expect(motor.estado().listo).toBe(false);
  });
});

describe('detectarHardware', () => {
  it('reconoce una tarjeta NVIDIA', async () => {
    const ejecutar = (_c, _a, _o, cb) => cb(null, 'NVIDIA GeForce RTX 4050 Laptop GPU, 6141\n');
    expect(await detectarHardware({ ejecutar })).toEqual({ nvidia: true, gpu: 'NVIDIA GeForce RTX 4050 Laptop GPU', vramMB: 6141 });
  });
  it('sin nvidia-smi dice que no hay', async () => {
    const ejecutar = (_c, _a, _o, cb) => cb(new Error('no existe'));
    expect(await detectarHardware({ ejecutar })).toEqual({ nvidia: false, gpu: null, vramMB: 0 });
  });
});
