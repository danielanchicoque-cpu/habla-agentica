import { describe, it, expect } from 'vitest';
import { posicionPastilla, cursorSobrePastilla } from '../src/main/posicionPastilla.js';

const principal = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const segunda = { workArea: { x: 1920, y: 0, width: 1280, height: 1000 } };
const tam = { ancho: 300, alto: 64 };

describe('cursorSobrePastilla', () => {
  const ventana = { x: 810, y: 936, width: 300, height: 64 };
  const rect = { x: 131, y: 48, width: 38, height: 8 }; // pastilla en reposo dentro de la ventana
  it('detecta el cursor encima, con un margen para que sea fácil apuntarle', () => {
    expect(cursorSobrePastilla({ x: 960, y: 988 }, ventana, rect)).toBe(true);
    expect(cursorSobrePastilla({ x: 938, y: 981 }, ventana, rect)).toBe(true);
  });
  it('fuera de la pastilla (aunque dentro de la ventana) es false', () => {
    expect(cursorSobrePastilla({ x: 820, y: 940 }, ventana, rect)).toBe(false);
    expect(cursorSobrePastilla({ x: 960, y: 900 }, ventana, rect)).toBe(false);
  });
  it('sin rectángulo conocido es false', () => {
    expect(cursorSobrePastilla({ x: 960, y: 988 }, ventana, null)).toBe(false);
  });
});

describe('posicionPastilla', () => {
  it('sin posición guardada va abajo al centro de la pantalla principal', () => {
    expect(posicionPastilla(null, [principal], principal, tam)).toEqual({ x: 810, y: 1040 - 64 - 40 });
  });

  it('respeta una posición guardada que está dentro de una pantalla', () => {
    expect(posicionPastilla({ x: 20, y: 500 }, [principal], principal, tam)).toEqual({ x: 20, y: 500 });
    expect(posicionPastilla({ x: 2500, y: 300 }, [principal, segunda], principal, tam)).toEqual({ x: 2500, y: 300 });
  });

  it('si la pantalla donde estaba ya no existe, vuelve al lugar por defecto', () => {
    expect(posicionPastilla({ x: 2500, y: 300 }, [principal], principal, tam)).toEqual({ x: 810, y: 936 });
  });

  it('si quedó medio afuera, la mete en el borde', () => {
    expect(posicionPastilla({ x: 1800, y: 1010 }, [principal], principal, tam)).toEqual({ x: 1620, y: 976 });
  });
});
