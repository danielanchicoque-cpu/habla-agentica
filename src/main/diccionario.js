// Diccionario personal: snippets (frase hablada → texto largo) y palabras
// (cómo se escribe un término, con o sin reemplazo).

const PUNTUACION_FINAL = /[.,!?¡¿;:\s]+$/u;

function normalizar(s) {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(PUNTUACION_FINAL, '').trim();
}

function escaparRegex(c) {
  return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Regex que encuentra `frase` como palabra completa, sin importar mayúsculas
// ni tildes. Se aplica sobre texto en NFD.
function regexFrase(frase) {
  const cuerpo = [...normalizar(frase)]
    .map((c) => (/\s/.test(c) ? '\\s+' : `${escaparRegex(c)}\\p{M}*`))
    .join('');
  return new RegExp(`(?<![\\p{L}\\p{N}])${cuerpo}(?![\\p{L}\\p{N}])`, 'giu');
}

function reemplazar(texto, frase, por) {
  return texto.normalize('NFD').replace(regexFrase(frase), () => por.normalize('NFD')).normalize('NFC');
}

function aplicarDiccionario(texto, dic) {
  const snippets = dic.snippets || [];
  const exacto = snippets.find((s) => normalizar(s.frase) === normalizar(texto));
  if (exacto) return exacto.texto;

  let salida = texto;
  for (const s of snippets) salida = reemplazar(salida, s.frase, s.texto);
  for (const p of dic.palabras || []) salida = reemplazar(salida, p.frase, p.reemplazo ?? p.frase);
  return salida;
}

function pistasWhisper(dic) {
  let salida = '';
  for (const p of dic.palabras || []) {
    const siguiente = salida ? `${salida}, ${p.frase}` : p.frase;
    if (siguiente.length > 800) break;
    salida = siguiente;
  }
  return salida;
}

module.exports = { aplicarDiccionario, pistasWhisper, normalizar };
