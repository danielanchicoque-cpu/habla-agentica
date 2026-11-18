const { contextBridge, ipcRenderer } = require('electron');

const RECIBIR = ['grabar:iniciar', 'grabar:detener', 'grabar:cancelar', 'grabar:manos-libres', 'estado', 'mics:pedir', 'pastilla:encima', 'tono', 'grabar:preparar', 'audio:wav'];
const ENVIAR = [
  'grabar:audio', 'grabar:error', 'mics:lista', 'grabar:iniciada', 'grabar:deshacer',
  'pastilla:cancelar', 'pastilla:detener', 'pastilla:rect', 'pastilla:arrastrar', 'audio:wav-listo',
];

contextBridge.exposeInMainWorld('pastilla', {
  on(canal, fn) {
    if (RECIBIR.includes(canal)) ipcRenderer.on(canal, (_e, ...args) => fn(...args));
  },
  enviar(canal, ...args) {
    if (ENVIAR.includes(canal)) ipcRenderer.send(canal, ...args);
  },
});
