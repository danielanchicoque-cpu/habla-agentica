import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crearAlmacen } from '../src/main/almacen.js';

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'habla-')); });

describe('almacen', () => {
  it('devuelve el valor por defecto si el archivo no existe', () => {
    expect(crearAlmacen(dir).leer('ajustes', { a: 1 })).toEqual({ a: 1 });
  });

  it('lee lo que escribió', () => {
    const a = crearAlmacen(dir);
    a.escribir('prompts', { base: 'hola', lista: [1, 2] });
    expect(a.leer('prompts', null)).toEqual({ base: 'hola', lista: [1, 2] });
  });

  it('un JSON corrupto devuelve el por defecto y se aparta como .corrupto', () => {
    fs.writeFileSync(path.join(dir, 'ajustes.json'), '{mal');
    expect(crearAlmacen(dir).leer('ajustes', { ok: true })).toEqual({ ok: true });
    expect(fs.existsSync(path.join(dir, 'ajustes.json.corrupto'))).toBe(true);
  });

  it('lee un JSON guardado con BOM (Bloc de notas / PowerShell)', () => {
    fs.writeFileSync(path.join(dir, 'ajustes.json'), '﻿{"sonidos":false}', 'utf8');
    expect(crearAlmacen(dir).leer('ajustes', {})).toEqual({ sonidos: false });
  });

  it('no deja archivos .tmp tras escribir', () => {
    crearAlmacen(dir).escribir('historial', []);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
