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
  corregirHistorial: 'historial:corregir',
  estadoKey: 'key:estado',
  guardarKey: 'key:guardar',
  existeWispr: 'wispr:existe',
  importarWispr: 'wispr:importar',
  listarMics: 'mics:listar',
  estadoActualizacion: 'actualizacion:estado',
  buscarActualizacion: 'actualizacion:buscar',
  instalarActualizacion: 'actualizacion:instalar',
  estadoLocal: 'local:estado',
  instalarLocal: 'local:instalar',
  cancelarLocal: 'local:cancelar',
  quitarLocal: 'local:quitar',
  stats: 'stats',
  insights: 'insights',
  capturarAtajo: 'atajo:capturar',
};

const api = {};
for (const [nombre, canal] of Object.entries(canales)) {
  api[nombre] = (...args) => ipcRenderer.invoke(canal, ...args);
}
api.alIr = (fn) => ipcRenderer.on('panel:ir', (_e, seccion) => fn(seccion));
api.alActualizar = (fn) => ipcRenderer.on('actualizacion:estado', (_e, estado) => fn(estado));
api.alCambiarLocal = (fn) => ipcRenderer.on('local:estado', (_e, estado) => fn(estado));

contextBridge.exposeInMainWorld('habla', api);
