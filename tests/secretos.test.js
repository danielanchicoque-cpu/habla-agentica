import { describe, it, expect } from 'vitest';
import { crearSecretos } from '../src/main/secretos.js';

const safeStorageFalso = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`cifrado:${s}`),
  decryptString: (b) => b.toString().replace(/^cifrado:/, ''),
};

function almacenFalso() {
  const datos = {};
  return { datos, leer: (n, d) => datos[n] ?? d, escribir: (n, v) => { datos[n] = v; } };
}

describe('secretos', () => {
  it('sin key guardada importa la de DPAPI y la deja cifrada en ajustes', async () => {
    const almacen = almacenFalso();
    const s = crearSecretos({ safeStorage: safeStorageFalso, almacen, leerDpapi: async () => 'gsk_x' });
    expect(await s.obtenerKey()).toBe('gsk_x');
    expect(almacen.datos.ajustes.keyCifrada).toBe(Buffer.from('cifrado:gsk_x').toString('base64'));
  });

  it('si DPAPI no tiene nada devuelve null', async () => {
    const s = crearSecretos({ safeStorage: safeStorageFalso, almacen: almacenFalso(), leerDpapi: async () => null });
    expect(await s.obtenerKey()).toBeNull();
  });

  it('ignora lo que no parece una key de Groq', async () => {
    const s = crearSecretos({ safeStorage: safeStorageFalso, almacen: almacenFalso(), leerDpapi: async () => 'Error: no existe' });
    expect(await s.obtenerKey()).toBeNull();
  });

  it('guardarKey y obtenerKey hacen ida y vuelta sin tocar otros ajustes', async () => {
    const almacen = almacenFalso();
    almacen.datos.ajustes = { sonidos: true };
    const s = crearSecretos({ safeStorage: safeStorageFalso, almacen, leerDpapi: async () => null });
    s.guardarKey('gsk_nueva');
    expect(await s.obtenerKey()).toBe('gsk_nueva');
    expect(almacen.datos.ajustes.sonidos).toBe(true);
  });
});
