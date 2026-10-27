// Canales IPC que usa el panel (window.habla.* en el renderer).
const { ipcMain, BrowserWindow } = require('electron');
const { copiaFabrica } = require('./promptsFabrica');
const { importarWispr, rutaWisprPorDefecto } = require('./importadorWispr');
const { buscarHistorial, mezclarImportacion, calcularStats, calcularInsights } = require('./logicaPanel');

function registrar(ctx) {
  const { almacen, secretos, orquestador, pegador, groq, teclado, reconstruirAtajos, pastilla, AJUSTES_POR_DEFECTO } = ctx;
  const h = (canal, fn) => ipcMain.handle(canal, (_e, ...args) => fn(...args));
  const ajustes = () => ({ ...AJUSTES_POR_DEFECTO, ...almacen.leer('ajustes', {}) });

  h('ajustes:leer', () => {
    const { keyCifrada, ...resto } = ajustes();
    return resto;
  });
  h('ajustes:guardar', (parcial) => {
    const { keyCifrada, ...limpio } = parcial || {};
    const nuevo = { ...almacen.leer('ajustes', {}), ...limpio };
    almacen.escribir('ajustes', nuevo);
    if ('atajoDictado' in limpio || 'atajoComando' in limpio) reconstruirAtajos();
    if ('abrirAlIniciar' in limpio && require('electron').app.isPackaged) {
      require('electron').app.setLoginItemSettings({ openAtLogin: !!limpio.abrirAlIniciar });
    }
    return true;
  });

  h('prompts:leer', () => almacen.leer('prompts', copiaFabrica()));
  h('prompts:guardar', (prompts) => { almacen.escribir('prompts', prompts); return true; });
  h('prompts:fabrica', () => copiaFabrica());
  h('prompts:probar', async ({ texto, promptId }) => {
    const prompts = almacen.leer('prompts', copiaFabrica());
    const key = await secretos.obtenerKey();
    if (!key) return { error: 'Falta la key de Groq' };
    const modelo = ajustes().modeloPulido;
    try {
      let instruccionSistema;
      if (promptId === 'base') {
        instruccionSistema = groq.armarSistema(prompts, prompts.porDefecto);
      } else {
        const comando = prompts.comandos.find((c) => c.id === promptId);
        if (comando) {
          instruccionSistema = groq.armarSistemaComando(comando.texto);
        } else {
          const app = [...prompts.porApp, prompts.porDefecto].find((p) => p.id === promptId) || prompts.porDefecto;
          instruccionSistema = groq.armarSistema(prompts, app);
        }
      }
      return { texto: await groq.pulir({ texto, instruccionSistema, key, modelo, timeoutMs: 15000 }) };
    } catch (e) {
      return { error: e.tipo === 'key' ? 'Key de Groq inválida' : 'No se pudo probar: ' + e.message };
    }
  });

  h('dic:leer', () => almacen.leer('diccionario', { palabras: [], snippets: [] }));
  h('dic:guardar', (dic) => { almacen.escribir('diccionario', dic); return true; });

  h('historial:listar', (opciones) => buscarHistorial(almacen.leer('historial', []), opciones || {}));
  h('historial:borrar', (id) => {
    almacen.escribir('historial', almacen.leer('historial', []).filter((x) => x.id !== id));
    return true;
  });
  h('historial:pegar', async (id) => {
    const entrada = almacen.leer('historial', []).find((x) => x.id === id);
    if (!entrada) return false;
    const ventana = BrowserWindow.getFocusedWindow();
    if (ventana) ventana.minimize();
    await new Promise((r) => setTimeout(r, 350));
    await pegador.pegar(entrada.pulido || entrada.crudo);
    return true;
  });
  h('historial:reintentar', (id) => orquestador.reintentar(id));

  h('key:estado', async () => ((await secretos.obtenerKey()) ? 'ok' : 'falta'));
  h('key:guardar', async (k) => {
    const key = (k || '').trim();
    if (!key.startsWith('gsk_')) return { ok: false, error: 'La key de Groq empieza por gsk_' };
    try {
      const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } });
      if (r.status === 401) return { ok: false, error: 'Groq rechazó esta key' };
    } catch {
      // Sin internet: se guarda igual y se valida en el próximo dictado.
    }
    secretos.guardarKey(key);
    return { ok: true };
  });

  h('wispr:existe', () => require('node:fs').existsSync(rutaWisprPorDefecto()));
  h('wispr:importar', async () => {
    const importado = await importarWispr(rutaWisprPorDefecto());
    const r = mezclarImportacion(
      almacen.leer('diccionario', { palabras: [], snippets: [] }),
      almacen.leer('prompts', copiaFabrica()),
      almacen.leer('historial', []),
      importado,
    );
    almacen.escribir('diccionario', r.diccionario);
    almacen.escribir('prompts', r.prompts);
    almacen.escribir('historial', r.historial);
    return r.conteo;
  });

  h('mics:listar', () => new Promise((resolver) => {
    const ventana = pastilla();
    const timer = setTimeout(() => resolver([]), 3000);
    ipcMain.once('mics:lista', (_e, lista) => { clearTimeout(timer); resolver(lista); });
    ventana.webContents.send('mics:pedir');
  }));

  h('stats', () => calcularStats(almacen.leer('historial', [])));

  // Las estadísticas recorren todo el historial: se recalculan solo si cambió.
  let cacheInsights = null;
  h('insights', () => {
    const historial = almacen.leer('historial', []);
    const ultimo = historial[historial.length - 1];
    const clave = `${historial.length}|${ultimo ? ultimo.id + ultimo.estado : ''}|${new Date().toDateString()}`;
    if (!cacheInsights || cacheInsights.clave !== clave) {
      cacheInsights = { clave, valor: calcularInsights(historial, almacen.leer('prompts', copiaFabrica())) };
    }
    return cacheInsights.valor;
  });

  // Captura un atajo: junta las teclas presionadas hasta que se suelta la primera.
  h('atajo:capturar', () => new Promise((resolver) => {
    const { uIOhook } = require('uiohook-napi');
    const teclas = new Set();
    teclado.pausar();
    const alBajar = (e) => teclas.add(e.keycode);
    const terminar = (resultado) => {
      uIOhook.off('keydown', alBajar);
      uIOhook.off('keyup', alSubir);
      clearTimeout(timer);
      teclado.reanudar();
      resolver(resultado);
    };
    const alSubir = () => { if (teclas.size) terminar([...teclas]); };
    const timer = setTimeout(() => terminar(null), 10000);
    uIOhook.on('keydown', alBajar);
    uIOhook.on('keyup', alSubir);
  }));
}

module.exports = { registrar };
