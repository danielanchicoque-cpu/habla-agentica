import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { codificarWav } = require('../src/renderer/pastilla/wav.js');

describe('codificarWav', () => {
  const muestras = new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]);
  const wav = codificarWav(muestras, 16000);
  const v = new DataView(wav);
  const texto = (pos, n) => String.fromCharCode(...new Uint8Array(wav, pos, n));

  it('arma una cabecera WAV PCM mono de 16 bits a 16 kHz', () => {
    expect(texto(0, 4)).toBe('RIFF');
    expect(texto(8, 4)).toBe('WAVE');
    expect(texto(12, 4)).toBe('fmt ');
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000);
    expect(v.getUint16(32, true)).toBe(2);
    expect(v.getUint16(34, true)).toBe(16);
    expect(texto(36, 4)).toBe('data');
  });

  it('los tamaños de la cabecera coinciden con el contenido', () => {
    expect(wav.byteLength).toBe(44 + muestras.length * 2);
    expect(v.getUint32(40, true)).toBe(muestras.length * 2);
    expect(v.getUint32(4, true)).toBe(wav.byteLength - 8);
  });

  it('convierte las muestras a enteros de 16 bits y recorta lo que se pasa de rango', () => {
    const dato = (i) => v.getInt16(44 + i * 2, true);
    expect(dato(0)).toBe(0);
    expect(dato(1)).toBe(Math.trunc(0.5 * 0x7fff));
    expect(dato(2)).toBe(-0x4000);
    expect(dato(3)).toBe(0x7fff);
    expect(dato(4)).toBe(-0x8000);
    expect(dato(5)).toBe(0x7fff); // 2 se recorta a 1
    expect(dato(6)).toBe(-0x8000); // -2 se recorta a -1
  });
});
