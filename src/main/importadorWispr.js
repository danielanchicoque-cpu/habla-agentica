// Lee el diccionario y el historial de Wispr Flow (solo lectura) y los
// convierte al formato de Habla Agéntica.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const TRADUCCIONES = { 'my email address': 'mi correo' };
const NOMBRES_COMANDO = { 'organize thoughts prompt': 'Organizar ideas' };

function rutaWisprPorDefecto() {
  return path.join(process.env.APPDATA || '', 'Wispr Flow', 'flow.sqlite');
}

function fechaIso(ts) {
  const d = new Date(String(ts).replace(' ', 'T').replace(' ', ''));
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

async function importarWispr(rutaSqlite) {
  const db = new DatabaseSync(rutaSqlite, { readOnly: true });
  try {
    const filas = db.prepare(
      'SELECT id, phrase, replacement, isSnippet FROM Dictionary WHERE isDeleted = 0 ORDER BY rowid',
    ).all();
    const palabras = [];
    const snippets = [];
    const comandos = [];

    for (const f of filas) {
      if (f.phrase === 'Wispr Flow') continue;
      if (!f.isSnippet) {
        palabras.push({ id: `wispr-${f.id}`, frase: f.phrase, reemplazo: f.replacement || null });
        continue;
      }
      if ((f.replacement || '').includes('wisprflow.ai/r/')) continue;
      const frase = f.phrase.trim();
      if (/ prompt$/i.test(frase)) {
        const nombre = NOMBRES_COMANDO[frase.toLowerCase()] || frase.replace(/ prompt$/i, '');
        comandos.push({ id: `wispr-${f.id}`, nombre, texto: f.replacement });
        continue;
      }
      snippets.push({ id: `wispr-${f.id}`, frase: TRADUCCIONES[frase.toLowerCase()] || frase, texto: f.replacement });
    }

    const historial = db.prepare(
      "SELECT transcriptEntityId, asrText, formattedText, timestamp, app, duration, numWords FROM History WHERE status = 'formatted' ORDER BY timestamp",
    ).all().map((h) => ({
      id: `wispr-${h.transcriptEntityId}`,
      fecha: fechaIso(h.timestamp),
      app: h.app || '',
      crudo: h.asrText || '',
      pulido: h.formattedText || '',
      duracionSeg: h.duration || 0,
      palabras: h.numWords || 0,
      promptUsado: 'wispr',
      estado: 'importado',
    }));

    return { palabras, snippets, comandos, historial };
  } finally {
    db.close();
  }
}

module.exports = { importarWispr, rutaWisprPorDefecto };
