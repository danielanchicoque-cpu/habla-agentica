// Diccionario que aprende solo: compara lo que la app pegó con lo que el
// usuario dejó después de corregirlo y deduce las palabras mal escritas.
//
// - `extraerCorrecciones` es pura: dos textos entran, correcciones salen.
// - `crearAprendiz` vigila el campo de texto activo unos segundos después de
//   pegar (por UI Automation) y aplica lo aprendido al diccionario.

const { normalizar } = require('./diccionario');

const MAX_PALABRAS_CAMBIO = 3; // una corrección toca como mucho 3 palabras
const MAX_TOKENS_DIFF = 400; // más que eso no es una corrección, es otro texto
const SIMILITUD_MINIMA = 0.6;
const LARGO_MINIMO = 4; // "el" → "la" no es una palabra para aprender

const tokenizar = (texto) => texto.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || [];
const sinMarcas = (s) => normalizar(s).replace(/[^\p{L}\p{N}]/gu, '');

function distancia(a, b) {
  const n = a.length;
  const m = b.length;
  let anterior = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const actual = [i];
    for (let j = 1; j <= m; j++) {
      actual[j] = Math.min(anterior[j] + 1, actual[j - 1] + 1, anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    anterior = actual;
  }
  return anterior[m];
}

function similitud(a, b) {
  const largo = Math.max(a.length, b.length);
  return largo === 0 ? 1 : 1 - distancia(a, b) / largo;
}

// Grupos de cambios entre dos listas de palabras: [{ viejas, nuevas }].
function cambios(antes, despues) {
  let ini = 0;
  while (ini < antes.length && ini < despues.length && antes[ini] === despues[ini]) ini++;
  let finA = antes.length;
  let finD = despues.length;
  while (finA > ini && finD > ini && antes[finA - 1] === despues[finD - 1]) { finA--; finD--; }
  const a = antes.slice(ini, finA);
  const d = despues.slice(ini, finD);
  if (!a.length && !d.length) return [];
  if (a.length > MAX_TOKENS_DIFF || d.length > MAX_TOKENS_DIFF) return null;

  // Subsecuencia común más larga para separar cada cambio.
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(d.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = d.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === d[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const grupos = [];
  let actual = null;
  const cerrar = () => { if (actual) grupos.push(actual); actual = null; };
  let i = 0;
  let j = 0;
  while (i < a.length || j < d.length) {
    if (i < a.length && j < d.length && a[i] === d[j]) { cerrar(); i++; j++; continue; }
    actual = actual || { viejas: [], nuevas: [] };
    if (j >= d.length || (i < a.length && lcs[i + 1][j] >= lcs[i][j + 1])) actual.viejas.push(a[i++]);
    else actual.nuevas.push(d[j++]);
  }
  cerrar();
  return grupos;
}

function contieneSecuencia(lista, secuencia) {
  for (let i = 0; i + secuencia.length <= lista.length; i++) {
    if (secuencia.every((t, k) => lista[i + k] === t)) return true;
  }
  return false;
}

// `antes`: texto del campo justo después de pegar. `despues`: el mismo campo
// ya corregido. `pegado`: lo que pegó la app (solo se aprende de ahí).
// Devuelve [{ de, a }]: "de" estaba mal escrito y el usuario lo cambió por "a".
// `explicito`: el usuario corrigió a propósito (desde el Historial), así que
// no se exige que las palabras se parezcan en letras ("alto fi" → "Higgsfield").
function extraerCorrecciones(antes, despues, pegado, { explicito = false } = {}) {
  if (!antes || !despues || antes === despues) return [];
  const grupos = cambios(tokenizar(antes), tokenizar(despues));
  if (!grupos) return [];
  const tokensPegado = tokenizar(pegado || '');
  const salida = [];
  for (const g of grupos) {
    if (!g.viejas.length || !g.nuevas.length) continue; // solo reemplazos
    if (g.viejas.length > MAX_PALABRAS_CAMBIO || g.nuevas.length > MAX_PALABRAS_CAMBIO) continue;
    if (!contieneSecuencia(tokensPegado, g.viejas)) continue; // no es de este dictado
    const de = g.viejas.join(' ');
    const a = g.nuevas.join(' ');
    if (g.viejas.every((t) => /^\d+$/.test(t)) && g.nuevas.every((t) => /^\d+$/.test(t))) continue;
    const normDe = sinMarcas(de);
    const normA = sinMarcas(a);
    if (Math.max(normDe.length, normA.length) < (explicito ? 3 : LARGO_MINIMO)) continue;
    if (!explicito && normDe !== normA && similitud(normDe, normA) < SIMILITUD_MINIMA) continue; // reescribió, no corrigió
    salida.push({ de, a });
  }
  return salida;
}

// Aplica correcciones al diccionario:
// - la palabra correcta entra enseguida (corrige mayúsculas y sirve de pista a Whisper);
// - el reemplazo automático "mal → bien" solo entra cuando se repite la misma
//   corrección, para que un cambio aislado no dañe una palabra común.
function aprender(correcciones, almacen, generarId) {
  const dic = almacen.leer('diccionario', { palabras: [], snippets: [] });
  const estado = almacen.leer('aprendizaje', { pares: {} });
  dic.palabras = dic.palabras || [];
  const aprendidas = [];
  for (const { de, a } of correcciones) {
    const existente = dic.palabras.find((p) => normalizar(p.frase) === normalizar(a) && !p.reemplazo);
    if (!existente) {
      dic.palabras.unshift({ id: generarId(), frase: a, reemplazo: null, auto: true });
      aprendidas.push(a);
    } else if (existente.frase !== a) {
      existente.frase = a; // corrige cómo estaba escrita (mayúsculas, tildes)
      aprendidas.push(a);
    }
    if (normalizar(de) === normalizar(a)) continue;
    const clave = `${normalizar(de)}→${a}`;
    estado.pares[clave] = (estado.pares[clave] || 0) + 1;
    const hayReemplazo = dic.palabras.some((p) => p.reemplazo && normalizar(p.frase) === normalizar(de));
    if (estado.pares[clave] >= 2 && !hayReemplazo) {
      dic.palabras.unshift({ id: generarId(), frase: de, reemplazo: a, auto: true });
      aprendidas.push(`${de} → ${a}`);
    }
  }
  if (aprendidas.length) almacen.escribir('diccionario', dic);
  almacen.escribir('aprendizaje', estado);
  return aprendidas;
}

function crearAprendiz({ sistema, almacen, esperar, ahora, generarId, avisar, activo = () => true, intervaloMs = 2000, duracionMs = 60000, estableMs = 4000 }) {
  let turno = 0;

  // `explicito`: corrección hecha a propósito (Historial); `silencioso`: sin aviso en la pastilla.
  function aprenderDe(antes, despues, pegado, { explicito = false, silencioso = false } = {}) {
    const aprendidas = aprender(extraerCorrecciones(antes, despues, pegado, { explicito }), almacen, generarId);
    if (aprendidas.length && !silencioso) avisar(`Aprendí: ${aprendidas.join(', ')}`);
    return aprendidas;
  }

  // Vigila el campo activo tras un pegado. Una nueva observación cancela la anterior.
  async function observar({ pulido }) {
    const mio = ++turno;
    if (!activo()) return;
    await esperar(900);
    if (mio !== turno) return;
    let base = await sistema.textoEnfocado();
    // Si el campo no deja leer el texto pegado, no hay nada que vigilar.
    if (!base || !base.includes(pulido.trim().split('\n')[0].slice(0, 25))) return;
    let ultimo = base;
    let cambioEn = ahora();
    const fin = ahora() + duracionMs;
    while (ahora() < fin && mio === turno && activo()) {
      await esperar(intervaloMs);
      if (mio !== turno) return;
      const texto = await sistema.textoEnfocado();
      if (texto == null) continue;
      if (texto !== ultimo) { ultimo = texto; cambioEn = ahora(); continue; }
      if (ultimo !== base && ahora() - cambioEn >= estableMs) {
        aprenderDe(base, ultimo, pulido);
        base = ultimo;
      }
    }
    if (mio === turno && ultimo !== base) aprenderDe(base, ultimo, pulido);
  }

  return { observar, aprenderDe, cancelar: () => { turno++; } };
}

module.exports = { extraerCorrecciones, aprender, crearAprendiz };
