// Encadena el flujo completo: grabar → transcribir → diccionario → pulir →
// pegar → historial. Procesa los dictados en una cola, de uno en uno.
const fs = require('node:fs');
const path = require('node:path');
const { aplicarDiccionario, pistasWhisper, normalizar } = require('./diccionario');
const { elegirPrompt } = require('./selectorPrompt');
const { armarSistema, armarSistemaComando, ErrorGroq } = require('./groq');

const DURACION_MINIMA_SEG = 0.5;
// Volumen RMS máximo por debajo del cual la grabación se considera silencio.
const NIVEL_MINIMO_VOZ = 0.01;
// Espera tras empezar a grabar antes de silenciar, para que suene el tono.
const ESPERA_SILENCIAR_MS = 180;
const VENTANA_DESHACER_MS = 6000;
const DIAS_AUDIO = 7;

// Frases que Whisper suele inventar en español cuando solo hay silencio o
// ruido. Se descartan solo si son el dictado completo.
const ALUCINACIONES = [
  'gracias',
  'muchas gracias',
  'gracias por ver',
  'gracias por ver el video',
  'subtitulos realizados por la comunidad de amaraorg',
  'subtitulos por la comunidad de amaraorg',
  'suscribete',
  'suscribete al canal',
  'amaraorg',
];
const esAlucinacion = (texto) => ALUCINACIONES.includes(normalizar(texto).replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim());

// Fallas de conexión con Groq: en modo automático se reintenta en el motor local.
const ERRORES_DE_RED = ['red', 'timeout', 'servidor'];
const errorTipo = (tipo, mensaje) => Object.assign(new Error(mensaje), { tipo });

const MENSAJES = {
  key: 'Revisa tu key de Groq',
  'sin-instalar': 'Instala el modo local en Ajustes',
  arranque: 'El motor local no pudo arrancar',
  transcripcion: 'Falló el modo local, audio guardado',
  conversion: 'No se pudo preparar el audio',
  red: 'Sin conexión, audio guardado',
  timeout: 'Sin conexión, audio guardado',
  servidor: 'Groq falló, audio guardado',
  vacio: 'Groq falló, audio guardado',
  'mic-no-encontrado': 'Micrófono no encontrado',
  permiso: 'Sin permiso de micrófono',
  otro: 'No se pudo grabar',
};

// Terminales: ahí Ctrl+C interrumpe el programa en curso (p. ej. Claude Code).
const TERMINALES = ['windowsterminal', 'warp', 'cmd', 'powershell', 'pwsh', 'conhost', 'wezterm-gui', 'alacritty', 'mintty', 'hyper', 'tabby'];

function contarPalabras(t) {
  return (t.match(/\S+/g) || []).length;
}

function crearOrquestador(deps) {
  const { almacen, dirAudios, generarId, ahora, secretos, sistema, pegador, pastilla, groq, aprendiz, motorLocal, aWav } = deps;
  const oyentes = [];
  let grabacion = null; // { modo, proceso: Promise<string>, seleccion: Promise<string>|null }
  let esperandoAudio = null;
  let cancelada = null; // { g, hasta } de la última grabación cancelada
  let cola = Promise.resolve();

  const emitirYa = (estado, texto) => oyentes.forEach((fn) => fn(estado, texto));
  // Si ya hay otra grabación en curso, la pastilla debe seguir mostrándola.
  function emitir(estado, texto) {
    if (!grabacion) { emitirYa(estado, texto); return; }
    if (estado === 'reposo') return;
    emitirYa(estado, texto);
    setTimeout(() => { if (grabacion) emitirYa('grabando'); }, 3100);
  }
  const ajustes = () => almacen.leer('ajustes', {});

  function guardarEntrada(entrada) {
    const historial = almacen.leer('historial', []);
    const i = historial.findIndex((h) => h.id === entrada.id);
    if (i >= 0) historial[i] = entrada; else historial.push(entrada);
    almacen.escribir('historial', historial);
  }

  function iniciar(modo) {
    if (grabacion) return;
    if (aprendiz) aprendiz.cancelar(); // un dictado nuevo corta la vigilancia anterior
    const a = ajustes();
    grabacion = { modo, proceso: sistema.procesoActivo(), seleccion: null, silenciar: !!a.silenciarAudio };
    pastilla.enviar('grabar:iniciar', { deviceId: a.micId || null, sonidos: a.sonidos !== false, micListo: a.micListo !== false });
  }

  // La pastilla avisa cuando el micrófono ya está abierto y sonó el tono;
  // recién ahí se silencia el sistema (si no, el tono no se oiría).
  function grabacionIniciada() {
    const g = grabacion;
    if (!g || !g.silenciar) return;
    setTimeout(() => {
      if (grabacion === g) { g.silenciado = true; sistema.silenciar(); }
    }, ESPERA_SILENCIAR_MS);
  }

  function manosLibres() {
    if (grabacion) pastilla.enviar('grabar:manos-libres');
  }

  async function detener() {
    if (!grabacion) return;
    const g = grabacion;
    grabacion = null;
    // Se marca de inmediato: el audio puede llegar antes de que termine
    // la restauración del sonido.
    esperandoAudio = g;
    // Si el sistema está silenciado, el tono se toca después de restaurar
    // el audio; si no, no se oiría.
    pastilla.enviar('grabar:detener', { tono: !g.silenciado });
    const restaurado = sistema.restaurarAudio();
    if (g.silenciado) restaurado.then(() => pastilla.enviar('tono', 'detener'));
    // En modo comando la selección se copia al soltar el atajo: copiarla con
    // Alt+Win presionadas mandaría otra combinación.
    if (g.modo === 'comando') {
      g.seleccion = Promise.all([restaurado, g.proceso])
        .then(([, proceso]) => (TERMINALES.includes((proceso || '').toLowerCase()) ? '' : pegador.copiarSeleccion()))
        .catch(() => '');
    }
    await restaurado;
  }

  // `silencioso`: se canceló porque el atajo resultó ser otro (p. ej. Ctrl+C);
  // no suena ni ofrece deshacer.
  async function cancelar({ silencioso = false } = {}) {
    const g = grabacion;
    if (g && !silencioso) cancelada = { g, hasta: ahora().getTime() + VENTANA_DESHACER_MS };
    grabacion = null;
    esperandoAudio = null;
    const tonoDespues = !!(g && g.silenciado && !silencioso);
    pastilla.enviar('grabar:cancelar', { tono: !!g && !silencioso && !tonoDespues, silencioso });
    await sistema.restaurarAudio();
    if (tonoDespues) pastilla.enviar('tono', 'cancelar');
  }

  function errorGrabacion(tipo) {
    grabacion = null;
    esperandoAudio = null;
    sistema.restaurarAudio();
    emitir('error', MENSAJES[tipo] || MENSAJES.otro);
  }

  // "Deshacer" en el aviso de cancelación: procesa el audio de la grabación cancelada.
  function deshacerCancelacion(audio, duracionSeg, nivelMax) {
    if (!cancelada || ahora().getTime() > cancelada.hasta) return;
    esperandoAudio = cancelada.g;
    cancelada = null;
    recibirAudio(audio, duracionSeg, nivelMax);
  }

  // `nivelMax` es el volumen RMS más alto de la grabación (0-1); si no se
  // conoce, no se usa para descartar.
  function recibirAudio(audio, duracionSeg, nivelMax) {
    const g = esperandoAudio;
    esperandoAudio = null;
    if (!g) return;
    const silencio = typeof nivelMax === 'number' && nivelMax < NIVEL_MINIMO_VOZ;
    const trabajo = { id: generarId(), audio, duracionSeg, silencio, ...g };
    cola = cola.then(() => procesar(trabajo, { pegar: true })).catch((e) => {
      console.error('Habla Agéntica: falló un dictado', e);
      emitir('error', 'Algo falló, revisa el historial');
    });
  }

  async function transcribirLocal(t, pistas) {
    if (!motorLocal || !motorLocal.instalado()) throw errorTipo('sin-instalar', 'El modo local no está instalado');
    let wav;
    try {
      wav = await aWav(t.audio);
    } catch (e) {
      throw errorTipo('conversion', `No se pudo convertir el audio: ${e.message}`);
    }
    return motorLocal.transcribir({ wav, pista: pistas });
  }

  // Elige dónde transcribir: nube (Groq), local, o automático (nube y, si no
  // hay conexión, local).
  async function transcribirAudio({ t, a, key, pistas }) {
    const motor = a.motorVoz || 'nube';
    const nube = async () => {
      if (!key) throw new ErrorGroq('key');
      return { texto: await groq.transcribir({ audio: t.audio, key, modelo: a.modeloVoz || 'whisper-large-v3', pistas }), motor: 'nube' };
    };
    const local = async () => ({ texto: await transcribirLocal(t, pistas), motor: 'local' });
    if (motor === 'local') return local();
    if (motor === 'auto') {
      const hayLocal = !!motorLocal && motorLocal.instalado();
      if (!key && hayLocal) return local();
      try {
        return await nube();
      } catch (e) {
        if (hayLocal && ERRORES_DE_RED.includes(e.tipo)) return local();
        throw e;
      }
    }
    return nube();
  }

  async function procesar(t, { pegar }) {
    const base = { id: t.id, fecha: (t.fecha || ahora().toISOString()), app: '', duracionSeg: t.duracionSeg, crudo: '', pulido: '', palabras: 0, promptUsado: '' };
    const proceso = await t.proceso;
    base.app = proceso;

    if (t.duracionSeg < DURACION_MINIMA_SEG || t.silencio) {
      guardarEntrada({ ...base, estado: 'vacio' });
      emitir('reposo');
      return;
    }

    // Cuánto tarda cada etapa (ms), para saber dónde está la demora.
    const tiempos = { voz: 0, pulido: 0, pegado: 0 };
    const a = ajustes();
    const dic = almacen.leer('diccionario', { palabras: [], snippets: [] });
    const prompts = almacen.leer('prompts', null);

    const key = await Promise.resolve(secretos.obtenerKey()).catch(() => null);
    t.key = key;
    // Sin key, o si el usuario lo prefiere, el texto no se pule con la IA de Groq.
    const sinPulir = a.pulirEnNube === false || !key;
    let crudo;
    let motorUsado = 'nube';
    try {
      const t0 = Date.now();
      ({ texto: crudo, motor: motorUsado } = await transcribirAudio({ t, a, key, pistas: pistasWhisper(dic) }));
      tiempos.voz = Date.now() - t0;
    } catch (e) {
      if (e.tipo === 'sin-instalar' || e.tipo === 'arranque' || e.tipo === 'transcripcion' || e.tipo === 'conversion') {
        console.error('Habla Agéntica: transcripción local', e.message);
      }
      const nombre = t.audioGuardado || `${t.id}.webm`;
      fs.mkdirSync(dirAudios, { recursive: true });
      fs.writeFileSync(path.join(dirAudios, nombre), t.audio);
      guardarEntrada({ ...base, estado: 'error', audio: nombre });
      emitir('error', MENSAJES[e.tipo] || MENSAJES.servidor);
      return;
    }

    if (!crudo.trim() || esAlucinacion(crudo)) {
      guardarEntrada({ ...base, estado: 'vacio' });
      emitir('reposo');
      return;
    }

    const conDiccionario = aplicarDiccionario(crudo, dic);
    const snippet = (dic.snippets || []).find((s) => normalizar(s.frase) === normalizar(crudo));
    const seleccion = t.seleccion ? await t.seleccion.catch(() => '') : '';

    // Un comando de voz necesita la IA: sin ella no hay nada que aplicar al texto.
    if (!snippet && t.modo === 'comando' && seleccion && sinPulir) {
      guardarEntrada({ ...base, crudo, estado: 'vacio', motor: motorUsado });
      emitir('error', 'Los comandos necesitan la IA de Groq');
      return;
    }

    let pulido;
    let estado = 'pulido';
    let promptUsado;
    if (snippet) {
      pulido = snippet.texto;
      promptUsado = 'snippet';
    } else {
      let texto = conDiccionario;
      let instruccionSistema;
      if (t.modo === 'comando' && seleccion) {
        texto = seleccion;
        // Si la orden es el nombre de un comando guardado ("Más formal"), se usa su texto.
        const guardado = (prompts.comandos || []).find((c) => normalizar(c.nombre) === normalizar(conDiccionario));
        instruccionSistema = armarSistemaComando(guardado ? guardado.texto : conDiccionario);
        promptUsado = 'comando';
      } else {
        const promptApp = elegirPrompt(proceso, prompts);
        instruccionSistema = armarSistema(prompts, promptApp);
        promptUsado = promptApp.id;
      }
      const t1 = Date.now();
      if (sinPulir) {
        pulido = conDiccionario;
        estado = 'crudo';
      } else {
        try {
          pulido = await groq.pulir({ texto, instruccionSistema, key: t.key, modelo: a.modeloPulido || 'openai/gpt-oss-120b' });
        } catch {
          pulido = conDiccionario;
          estado = 'crudo';
        }
      }
      tiempos.pulido = Date.now() - t1;
    }

    // Se guarda antes de pegar: si el portapapeles falla, el texto no se pierde.
    const entrada = { ...base, crudo, pulido, palabras: contarPalabras(pulido), promptUsado, estado, tiempos, motor: motorUsado };
    guardarEntrada(entrada);
    if (pegar) {
      try {
        const t2 = Date.now();
        // Hasta que se manda Ctrl+V; después solo se restaura el portapapeles.
        await pegador.pegar(pulido, { alPegar: () => { tiempos.pegado = Date.now() - t2; } });
        guardarEntrada(entrada);
      } catch (e) {
        console.error('Habla Agéntica: no se pudo pegar', e);
        emitir('error', 'No se pudo pegar, quedó en el historial');
        return;
      }
    }
    // Vigila el campo unos segundos: si corriges una palabra, la aprende.
    if (pegar && aprendiz && a.aprenderCorrecciones !== false) aprendiz.observar({ pulido }).catch(() => {});
    if (estado === 'crudo' && !sinPulir) emitir('aviso', 'Pegado sin pulir');
    else emitir('reposo');
  }

  async function reintentar(id) {
    const entrada = almacen.leer('historial', []).find((h) => h.id === id);
    if (!entrada || !entrada.audio) return null;
    const ruta = path.join(dirAudios, entrada.audio);
    if (!fs.existsSync(ruta)) return null;
    const t = {
      id, fecha: entrada.fecha, audio: fs.readFileSync(ruta), duracionSeg: entrada.duracionSeg,
      modo: 'dictado', proceso: Promise.resolve(entrada.app), seleccion: null, audioGuardado: entrada.audio,
    };
    const trabajo = cola.then(() => procesar(t, { pegar: false }));
    cola = trabajo.catch(() => {});
    await trabajo;
    const final = almacen.leer('historial', []).find((h) => h.id === id);
    if (final && final.estado !== 'error') fs.rmSync(ruta, { force: true });
    return final;
  }

  function limpiarAudiosViejos() {
    if (!fs.existsSync(dirAudios)) return;
    const conError = new Set(almacen.leer('historial', []).filter((h) => h.estado === 'error').map((h) => h.audio));
    const limite = ahora().getTime() - DIAS_AUDIO * 24 * 3600 * 1000;
    for (const nombre of fs.readdirSync(dirAudios)) {
      const ruta = path.join(dirAudios, nombre);
      if (!conError.has(nombre) && fs.statSync(ruta).mtimeMs < limite) fs.rmSync(ruta, { force: true });
    }
  }

  return {
    avisar: (texto) => emitir('aviso', texto),
    iniciar,
    grabacionIniciada,
    manosLibres,
    deshacerCancelacion,
    detener,
    cancelar,
    errorGrabacion,
    recibirAudio,
    reintentar,
    limpiarAudiosViejos,
    grabando: () => grabacion !== null,
    colaVacia: () => cola,
    on(nombre, fn) { if (nombre === 'estado') oyentes.push(fn); },
  };
}

module.exports = { crearOrquestador, MENSAJES };
