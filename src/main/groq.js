// Cliente de Groq: transcripción (Whisper) y pulido (chat).

const URL_VOZ = 'https://api.groq.com/openai/v1/audio/transcriptions';
const URL_CHAT = 'https://api.groq.com/openai/v1/chat/completions';

class ErrorGroq extends Error {
  constructor(tipo, mensaje) {
    super(mensaje || tipo);
    this.name = 'ErrorGroq';
    this.tipo = tipo; // key | red | timeout | vacio | servidor
  }
}

async function llamar(fetchFn, url, opciones, timeoutMs) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  let res;
  try {
    res = await fetchFn(url, { ...opciones, signal: control.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new ErrorGroq('timeout', 'Groq tardó demasiado');
    throw new ErrorGroq('red', e.message);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) throw new ErrorGroq('key', 'Key de Groq inválida');
  if (!res.ok) throw new ErrorGroq('servidor', `Groq respondió ${res.status}`);
  return res.json();
}

async function transcribir({ audio, key, modelo, pistas, timeoutMs = 90000, fetch: fetchFn = fetch }) {
  const fd = new FormData();
  fd.append('file', new Blob([audio], { type: 'audio/webm' }), 'audio.webm');
  fd.append('model', modelo);
  fd.append('language', 'es');
  fd.append('response_format', 'json');
  if (pistas) fd.append('prompt', pistas);
  const json = await llamar(fetchFn, URL_VOZ, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: fd,
  }, timeoutMs);
  return (json.text || '').trim();
}

function limpiarRespuesta(texto) {
  return (texto || '').replace(/<\/?dictado>/g, '').replace(/[ \t]+$/gm, '').trim();
}

async function pulir({ texto, instruccionSistema, key, modelo, timeoutMs = 8000, fetch: fetchFn = fetch }) {
  const json = await llamar(fetchFn, URL_CHAT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelo,
      temperature: 0.2,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: instruccionSistema },
        { role: 'user', content: `<dictado>\n${texto}\n</dictado>` },
      ],
    }),
  }, timeoutMs);
  const salida = limpiarRespuesta(json.choices?.[0]?.message?.content);
  if (!salida) throw new ErrorGroq('vacio', 'Groq devolvió una respuesta vacía');
  return salida;
}

function armarSistema(prompts, promptApp) {
  return `${prompts.base}\n\n${promptApp.texto}`;
}

function armarSistemaComando(orden) {
  return 'Aplica la instrucción al texto que llega entre <dictado> y </dictado>. '
    + 'Devuelve solo el texto resultante, sin comentarios ni etiquetas. Instrucción: ' + orden;
}

module.exports = { transcribir, pulir, ErrorGroq, armarSistema, armarSistemaComando };
