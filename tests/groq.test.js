import { describe, it, expect } from 'vitest';
import { transcribir, pulir, ErrorGroq, armarSistema, armarSistemaComando } from '../src/main/groq.js';

const respuestaJson = (cuerpo, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

describe('transcribir', () => {
  it('manda el audio en multipart con idioma es y pistas', async () => {
    let llamada;
    const fetch = async (url, opts) => { llamada = { url, opts }; return respuestaJson({ text: ' hola ' }); };
    const texto = await transcribir({ audio: Buffer.from('abc'), key: 'k', modelo: 'whisper-large-v3-turbo', pistas: 'Avalom', fetch });
    expect(texto).toBe('hola');
    expect(llamada.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(llamada.opts.headers.Authorization).toBe('Bearer k');
    const fd = llamada.opts.body;
    expect(fd.get('language')).toBe('es');
    expect(fd.get('model')).toBe('whisper-large-v3-turbo');
    expect(fd.get('prompt')).toBe('Avalom');
    expect(fd.get('file').name).toBe('audio.webm');
  });

  it('401 lanza ErrorGroq tipo key', async () => {
    const fetch = async () => respuestaJson({ error: {} }, 401);
    await expect(transcribir({ audio: Buffer.from('a'), key: 'k', modelo: 'm', pistas: '', fetch }))
      .rejects.toMatchObject({ name: 'ErrorGroq', tipo: 'key' });
  });

  it('un fallo de red lanza tipo red', async () => {
    const fetch = async () => { throw new TypeError('fetch failed'); };
    await expect(transcribir({ audio: Buffer.from('a'), key: 'k', modelo: 'm', pistas: '', fetch }))
      .rejects.toMatchObject({ tipo: 'red' });
  });
});

describe('pulir', () => {
  it('envía el texto entre <dictado> con reasoning_effort low', async () => {
    let cuerpo;
    const fetch = async (url, opts) => {
      expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
      cuerpo = JSON.parse(opts.body);
      return respuestaJson({ choices: [{ message: { content: 'Hola.' } }] });
    };
    const r = await pulir({ texto: 'eh hola', instruccionSistema: 'SYS', key: 'k', modelo: 'openai/gpt-oss-120b', fetch });
    expect(r).toBe('Hola.');
    expect(cuerpo.reasoning_effort).toBe('low');
    expect(cuerpo.temperature).toBe(0.2);
    expect(cuerpo.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(cuerpo.messages[1].content).toBe('<dictado>\neh hola\n</dictado>');
  });

  it('quita las etiquetas <dictado> si el modelo las repite', async () => {
    const fetch = async () => respuestaJson({ choices: [{ message: { content: '<dictado>\nHola.\n</dictado>' } }] });
    expect(await pulir({ texto: 'x', instruccionSistema: 's', key: 'k', modelo: 'm', fetch })).toBe('Hola.');
  });

  it('quita los espacios sobrantes al final de cada línea', async () => {
    const fetch = async () => respuestaJson({ choices: [{ message: { content: '1. Uno.  \n2. Dos.   ' } }] });
    expect(await pulir({ texto: 'x', instruccionSistema: 's', key: 'k', modelo: 'm', fetch })).toBe('1. Uno.\n2. Dos.');
  });

  it('respuesta vacía lanza tipo vacio', async () => {
    const fetch = async () => respuestaJson({ choices: [{ message: { content: '  ' } }] });
    await expect(pulir({ texto: 'x', instruccionSistema: 's', key: 'k', modelo: 'm', fetch }))
      .rejects.toMatchObject({ tipo: 'vacio' });
  });

  it('un servidor colgado lanza tipo timeout', async () => {
    const fetch = (url, opts) => new Promise((_, rej) => {
      opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' })));
    });
    await expect(pulir({ texto: 'x', instruccionSistema: 's', key: 'k', modelo: 'm', timeoutMs: 50, fetch }))
      .rejects.toMatchObject({ tipo: 'timeout' });
  });

  it('500 lanza tipo servidor', async () => {
    const fetch = async () => respuestaJson({}, 503);
    await expect(pulir({ texto: 'x', instruccionSistema: 's', key: 'k', modelo: 'm', fetch }))
      .rejects.toBeInstanceOf(ErrorGroq);
  });
});

describe('armar instrucciones', () => {
  it('une la base con el prompt de la app', () => {
    expect(armarSistema({ base: 'B' }, { texto: 'A' })).toBe('B\n\nA');
  });
  it('el sistema de comando contiene la orden', () => {
    expect(armarSistemaComando('más formal')).toContain('más formal');
  });
});
