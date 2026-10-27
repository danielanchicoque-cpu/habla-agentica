// Arranque de Habla Agéntica: bandeja, pastilla, panel y cableado de atajos.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { app, BrowserWindow, Tray, Menu, ipcMain, clipboard, ClipboardItem, safeStorage, screen, nativeImage } = require('electron');

app.setName('Habla Agentica');
app.setAppUserModelId('com.daniel.hablaagentica');

const { crearAlmacen } = require('./almacen');
const { copiaFabrica } = require('./promptsFabrica');
const { crearDetector, conectarUiohook } = require('./atajos');
const { crearSistema } = require('./sistema');
const { crearPegador, portapapelesElectron, tecladoUiohook } = require('./pegador');
const { crearSecretos, leerDpapiGroq } = require('./secretos');
const { crearOrquestador } = require('./orquestador');
const { posicionPastilla, cursorSobrePastilla } = require('./posicionPastilla');
const groq = require('./groq');

const AJUSTES_POR_DEFECTO = {
  micId: null,
  sonidos: true,
  silenciarAudio: true,
  abrirAlIniciar: true,
  modeloVoz: 'whisper-large-v3',
  modeloPulido: 'openai/gpt-oss-120b',
  atajoDictado: [54, 3613], // Shift derecho + Ctrl derecho
  atajoComando: [56, 3675], // Alt izquierdo + Win izquierdo
};

const RAIZ = path.join(__dirname, '..', '..');
const ICONO = path.join(RAIZ, 'assets', 'icono.png');
const ICONO_BANDEJA = path.join(RAIZ, 'assets', 'bandeja.png');
const PROBAR_PASTILLA = process.argv.includes('--probar-pastilla');
// Solo pruebas: con HABLA_AUDIO_FALSO, un .wav hace de micrófono.
if (process.env.HABLA_AUDIO_FALSO) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.HABLA_AUDIO_FALSO);
}

let pastilla = null;
let panel = null;
let tray = null;
let teclado = null;
let sistema = null;
const detectores = [];

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => abrirPanel());
  app.whenReady().then(arrancar);
}

const TAM_PASTILLA = { ancho: 300, alto: 64 };

function crearPastilla(almacen) {
  const { ancho, alto } = TAM_PASTILLA;
  const guardada = almacen.leer('ajustes', {}).posicionPastilla;
  const { x, y } = posicionPastilla(guardada, screen.getAllDisplays(), screen.getPrimaryDisplay(), TAM_PASTILLA);
  pastilla = new BrowserWindow({
    width: ancho,
    height: alto,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'pastilla.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  pastilla.setAlwaysOnTop(true, 'screen-saver');
  // Deja pasar los clics a lo de abajo, pero sigue avisando el movimiento del
  // mouse para saber cuándo está sobre la pastilla.
  pastilla.setIgnoreMouseEvents(true, { forward: true });
  pastilla.loadFile(path.join(__dirname, '..', 'renderer', 'pastilla', 'index.html'));
  pastilla.once('ready-to-show', () => pastilla.showInactive());
}

function abrirPanel(seccion) {
  if (panel && !panel.isDestroyed()) {
    if (seccion) panel.webContents.send('panel:ir', seccion);
    panel.show();
    panel.focus();
    return;
  }
  panel = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    title: 'Habla Agéntica',
    icon: ICONO,
    backgroundColor: '#08080A',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'panel.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  panel.loadFile(path.join(__dirname, '..', 'renderer', 'panel', 'index.html'), { query: { seccion: seccion || 'inicio' } });
  panel.once('ready-to-show', () => panel.show());
  if (process.env.HABLA_CAPTURA) capturarPanel(process.env.HABLA_CAPTURA);
}

// Solo desarrollo: recorre las secciones del panel y guarda capturas.
function capturarPanel(dir) {
  panel.webContents.on('console-message', (e) => console.log('PANEL:', e.level, e.message));
  panel.webContents.once('did-finish-load', async () => {
    if (process.env.HABLA_IMPORTAR) {
      console.log('IMPORTADO:', JSON.stringify(await panel.webContents.executeJavaScript('window.habla.importarWispr()')));
      console.log('REIMPORTADO:', JSON.stringify(await panel.webContents.executeJavaScript('window.habla.importarWispr()')));
    }
    for (const s of ['inicio', 'prompts', 'diccionario', 'historial', 'estadisticas', 'ajustes']) {
      panel.webContents.send('panel:ir', s);
      await new Promise((r) => setTimeout(r, Number(process.env.HABLA_ESPERA || 1500)));
      console.log('SECCION', s, await panel.webContents.executeJavaScript("document.querySelector('h1') && document.querySelector('h1').textContent"));
      const img = await panel.webContents.capturePage();
      fs.writeFileSync(path.join(dir, `${s}.png`), img.toPNG());
    }
    console.log('CAPTURAS LISTAS');
  });
}

function crearBandeja() {
  tray = new Tray(nativeImage.createFromPath(ICONO_BANDEJA).resize({ width: 16, height: 16 }));
  tray.setToolTip('Habla Agéntica');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Abrir panel', click: () => abrirPanel() },
    {
      label: teclado && teclado.estaPausado() ? 'Reanudar atajos' : 'Pausar atajos',
      click: () => {
        if (teclado.estaPausado()) teclado.reanudar(); else teclado.pausar();
        tray.setContextMenu(menu());
      },
    },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu());
  tray.on('click', () => abrirPanel());
}

// Mouse sobre la pastilla y arrastre para cambiarla de lugar.
function cablearRatonPastilla(almacen) {
  let arrastre = null;
  if (process.env.HABLA_DEBUG) ipcMain.on('pastilla:arrastrar', (_e, fase) => console.log('ARRASTRE', fase));

  // Windows no avisa de forma confiable el mouse sobre una ventana transparente
  // que deja pasar los clics, así que se revisa el cursor cada 60 ms.
  let rect = null;
  let encima = false;
  ipcMain.on('pastilla:rect', (_e, r) => { rect = r; });
  setInterval(() => {
    if (!pastilla || pastilla.isDestroyed() || arrastre) return;
    const ahora = cursorSobrePastilla(screen.getCursorScreenPoint(), pastilla.getBounds(), rect);
    if (ahora === encima) return;
    encima = ahora;
    pastilla.setIgnoreMouseEvents(!encima, { forward: true });
    pastilla.webContents.send('pastilla:encima', encima);
    if (process.env.HABLA_DEBUG) console.log('ENCIMA', encima);
  }, 60);
  ipcMain.on('pastilla:arrastrar', (_e, fase) => {
    if (fase === 'inicio' && !arrastre) {
      const cursor = screen.getCursorScreenPoint();
      const [wx, wy] = pastilla.getPosition();
      arrastre = { dx: cursor.x - wx, dy: cursor.y - wy, inicio: Date.now() };
      pastilla.setIgnoreMouseEvents(false);
      arrastre.timer = setInterval(() => {
        const c = screen.getCursorScreenPoint();
        pastilla.setPosition(c.x - arrastre.dx, c.y - arrastre.dy);
        if (Date.now() - arrastre.inicio > 15000) terminar(); // por si se perdió el "soltar"
      }, 16);
    }
    // El "soltar" se toma del hook global: al mover la ventana bajo el cursor,
    // Chromium a veces inventa un mouseup y cortaría el arrastre.
  });
  require('uiohook-napi').uIOhook.on('mouseup', (e) => { if (e.button === 1 && arrastre) terminar(); });
  function terminar() {
    clearInterval(arrastre.timer);
    arrastre = null;
    const [x, y] = pastilla.getPosition();
    const ajustes = almacen.leer('ajustes', {});
    almacen.escribir('ajustes', { ...ajustes, posicionPastilla: { x, y } });
  }
}

function cablearAtajos(orquestador, almacen) {
  const reloj = { ahora: () => Date.now(), programar: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); } };
  function construir() {
    const a = { ...AJUSTES_POR_DEFECTO, ...almacen.leer('ajustes', {}) };
    detectores.length = 0;
    for (const [combo, modo] of [[a.atajoDictado, 'dictado'], [a.atajoComando, 'comando']]) {
      const d = crearDetector({ combo, ...reloj });
      d.on('iniciar', (tipo) => (tipo === 'manos-libres' ? orquestador.manosLibres() : orquestador.iniciar(modo)));
      d.on('detener', () => orquestador.detener());
      d.on('cancelar', () => orquestador.cancelar());
      detectores.push(d);
    }
  }
  construir();
  teclado = conectarUiohook(detectores);

  // Windows a veces no entrega el evento de soltar una tecla (avisos del
  // sistema, cambios de ventana…). Mientras un atajo esté presionado se
  // revisa el estado físico del teclado para no quedar grabando sin fin.
  setInterval(() => {
    for (const d of detectores) {
      if (!d.necesitaSincronizar()) continue;
      const pedido = Date.now();
      sistema.teclasAbajo(d.combo).then((abajo) => {
        if (!abajo || d.completoDesde() >= pedido - 100) return;
        teclado.olvidar(d.combo.filter((k) => !abajo.includes(k)));
        d.sincronizar(abajo);
      });
    }
  }, 300);
  return construir;
}

async function arrancar() {
  const dirDatos = app.getPath('userData');
  const primerArranque = !fs.existsSync(path.join(dirDatos, 'ajustes.json'));
  const almacen = crearAlmacen(dirDatos);
  if (primerArranque) {
    almacen.escribir('ajustes', { ...AJUSTES_POR_DEFECTO });
    almacen.escribir('prompts', copiaFabrica());
    almacen.escribir('diccionario', { palabras: [], snippets: [] });
    almacen.escribir('historial', []);
  }

  sistema = crearSistema();
  sistema.calentar();
  const secretos = crearSecretos({ safeStorage, almacen, leerDpapi: leerDpapiGroq });
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  let modificadores = () => false;
  const portapapeles = portapapelesElectron(clipboard, ClipboardItem);
  let hayGrabacion = () => false;
  const pegador = crearPegador({ portapapeles, teclado: tecladoUiohook(), modificadoresPresionados: () => modificadores(), esperar, grabando: () => hayGrabacion() });

  crearPastilla(almacen);
  const orquestador = crearOrquestador({
    almacen,
    dirAudios: path.join(dirDatos, 'audios'),
    generarId: () => crypto.randomUUID(),
    ahora: () => new Date(),
    secretos,
    sistema,
    pegador,
    pastilla: { enviar: (canal, ...args) => pastilla && !pastilla.isDestroyed() && pastilla.webContents.send(canal, ...args) },
    groq,
  });
  orquestador.on('estado', (estado, texto) => {
    pastilla.webContents.send('estado', estado, texto);
    if (estado === 'error' && texto === 'Revisa tu key de Groq') abrirPanel('ajustes');
    if (estado === 'error' && texto === 'Micrófono no encontrado') abrirPanel('ajustes');
  });
  hayGrabacion = () => orquestador.grabando();
  orquestador.limpiarAudiosViejos();

  ipcMain.on('grabar:audio', (_e, buf, duracionSeg, nivelMax) => orquestador.recibirAudio(Buffer.from(buf), duracionSeg, nivelMax));
  ipcMain.on('grabar:error', (_e, tipo) => orquestador.errorGrabacion(tipo));
  ipcMain.on('grabar:iniciada', () => orquestador.grabacionIniciada());
  ipcMain.on('grabar:deshacer', (_e, buf, duracionSeg, nivelMax) => orquestador.deshacerCancelacion(Buffer.from(buf), duracionSeg, nivelMax));
  // Botones ✓ y ✕ de la pastilla: además, los atajos vuelven a reposo
  // (por si estaban en manos libres).
  ipcMain.on('pastilla:detener', () => { detectores.forEach((d) => d.reiniciar()); orquestador.detener(); });
  ipcMain.on('pastilla:cancelar', () => { detectores.forEach((d) => d.reiniciar()); orquestador.cancelar(); });
  cablearRatonPastilla(almacen);

  if (PROBAR_PASTILLA) {
    pastilla.webContents.on('console-message', (e) => console.log('PASTILLA:', e.message));
    pastilla.webContents.on('preload-error', (_e, ruta, err) => console.log('PRELOAD ERROR', ruta, err));
    ipcMain.once('grabar:audio', (_e, buf, dur, nivel) => {
      console.log(`PRUEBA nivel máximo: ${nivel}`);
      console.log(`PRUEBA audio: ${buf.byteLength} bytes, ${dur.toFixed(1)} s`);
      setTimeout(() => app.quit(), process.env.HABLA_CAPTURA ? 1000 : 0);
    });
    ipcMain.once('grabar:error', (_e, tipo) => { console.log(`PRUEBA error: ${tipo}`); app.quit(); });
    pastilla.webContents.once('did-finish-load', () => {
      const id = process.argv.find((a) => a.startsWith('--mic='));
      pastilla.webContents.send('grabar:iniciar', { deviceId: id ? id.slice(6) : null, sonidos: true });
      const cap = process.env.HABLA_CAPTURA;
      const capturar = async (nombre) => fs.writeFileSync(path.join(cap, nombre), (await pastilla.webContents.capturePage()).toPNG());
      const js = (codigo) => pastilla.webContents.executeJavaScript(codigo);
      if (!cap) { setTimeout(() => pastilla.webContents.send('grabar:detener'), 3000); return; }
      (async () => {
        const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
        await esperar(1800); await capturar('p1-grabando.png');
        pastilla.webContents.send('grabar:cancelar');
        await esperar(900); await capturar('p2-cancelado.png');
        await esperar(600); await capturar('p3-cancelado-despues.png');
        pastilla.webContents.send('estado', 'procesando');
        await esperar(300); await capturar('p4-procesando.png');
        pastilla.webContents.send('estado', 'error', 'Micrófono no encontrado');
        await esperar(400); await capturar('p5-error.png');
        await js("ponerEstado('reposo')"); await esperar(300); await capturar('p6-reposo.png');
        console.log('PRUEBA clase antes:', await js('document.getElementById("pastilla").className'));
        await js("ratonEncima = true; pintarClase()"); await esperar(400);
        console.log('PRUEBA clase encima:', await js('document.getElementById("pastilla").className'));
        await capturar('p7-reposo-encima.png');
        console.log('PRUEBA capturas listas');
        app.quit();
      })();
    });
    return;
  }

  const reconstruirAtajos = cablearAtajos(orquestador, almacen);
  if (process.env.HABLA_DEBUG) {
    const { uIOhook } = require('uiohook-napi');
    uIOhook.on('keydown', (e) => console.log('TECLA down', e.keycode));
    uIOhook.on('keyup', (e) => console.log('TECLA up', e.keycode));
    orquestador.on('estado', (e, t) => console.log('ESTADO', e, t || ''));
    pastilla.webContents.on('console-message', (e) => console.log('PASTILLA:', e.message));
    ipcMain.on('grabar:iniciada', () => console.log('GRABANDO'));
    ipcMain.on('grabar:audio', (_e, b, d, n) => console.log('AUDIO', b.byteLength, d, 'nivel', n));
  }
  modificadores = () => teclado.modificadoresPresionados();
  crearBandeja();

  try {
    require('./ipc').registrar({ almacen, secretos, orquestador, pegador, groq, teclado, reconstruirAtajos, abrirPanel, pastilla: () => pastilla, AJUSTES_POR_DEFECTO });
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
  }

  if (app.isPackaged) {
    const a = almacen.leer('ajustes', {});
    app.setLoginItemSettings({ openAtLogin: a.abrirAlIniciar !== false });
  }
  if (primerArranque || process.env.HABLA_CAPTURA) abrirPanel('ajustes');
}

app.on('render-process-gone', (_e, wc, detalles) => {
  console.error('Ventana caída:', wc.getURL().split('/').slice(-2).join('/'), JSON.stringify(detalles));
});
app.on('child-process-gone', (_e, detalles) => console.error('Proceso caído:', JSON.stringify(detalles)));

app.on('window-all-closed', () => { /* sigue viva en la bandeja */ });
app.on('will-quit', () => {
  if (teclado) teclado.detener();
  if (sistema) sistema.cerrar();
});
