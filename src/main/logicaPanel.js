// Lógica pura que usa el panel: búsqueda en historial, importación y estadísticas.
const { normalizar } = require('./diccionario');

const POR_PAGINA = 50;

const recientesPrimero = (a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0);
const visible = (h) => h.estado !== 'vacio';

function buscarHistorial(lista, { busqueda = '', pagina = 0 }) {
  const q = normalizar(busqueda || '');
  const filtrada = lista
    .filter(visible)
    .filter((h) => !q || normalizar(`${h.pulido} ${h.crudo}`).includes(q))
    .sort(recientesPrimero);
  return { total: filtrada.length, items: filtrada.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA) };
}

function mezclarImportacion(diccionario, prompts, historial, importado) {
  const conteo = { palabras: 0, snippets: 0, comandos: 0, historial: 0 };
  const palabras = [...(diccionario.palabras || [])];
  const snippets = [...(diccionario.snippets || [])];
  const comandos = [...(prompts.comandos || [])];
  const nuevosHistorial = [];

  const frasesPalabras = new Set(palabras.map((p) => normalizar(p.frase)));
  for (const p of importado.palabras) {
    if (frasesPalabras.has(normalizar(p.frase))) continue;
    frasesPalabras.add(normalizar(p.frase));
    palabras.push(p);
    conteo.palabras++;
  }
  const frasesSnippets = new Set(snippets.map((s) => normalizar(s.frase)));
  for (const s of importado.snippets) {
    if (frasesSnippets.has(normalizar(s.frase))) continue;
    frasesSnippets.add(normalizar(s.frase));
    snippets.push(s);
    conteo.snippets++;
  }
  const nombresComandos = new Set(comandos.map((c) => normalizar(c.nombre)));
  for (const c of importado.comandos) {
    if (nombresComandos.has(normalizar(c.nombre))) continue;
    nombresComandos.add(normalizar(c.nombre));
    comandos.push(c);
    conteo.comandos++;
  }
  const ids = new Set(historial.map((h) => h.id));
  for (const h of importado.historial) {
    if (ids.has(h.id)) continue;
    nuevosHistorial.push(h);
    conteo.historial++;
  }

  return {
    conteo,
    diccionario: { palabras, snippets },
    prompts: { ...prompts, comandos },
    historial: [...nuevosHistorial, ...historial].sort((a, b) => -recientesPrimero(a, b)),
  };
}

function diaLocal(fecha) {
  const d = new Date(fecha);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function calcularStats(lista, ahora = new Date()) {
  const utiles = lista.filter((h) => h.estado !== 'vacio' && h.estado !== 'error');
  const hoy = diaLocal(ahora);
  const palabrasHoy = utiles.filter((h) => diaLocal(h.fecha) === hoy).reduce((s, h) => s + (h.palabras || 0), 0);

  const dias = new Set(utiles.map((h) => diaLocal(h.fecha)));
  let racha = 0;
  const cursor = new Date(ahora);
  if (!dias.has(diaLocal(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (dias.has(diaLocal(cursor))) {
    racha++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const palabras = utiles.reduce((s, h) => s + (h.palabras || 0), 0);
  const segundos = utiles.reduce((s, h) => s + (h.duracionSeg || 0), 0);
  const ppm = segundos > 0 ? Math.round(palabras / (segundos / 60)) : 0;

  return { palabrasHoy, racha, ppm, totalPalabras: palabras, ultimos: [...utiles].sort(recientesPrimero).slice(0, 5) };
}

// ---------- Estadísticas ----------
const PALABRAS_POR_LIBRO = 100000;
const SEMANAS_MAPA = 20;
const MAX_PALABRAS_DIFF = 2000;

const tokens = (t) => normalizar(t || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, MAX_PALABRAS_DIFF);

// Palabras que el pulido cambió, quitó o agregó: diferencia entre los
// conjuntos de palabras (con repeticiones) de lo crudo y lo pulido.
function palabrasCambiadas(crudo, pulido) {
  const a = tokens(crudo);
  const b = tokens(pulido);
  if (!a.length || !b.length) return 0;
  const conteo = new Map();
  for (const w of a) conteo.set(w, (conteo.get(w) || 0) + 1);
  let soloEnB = 0;
  for (const w of b) {
    const n = conteo.get(w) || 0;
    if (n > 0) conteo.set(w, n - 1); else soloEnB++;
  }
  let soloEnA = 0;
  for (const n of conteo.values()) soloEnA += n;
  return Math.max(soloEnA, soloEnB);
}

function claveDia(fecha) {
  const d = new Date(fecha);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function calcularInsights(lista, prompts, ahora = new Date()) {
  const { elegirPrompt } = require('./selectorPrompt');
  const utiles = lista.filter((h) => h.estado !== 'vacio' && h.estado !== 'error');
  const base = calcularStats(lista, ahora);

  let palabrasCorregidas = 0;
  const porEstilo = new Map();
  const apps = new Set();
  const palabrasPorDia = new Map();
  for (const h of utiles) {
    if (h.crudo && h.pulido) palabrasCorregidas += palabrasCambiadas(h.crudo, h.pulido);
    const nombre = elegirPrompt(h.app, prompts).nombre;
    porEstilo.set(nombre, (porEstilo.get(nombre) || 0) + 1);
    if (h.app) apps.add(h.app.toLowerCase());
    const k = claveDia(h.fecha);
    palabrasPorDia.set(k, (palabrasPorDia.get(k) || 0) + (h.palabras || 0));
  }

  const total = utiles.length || 1;
  const uso = [...porEstilo.entries()]
    .map(([nombre, dictados]) => ({ nombre, dictados, porcentaje: Math.round((dictados / total) * 100) }))
    .sort((a, b) => b.dictados - a.dictados);

  const dias = [...palabrasPorDia.keys()].sort();
  let rachaMasLarga = 0;
  let racha = 0;
  for (let i = 0; i < dias.length; i++) {
    const seguido = i > 0 && (new Date(`${dias[i]}T12:00:00`) - new Date(`${dias[i - 1]}T12:00:00`)) / 86400000 === 1;
    racha = seguido ? racha + 1 : 1;
    rachaMasLarga = Math.max(rachaMasLarga, racha);
  }

  const mapa = [];
  const cursor = new Date(ahora);
  cursor.setDate(cursor.getDate() - (SEMANAS_MAPA * 7 - 1));
  for (let i = 0; i < SEMANAS_MAPA * 7; i++) {
    const k = claveDia(cursor);
    mapa.push({ fecha: k, diaSemana: cursor.getDay(), palabras: palabrasPorDia.get(k) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  return {
    ppm: base.ppm,
    totalPalabras: base.totalPalabras,
    libros: Math.floor(base.totalPalabras / PALABRAS_POR_LIBRO),
    dictados: utiles.length,
    palabrasCorregidas,
    uso,
    appsDistintas: apps.size,
    rachaActual: base.racha,
    rachaMasLarga,
    mapa,
  };
}

module.exports = { buscarHistorial, mezclarImportacion, calcularStats, calcularInsights, palabrasCambiadas, POR_PAGINA };
