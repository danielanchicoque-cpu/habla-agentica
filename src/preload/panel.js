const { contextBridge, ipcRenderer } = require('electron');

const canales = {
  leerAjustes: 'ajustes:leer',
  guardarAjustes: 'ajustes:guardar',
  leerPrompts: 'prompts:leer',
  guardarPrompts: 'prompts:guardar',
  promptsFabrica: 'prompts:fabrica',
  probarPrompt: 'prompts:probar',
  leerDiccionario: 'dic:leer',
  guardarDiccionario: 'dic:guardar',
  listarHistorial: 'historial:listar',
  borrarHistorial: 'historial:borrar',
  pegarHistorial: 'historial:pegar',
  reintentarHistorial: 'historial:reintentar',
  estadoKey: 'key:estado',
  guardarKey: 'key:guardar',
  existeWispr: 'wispr:existe',
  importarWispr: 'wispr:importar',
  listarMics: 'mics:listar',
  stats: 'stats',
  insights: 'insights',
  capturarAtajo: 'atajo:capturar',
};

const api = {};
for (const [nombre, canal] of Object.entries(canales)) {
  api[nombre] = (...args) => ipcRenderer.invoke(canal, ...args);
}
api.alIr = (fn) => ipcRenderer.on('panel:ir', (_e, seccion) => fn(seccion));

contextBridge.exposeInMainWorld('habla', api);
