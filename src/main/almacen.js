const fs = require('node:fs');
const path = require('node:path');

// Guarda cada colección como <nombre>.json en `dir`, con escritura atómica.
function crearAlmacen(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const ruta = (nombre) => path.join(dir, `${nombre}.json`);

  function leer(nombre, porDefecto) {
    const archivo = ruta(nombre);
    if (!fs.existsSync(archivo)) return porDefecto;
    try {
      return JSON.parse(fs.readFileSync(archivo, 'utf8').replace(/^﻿/, ''));
    } catch {
      fs.renameSync(archivo, `${archivo}.corrupto`);
      return porDefecto;
    }
  }

  function escribir(nombre, valor) {
    const archivo = ruta(nombre);
    const tmp = `${archivo}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(valor, null, 2), 'utf8');
    fs.renameSync(tmp, archivo);
  }

  return { leer, escribir, dir };
}

module.exports = { crearAlmacen };
