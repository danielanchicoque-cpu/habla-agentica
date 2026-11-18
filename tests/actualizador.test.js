import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { crearActualizador } from '../src/main/actualizador.js';

function falso({ hayNueva = false, falla = false } = {}) {
  const u = new EventEmitter();
  u.llamadas = [];
  u.checkForUpdates = async () => {
    u.llamadas.push('buscar');
    u.emit('checking-for-update');
    if (falla) { const e = new Error('sin red'); u.emit('error', e); throw e; }
    if (hayNueva) {
      u.emit('update-available', { version: '0.3.0' });
      u.emit('download-progress', { percent: 42.4 });
      u.emit('update-downloaded', { version: '0.3.0' });
    } else {
      u.emit('update-not-available', {});
    }
  };
  u.quitAndInstall = (...args) => u.llamadas.push(['instalar', ...args]);
  return u;
}

function crear(opciones) {
  const u = falso(opciones);
  const estados = [];
  const descargadas = [];
  const a = crearActualizador({
    autoUpdater: u,
    versionActual: '0.2.0',
    alCambiar: (e) => estados.push(e.estado),
    alDescargar: (v) => descargadas.push(v),
    programar: () => {},
    repetir: () => 0,
  });
  return { u, a, estados, descargadas };
}

describe('actualizador', () => {
  it('configura la descarga automática e instalación al cerrar', () => {
    const { u } = crear();
    expect(u.autoDownload).toBe(true);
    expect(u.autoInstallOnAppQuit).toBe(true);
    expect(u.allowPrerelease).toBe(false);
  });

  it('si no hay versión nueva queda "al-dia"', async () => {
    const { a, estados } = crear();
    const e = await a.buscar();
    expect(e.estado).toBe('al-dia');
    expect(estados).toEqual(['buscando', 'al-dia']);
  });

  it('descarga la nueva, avisa y deja el estado "lista"', async () => {
    const { a, descargadas } = crear({ hayNueva: true });
    const e = await a.buscar();
    expect(e).toMatchObject({ estado: 'lista', version: '0.3.0', progreso: 100, versionActual: '0.2.0' });
    expect(descargadas).toEqual(['0.3.0']);
  });

  it('un error de red queda en el estado y no lanza', async () => {
    const { a } = crear({ falla: true });
    const e = await a.buscar();
    expect(e.estado).toBe('error');
    expect(e.error).toContain('sin red');
  });

  it('solo instala cuando la descarga terminó', async () => {
    const { u, a } = crear({ hayNueva: true });
    expect(a.instalar()).toBe(false);
    await a.buscar();
    expect(a.instalar()).toBe(true);
    expect(u.llamadas).toContainEqual(['instalar', false, true]);
  });

  it('no vuelve a buscar mientras hay una versión lista', async () => {
    const { u, a } = crear({ hayNueva: true });
    await a.buscar();
    await a.buscar();
    expect(u.llamadas.filter((x) => x === 'buscar')).toHaveLength(1);
  });

  it('iniciar programa la primera revisión y una periódica', () => {
    const u = falso();
    const programadas = [];
    const repetidas = [];
    const a = crearActualizador({
      autoUpdater: u,
      versionActual: '0.2.0',
      programar: (fn, ms) => programadas.push(ms),
      repetir: (fn, ms) => { repetidas.push(ms); return 0; },
    });
    a.iniciar();
    expect(programadas).toEqual([15000]);
    expect(repetidas).toEqual([6 * 3600 * 1000]);
  });
});
