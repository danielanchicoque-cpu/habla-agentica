// Transcripción local con whisper.cpp: la app descarga el motor y un modelo
// (con huella SHA-256 fija, nada se ejecuta si no coincide), deja un servidor
// local con el modelo cargado y le manda cada audio por HTTP (127.0.0.1).
//
// Todo lo que toca el sistema (red, procesos, descomprimir, reloj) llega por
// parámetros para poder probarlo sin descargar nada.

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const WHISPER_CPP = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2';
// Commit fijo del repositorio de modelos: el archivo no puede cambiar de contenido.
const MODELOS_HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1';

const MODELOS = {
  small: {
    archivo: 'ggml-small-q5_1.bin',
    url: `${MODELOS_HF}/ggml-small-q5_1.bin`,
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
    bytes: 190085487,
  },
  turbo: {
    archivo: 'ggml-large-v3-turbo-q5_0.bin',
    url: `${MODELOS_HF}/ggml-large-v3-turbo-q5_0.bin`,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    bytes: 574041195,
  },
};

const PAQUETES = {
  cpu: {
    id: 'cpu',
    nombre: 'Ligero (cualquier computador)',
    detalle: 'Funciona en cualquier PC. Tarda unos segundos por dictado.',
    motor: {
      archivo: 'whisper-bin-x64.zip',
      url: `${WHISPER_CPP}/whisper-bin-x64.zip`,
      sha256: '49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a',
      bytes: 8194445,
    },
    modelo: 'small',
  },
  cuda: {
    id: 'cuda',
    nombre: 'Rápido (tarjeta NVIDIA)',
    detalle: 'Usa tu tarjeta gráfica NVIDIA. Menos de medio segundo por dictado.',
    motor: {
      archivo: 'whisper-cublas-12.4.0-bin-x64.zip',
      url: `${WHISPER_CPP}/whisper-cublas-12.4.0-bin-x64.zip`,
      sha256: '443110ddaad70d4290ab2e77179e31cf712035bbc4fad56bb4519a90c917b39c',
      bytes: 670611449,
    },
    modelo: 'turbo',
  },
};

const INACTIVO_MS = 30 * 60 * 1000; // sin dictar este tiempo, se libera la memoria
const ESPERA_ARRANQUE_MS = 90 * 1000;
const TIMEOUT_TRANSCRIPCION_MS = 60 * 1000;

class ErrorLocal extends Error {
  constructor(tipo, mensaje) {
    super(mensaje || tipo);
    this.name = 'ErrorLocal';
    this.tipo = tipo; // sin-instalar | arranque | transcripcion
  }
}

function hashArchivo(ruta) {
  return new Promise((resolver, rechazar) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(ruta).on('data', (d) => h.update(d)).on('error', rechazar).on('end', () => resolver(h.digest('hex')));
  });
}

function puertoLibre() {
  return new Promise((resolver, rechazar) => {
    const s = net.createServer();
    s.on('error', rechazar);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolver(port));
    });
  });
}

// Descomprime con el tar que trae Windows 10 y 11 (entiende .zip).
function extraerConTar(zip, destino) {
  return new Promise((resolver, rechazar) => {
    fs.mkdirSync(destino, { recursive: true });
    execFile('tar.exe', ['-xf', zip, '-C', destino], { windowsHide: true, maxBuffer: 1 << 20 }, (error, _salida, stderr) => {
      if (error) rechazar(new Error(`No se pudo descomprimir el motor: ${(stderr || error.message).toString().slice(0, 200)}`));
      else resolver();
    });
  });
}

function buscarArchivo(dir, nombre) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = buscarArchivo(ruta, nombre);
      if (r) return r;
    } else if (e.name.toLowerCase() === nombre) {
      return ruta;
    }
  }
  return null;
}

// Si la app se cerró a la fuerza, su servidor pudo quedar vivo ocupando la
// memoria. Solo se cierra un proceso que de verdad sea whisper-server.exe.
function cerrarServidorHuerfano(rutaPid) {
  return new Promise((resolver) => {
    let pid;
    try { pid = Number(fs.readFileSync(rutaPid, 'utf8').trim()); } catch { resolver(); return; }
    fs.rmSync(rutaPid, { force: true });
    if (!Number.isInteger(pid) || pid <= 0) { resolver(); return; }
    execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (error, salida) => {
      if (error || !/whisper-server\.exe/i.test(String(salida))) { resolver(); return; }
      execFile('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true, timeout: 5000 }, () => resolver());
    });
  });
}

// ¿Hay tarjeta NVIDIA? Sirve para recomendar el paquete rápido.
function detectarHardware({ ejecutar = execFile } = {}) {
  return new Promise((resolver) => {
    ejecutar('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 5000 }, (error, salida) => {
      if (error || !salida) { resolver({ nvidia: false, gpu: null, vramMB: 0 }); return; }
      const [nombre, memoria] = String(salida).split('\n')[0].split(',').map((s) => s.trim());
      const vramMB = Number(memoria) || 0;
      resolver({ nvidia: true, gpu: nombre || 'NVIDIA', vramMB });
    });
  });
}

function crearMotorLocal({
  dir,
  fetchFn = fetch,
  extraer = extraerConTar,
  lanzar = spawn,
  elegirPuerto = puertoLibre,
  limpiarHuerfano = cerrarServidorHuerfano,
  alCambiar = () => {},
  programar = setTimeout,
  cancelarProgramado = clearTimeout,
  inactivoMs = INACTIVO_MS,
  hilos = 6,
  catalogo = { paquetes: PAQUETES, modelos: MODELOS },
}) {
  const rutaEstado = path.join(dir, 'estado.json');
  const rutaPid = path.join(dir, 'servidor.pid');
  const dirMotor = (id) => path.join(dir, 'motor', id);
  const dirModelos = path.join(dir, 'modelos');

  let instalado = null; // { variante } o null
  let instalando = null; // { variante, etapa, progreso, abortar }
  let error = null;
  let servidor = null; // { proceso, puerto }
  let arrancando = null;
  let temporizadorInactivo = null;

  try {
    const leido = JSON.parse(fs.readFileSync(rutaEstado, 'utf8'));
    if (leido && catalogo.paquetes[leido.variante]) instalado = { variante: leido.variante };
  } catch { /* sin instalar */ }

  const estado = () => ({
    instalado: !!instalado,
    variante: instalado ? instalado.variante : null,
    nombre: instalado ? catalogo.paquetes[instalado.variante].nombre : null,
    instalando: !!instalando,
    etapa: instalando ? instalando.etapa : null,
    progreso: instalando ? instalando.progreso : 0,
    listo: !!servidor,
    error,
  });
  const avisar = () => alCambiar(estado());

  // ---------- descarga verificada ----------
  async function descargarVerificado({ url, destino, sha256, bytes }, alProgreso, senal) {
    if (fs.existsSync(destino) && (await hashArchivo(destino)) === sha256) { alProgreso(1); return; }
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    const parcial = `${destino}.parcial`;
    const res = await fetchFn(url, { signal: senal });
    if (!res.ok) throw new Error(`La descarga falló (código ${res.status}).`);
    const total = Number(res.headers.get('content-length')) || bytes;
    const h = crypto.createHash('sha256');
    let recibido = 0;
    const medir = new Transform({
      transform(trozo, _enc, listo) {
        h.update(trozo);
        recibido += trozo.length;
        alProgreso(Math.min(1, recibido / total));
        listo(null, trozo);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body), medir, fs.createWriteStream(parcial));
    } catch (e) {
      fs.rmSync(parcial, { force: true });
      throw e;
    }
    if (h.digest('hex') !== sha256) {
      fs.rmSync(parcial, { force: true });
      throw new Error('El archivo descargado no coincide con la huella esperada, por seguridad no se usó.');
    }
    fs.renameSync(parcial, destino);
  }

  async function instalar(variante) {
    const paquete = catalogo.paquetes[variante];
    if (!paquete) throw new Error('Paquete desconocido');
    if (instalando) return estado();
    const control = new AbortController();
    instalando = { variante, etapa: 'motor', progreso: 0, abortar: () => control.abort() };
    error = null;
    avisar();
    try {
      const modelo = catalogo.modelos[paquete.modelo];
      const zip = path.join(dir, 'descargas', paquete.motor.archivo);
      const peso = paquete.motor.bytes + modelo.bytes;
      const avance = (parteAntes, parteBytes) => (f) => {
        instalando.progreso = (parteAntes + f * parteBytes) / peso;
        avisar();
      };
      instalando.etapa = 'motor';
      await descargarVerificado({ ...paquete.motor, destino: zip }, avance(0, paquete.motor.bytes), control.signal);
      instalando.etapa = 'modelo';
      await descargarVerificado({ ...modelo, destino: path.join(dirModelos, modelo.archivo) }, avance(paquete.motor.bytes, modelo.bytes), control.signal);
      instalando.etapa = 'extrayendo';
      instalando.progreso = 1;
      avisar();
      await detener();
      fs.rmSync(dirMotor(variante), { recursive: true, force: true });
      await extraer(zip, dirMotor(variante));
      if (!buscarArchivo(dirMotor(variante), 'whisper-server.exe')) throw new Error('El motor descargado no trae el servidor esperado.');
      fs.rmSync(path.join(dir, 'descargas'), { recursive: true, force: true });
      fs.writeFileSync(rutaEstado, JSON.stringify({ variante, instaladoEn: new Date().toISOString() }));
      instalado = { variante };
    } catch (e) {
      error = control.signal.aborted ? 'Instalación cancelada.' : e.message;
    } finally {
      instalando = null;
      avisar();
    }
    return estado();
  }

  function cancelarInstalacion() {
    if (instalando) instalando.abortar();
  }

  async function quitar() {
    cancelarInstalacion();
    await detener();
    fs.rmSync(dir, { recursive: true, force: true });
    instalado = null;
    error = null;
    avisar();
    return estado();
  }

  // ---------- servidor ----------
  function rutasInstaladas() {
    const paquete = catalogo.paquetes[instalado.variante];
    const exe = buscarArchivo(dirMotor(instalado.variante), 'whisper-server.exe');
    const modelo = path.join(dirModelos, catalogo.modelos[paquete.modelo].archivo);
    if (!exe || !fs.existsSync(modelo)) throw new ErrorLocal('sin-instalar', 'Faltan archivos del modo local. Instálalo de nuevo en Ajustes.');
    return { exe, modelo, gpu: paquete.id === 'cuda' };
  }

  async function esperarServidor(puerto, proceso) {
    const limite = Date.now() + ESPERA_ARRANQUE_MS;
    while (Date.now() < limite) {
      if (proceso.salio) throw new ErrorLocal('arranque', mensajeSalida(proceso.codigo));
      try {
        await fetchFn(`http://127.0.0.1:${puerto}/`, { signal: AbortSignal.timeout(2000) });
        return;
      } catch { /* todavía cargando el modelo */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new ErrorLocal('arranque', 'El motor local tardó demasiado en arrancar.');
  }

  function mensajeSalida(codigo) {
    // 0xC0000135: Windows no encontró una DLL (casi siempre el runtime de Visual C++).
    if (codigo === 3221225781 || codigo === -1073741515) {
      return 'Al motor local le falta "Microsoft Visual C++ Redistributable". Instálalo desde microsoft.com y reintenta.';
    }
    return `El motor local se cerró al arrancar (código ${codigo}).`;
  }

  async function iniciar() {
    if (!instalado) throw new ErrorLocal('sin-instalar', 'El modo local no está instalado. Instálalo en Ajustes.');
    if (servidor) return servidor;
    if (arrancando) return arrancando;
    arrancando = (async () => {
      const { exe, modelo, gpu } = rutasInstaladas();
      await limpiarHuerfano(rutaPid);
      const puerto = await elegirPuerto();
      const args = ['-m', modelo, '-l', 'es', '-t', String(gpu ? 4 : hilos), '--host', '127.0.0.1', '--port', String(puerto), '-nt', '-sns'];
      const proceso = lanzar(exe, args, { cwd: path.dirname(exe), windowsHide: true, stdio: 'ignore' });
      proceso.salio = false;
      if (proceso.pid) { try { fs.writeFileSync(rutaPid, String(proceso.pid)); } catch { /* sin permiso: solo se pierde la limpieza */ } }
      proceso.on('error', () => { proceso.salio = true; proceso.codigo = -1; });
      proceso.on('exit', (codigo) => {
        proceso.salio = true;
        proceso.codigo = codigo;
        if (servidor && servidor.proceso === proceso) { servidor = null; avisar(); }
      });
      try {
        await esperarServidor(puerto, proceso);
      } catch (e) {
        try { proceso.kill(); } catch { /* ya terminó */ }
        throw e;
      }
      servidor = { proceso, puerto };
      avisar();
      return servidor;
    })();
    try {
      return await arrancando;
    } finally {
      arrancando = null;
    }
  }

  async function detener() {
    if (temporizadorInactivo) { cancelarProgramado(temporizadorInactivo); temporizadorInactivo = null; }
    const s = servidor;
    servidor = null;
    if (s) {
      try { s.proceso.kill(); } catch { /* ya terminó */ }
      fs.rmSync(rutaPid, { force: true });
      avisar();
    }
  }

  function reiniciarTemporizador() {
    if (temporizadorInactivo) cancelarProgramado(temporizadorInactivo);
    temporizadorInactivo = programar(() => { temporizadorInactivo = null; detener(); }, inactivoMs);
    if (temporizadorInactivo && temporizadorInactivo.unref) temporizadorInactivo.unref();
  }

  // ---------- transcripción ----------
  async function pedir(s, wav, pista, idioma) {
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
    form.append('response_format', 'json');
    form.append('language', idioma);
    form.append('temperature', '0.0');
    if (pista) form.append('prompt', pista);
    const res = await fetchFn(`http://127.0.0.1:${s.puerto}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(TIMEOUT_TRANSCRIPCION_MS) });
    if (!res.ok) throw new ErrorLocal('transcripcion', `El motor local respondió ${res.status}.`);
    const json = await res.json();
    if (json.error) throw new ErrorLocal('transcripcion', String(json.error).slice(0, 200));
    return String(json.text || '').replace(/\s+/g, ' ').trim();
  }

  async function transcribir({ wav, pista, idioma = 'es' }) {
    let s = await iniciar();
    try {
      try {
        return await pedir(s, wav, pista, idioma);
      } catch (e) {
        if (e instanceof ErrorLocal) throw e;
        // El servidor murió o dejó de contestar: se reinicia una vez.
        await detener();
        s = await iniciar();
        return await pedir(s, wav, pista, idioma);
      }
    } catch (e) {
      throw e instanceof ErrorLocal ? e : new ErrorLocal('transcripcion', `No se pudo transcribir en local: ${e.message}`);
    } finally {
      reiniciarTemporizador();
    }
  }

  return {
    estado,
    instalar,
    cancelarInstalacion,
    quitar,
    iniciar,
    detener,
    transcribir,
    instalado: () => !!instalado,
    paquetes: () => Object.values(catalogo.paquetes).map((p) => ({
      id: p.id,
      nombre: p.nombre,
      detalle: p.detalle,
      megas: Math.round((p.motor.bytes + catalogo.modelos[p.modelo].bytes) / 1e6),
    })),
  };
}

module.exports = { crearMotorLocal, detectarHardware, ErrorLocal, PAQUETES, MODELOS };
