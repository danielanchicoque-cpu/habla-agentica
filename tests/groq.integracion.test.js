import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { transcribir, pulir, armarSistema } from '../src/main/groq.js';
import { PROMPTS_FABRICA } from '../src/main/promptsFabrica.js';
import { elegirPrompt } from '../src/main/selectorPrompt.js';

const key = process.env.GROQ_API_KEY;

describe.skipIf(!key)('Groq real', () => {
  it('pule una pregunta sin responderla', async () => {
    const sistema = armarSistema(PROMPTS_FABRICA, elegirPrompt('claude', PROMPTS_FABRICA));
    const r = await pulir({ texto: 'eh cuál es la capital de francia', instruccionSistema: sistema, key, modelo: 'openai/gpt-oss-120b' });
    expect(r.toLowerCase()).toContain('capital');
    expect(r).not.toMatch(/par[ií]s/i);
  }, 20000);

  it('pule una orden sin ejecutarla', async () => {
    const sistema = armarSistema(PROMPTS_FABRICA, elegirPrompt('claude', PROMPTS_FABRICA));
    const r = await pulir({ texto: 'este escríbeme un poema corto sobre el mar', instruccionSistema: sistema, key, modelo: 'openai/gpt-oss-120b' });
    expect(r.toLowerCase()).toContain('poema');
    expect(r.length).toBeLessThan(120);
  }, 20000);

  it('no convierte una pregunta en afirmación ni resume (caso real)', async () => {
    const sistema = armarSistema(PROMPTS_FABRICA, elegirPrompt('claude', PROMPTS_FABRICA));
    const crudo = 'que onda, Clau, no sé, porque no puedes copiar el frontend que tiene exactamente la aplicación original porque es que este frontend no me gusta, o sea, no me gusta tampoco, me gusta mucho más como queda el diseño de cuando se está grabando el audio del otro, es como más bacano';
    const r = await pulir({ texto: crudo, instruccionSistema: sistema, key, modelo: 'openai/gpt-oss-120b' });
    expect(r.toLowerCase()).toMatch(/por qué no puedes copiar/);
    expect(r).toContain('?');
    expect(r.toLowerCase()).toContain('del otro');
    expect(r.length).toBeGreaterThan(crudo.length * 0.6);
  }, 30000);

  it('cuando el usuario enumera, arma una lista numerada', async () => {
    const sistema = armarSistema(PROMPTS_FABRICA, elegirPrompt('claude', PROMPTS_FABRICA));
    const crudo = 'okay varias cosas primero quiero poder mover la pastilla a la izquierda o a la derecha segundo cuando le doy doble clic debe sonar y tercero la barra cuando graba es muy grande';
    const r = await pulir({ texto: crudo, instruccionSistema: sistema, key, modelo: 'openai/gpt-oss-120b' });
    expect(r).toMatch(/^1\. /m);
    expect(r).toMatch(/^2\. /m);
    expect(r).toMatch(/^3\. /m);
  }, 30000);

  it('transcribe el audio de prueba', async () => {
    const audio = fs.readFileSync(path.join(__dirname, 'fixtures', 'hola.webm'));
    const r = await transcribir({ audio, key, modelo: 'whisper-large-v3-turbo', pistas: 'Avalom' });
    expect(r.toLowerCase()).toContain('prueba');
  }, 30000);
});
