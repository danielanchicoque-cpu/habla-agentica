// La key de Groq, cifrada con safeStorage (DPAPI en Windows) dentro de ajustes.
const { execFile } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

function crearSecretos({ safeStorage, almacen, leerDpapi }) {
  function guardarKey(k) {
    const ajustes = almacen.leer('ajustes', {});
    ajustes.keyCifrada = safeStorage.encryptString(k.trim()).toString('base64');
    almacen.escribir('ajustes', ajustes);
  }

  async function obtenerKey() {
    const { keyCifrada } = almacen.leer('ajustes', {});
    if (keyCifrada) {
      try { return safeStorage.decryptString(Buffer.from(keyCifrada, 'base64')); } catch { /* sigue */ }
    }
    const importada = await leerDpapi();
    if (importada && importada.startsWith('gsk_')) {
      guardarKey(importada);
      return importada.trim();
    }
    return null;
  }

  return { obtenerKey, guardarKey };
}

// Lee la key guardada por el usuario en ~/.config/secrets/groq.dpapi.
function leerDpapiGroq() {
  const script = path.join(os.homedir(), '.config', 'secrets', 'get-secret.ps1');
  return new Promise((resolver) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, 'groq'], { windowsHide: true, timeout: 10000 },
      (err, stdout) => resolver(err ? null : stdout.trim() || null));
  });
}

module.exports = { crearSecretos, leerDpapiGroq };
