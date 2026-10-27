import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { crearSistema } from '../src/main/sistema.js';

describe.skipIf(process.platform !== 'win32')('sistema (ayudante PowerShell)', () => {
  it('M1: si el script del ayudante no existe, responde vacío sin tumbar el proceso', async () => {
    const errores = [];
    const alError = (e) => errores.push(e);
    process.on('uncaughtException', alError);
    const s = crearSistema({ ruta: path.join(os.tmpdir(), 'no-existe-habla.ps1') });
    expect(await s.procesoActivo()).toBe('');
    expect(await s.procesoActivo()).toBe('');
    await s.silenciar();
    await new Promise((r) => setTimeout(r, 300));
    process.off('uncaughtException', alError);
    s.cerrar();
    expect(errores).toEqual([]);
  }, 30000);

  it('M1: un ayudante colgado se reinicia tras varios timeouts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ayud-'));
    const colgado = path.join(dir, 'colgado.ps1');
    fs.writeFileSync(colgado, 'Start-Sleep -Seconds 600');
    const s = crearSistema({ ruta: colgado, timeoutMs: 200, timeoutArranqueMs: 200 });
    for (let i = 0; i < 3; i++) expect(await s.procesoActivo()).toBe('');
    expect(s.reinicios()).toBeGreaterThanOrEqual(1);
    s.cerrar();
  }, 30000);
});
