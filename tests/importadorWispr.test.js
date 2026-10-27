import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { importarWispr } from '../src/main/importadorWispr.js';

let ruta;
let mtimeAntes;

beforeAll(() => {
  ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wispr-')), 'flow.sqlite');
  const db = new DatabaseSync(ruta);
  db.exec(`
    CREATE TABLE Dictionary (id TEXT, phrase TEXT, replacement TEXT, isDeleted INTEGER, isSnippet INTEGER);
    CREATE TABLE History (transcriptEntityId TEXT, asrText TEXT, formattedText TEXT, timestamp TEXT, status TEXT, app TEXT, duration REAL, numWords INTEGER);
    INSERT INTO Dictionary VALUES
      ('1','Avalom',NULL,0,0),
      ('2','btw','by the way',0,0),
      ('3','Wispr Flow',NULL,0,0),
      ('4','Borrada',NULL,1,0),
      ('5','my email address','yo@correo.com',0,1),
      ('6','my Flow referral','Hey https://wisprflow.ai/r/ABC123',0,1),
      ('7','organize thoughts prompt','Organize these thoughts',0,1),
      ('8','Claude Peligroso','claude --dangerously-skip-permissions ',0,1);
    INSERT INTO History VALUES
      ('h1','eh hola','Hola.','2026-07-24 19:39:39.151 +00:00','formatted','claude',3.5,1),
      ('h2','nada','','2026-07-24 19:40:00.000 +00:00','dismissed','claude',0.4,0);
  `);
  db.close();
  mtimeAntes = fs.statSync(ruta).mtimeMs;
});

describe('importarWispr', () => {
  it('importa palabras sin las borradas ni "Wispr Flow"', async () => {
    const r = await importarWispr(ruta);
    expect(r.palabras.map((p) => p.frase)).toEqual(['Avalom', 'btw']);
    expect(r.palabras[0].reemplazo).toBeNull();
    expect(r.palabras[1].reemplazo).toBe('by the way');
  });

  it('importa snippets traduciendo "my email address" y sin el referido', async () => {
    const r = await importarWispr(ruta);
    expect(r.snippets).toEqual([
      expect.objectContaining({ frase: 'mi correo', texto: 'yo@correo.com' }),
      expect.objectContaining({ frase: 'Claude Peligroso', texto: 'claude --dangerously-skip-permissions ' }),
    ]);
  });

  it('un snippet "... prompt" se vuelve comando "Organizar ideas"', async () => {
    const r = await importarWispr(ruta);
    expect(r.comandos).toHaveLength(1);
    expect(r.comandos[0]).toMatchObject({ nombre: 'Organizar ideas', texto: 'Organize these thoughts' });
  });

  it('importa solo el historial formateado', async () => {
    const r = await importarWispr(ruta);
    expect(r.historial).toHaveLength(1);
    expect(r.historial[0]).toMatchObject({
      id: 'wispr-h1', crudo: 'eh hola', pulido: 'Hola.', app: 'claude',
      duracionSeg: 3.5, palabras: 1, estado: 'importado', fecha: '2026-07-24T19:39:39.151Z',
    });
  });

  it('no modifica la base de Wispr', async () => {
    await importarWispr(ruta);
    expect(fs.statSync(ruta).mtimeMs).toBe(mtimeAntes);
  });
});
