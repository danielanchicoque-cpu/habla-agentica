import { describe, it, expect } from 'vitest';
import { aplicarDiccionario, pistasWhisper } from '../src/main/diccionario.js';

const dic = (palabras = [], snippets = []) => ({ palabras, snippets });
const snipPeligroso = { id: 's1', frase: 'Claude Peligroso', texto: 'claude --dangerously-skip-permissions ' };

describe('aplicarDiccionario', () => {
  it('un dictado que es exactamente el snippet devuelve su texto, aunque cambien mayúsculas o puntuación', () => {
    const d = dic([], [snipPeligroso]);
    expect(aplicarDiccionario('Claude Peligroso', d)).toBe(snipPeligroso.texto);
    expect(aplicarDiccionario('claude peligroso.', d)).toBe(snipPeligroso.texto);
  });

  it('reemplaza un snippet dentro de una frase como palabra completa', () => {
    const d = dic([], [{ id: 's2', frase: 'mi correo', texto: 'x@y.com' }]);
    expect(aplicarDiccionario('mi correo es mi correo', d)).toBe('x@y.com es x@y.com');
  });

  it('aplica reemplazos con límites de palabra y sin importar mayúsculas', () => {
    const d = dic([{ id: 'p1', frase: 'btw', reemplazo: 'por cierto' }]);
    expect(aplicarDiccionario('BTW llegué', d)).toBe('por cierto llegué');
    expect(aplicarDiccionario('abtw', d)).toBe('abtw');
  });

  it('una palabra sin reemplazo corrige su escritura', () => {
    const d = dic([{ id: 'p2', frase: 'Avalom', reemplazo: null }]);
    expect(aplicarDiccionario('avalom vende', d)).toBe('Avalom vende');
  });

  it('respeta tildes en el texto aunque la comparación las ignore', () => {
    const d = dic([{ id: 'p3', frase: 'Arauca', reemplazo: null }]);
    expect(aplicarDiccionario('vivo en arauca, Colombia', d)).toBe('vivo en Arauca, Colombia');
  });
});

describe('pistasWhisper', () => {
  it('une las frases con coma', () => {
    const d = dic([{ frase: 'Avalom' }, { frase: 'Kabi' }, { frase: 'Higgsfield' }]);
    expect(pistasWhisper(d)).toBe('Avalom, Kabi, Higgsfield');
  });
  it('corta a 800 caracteres', () => {
    const d = dic(Array.from({ length: 300 }, (_, i) => ({ frase: `palabra${i}` })));
    expect(pistasWhisper(d).length).toBeLessThanOrEqual(800);
  });
});
