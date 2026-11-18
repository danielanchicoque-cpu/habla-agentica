// Pega texto en la ventana activa usando el portapapeles y Ctrl+V, y luego
// deja el portapapeles como estaba (todos sus formatos: texto, HTML, imagen…).

const MAX_ESPERA_MODIFICADORES_MS = 1000;
const PASO_MS = 20;
const RESTAURAR_MS = 400;
const COPIAR_MS = 150;

// `grabando()`: si hay otra grabación en curso, el usuario tiene el atajo
// presionado a propósito, así que se espera sin límite a que lo suelte.
function crearPegador({ portapapeles, teclado, modificadoresPresionados, esperar, grabando = () => false }) {
  let turno = Promise.resolve();

  // Una sola operación de portapapeles a la vez, para que respaldo y
  // restauración de una no se crucen con otra.
  function enExclusiva(fn) {
    const resultado = turno.then(fn);
    turno = resultado.catch(() => {});
    return resultado;
  }

  async function esperarModificadores() {
    for (let t = 0; modificadoresPresionados() && (t < MAX_ESPERA_MODIFICADORES_MS || grabando()); t += PASO_MS) {
      await esperar(PASO_MS);
    }
  }

  const pegar = (texto, opciones) => enExclusiva(() => pegarAhora(texto, opciones));
  const copiarSeleccion = () => enExclusiva(copiarAhora);

  async function pegarAhora(texto, { alPegar } = {}) {
    await esperarModificadores();
    const respaldo = await portapapeles.respaldar();
    await portapapeles.escribirTexto(texto);
    teclado.tap(['ctrl', 'v']);
    if (alPegar) alPegar();
    await esperar(RESTAURAR_MS);
    await portapapeles.restaurar(respaldo);
  }

  async function copiarAhora() {
    await esperarModificadores();
    const respaldo = await portapapeles.respaldar();
    await portapapeles.limpiar();
    teclado.tap(['ctrl', 'c']);
    await esperar(COPIAR_MS);
    const seleccion = await portapapeles.leerTexto();
    await portapapeles.restaurar(respaldo);
    return seleccion;
  }

  return { pegar, copiarSeleccion };
}

// Adaptador para la API de portapapeles de Electron 44 (read/write con
// ClipboardItem). Los items leídos no se pueden reescribir, así que el
// respaldo guarda los Blobs de cada formato y la restauración crea items nuevos.
function portapapelesElectron(clipboard, ClipboardItem) {
  return {
    async respaldar() {
      const items = await clipboard.read();
      const copia = [];
      for (const item of items) {
        const datos = {};
        for (const tipo of item.types) {
          try { datos[tipo] = await item.getType(tipo); } catch { /* formato ilegible: se omite */ }
        }
        if (Object.keys(datos).length) copia.push(datos);
      }
      return copia;
    },
    async restaurar(copia) {
      if (!copia.length) { await clipboard.clear(); return; }
      try {
        await clipboard.write(copia.map((datos) => new ClipboardItem(datos)));
      } catch {
        // Si algún formato no se puede restaurar, al menos se devuelve el texto.
        const texto = copia.find((d) => d['text/plain']);
        if (texto) await clipboard.writeText(await texto['text/plain'].text());
        else await clipboard.clear();
      }
    },
    escribirTexto: async (t) => { await clipboard.writeText(t); },
    leerTexto: async () => (await clipboard.readText()) || '',
    limpiar: async () => { await clipboard.clear(); },
  };
}

// Teclado real con uiohook-napi.
function tecladoUiohook() {
  const { uIOhook, UiohookKey } = require('uiohook-napi');
  const mapa = { ctrl: UiohookKey.Ctrl, v: UiohookKey.V, c: UiohookKey.C };
  return {
    tap([modificador, tecla]) {
      uIOhook.keyTap(mapa[tecla], [mapa[modificador]]);
    },
  };
}

module.exports = { crearPegador, portapapelesElectron, tecladoUiohook };
