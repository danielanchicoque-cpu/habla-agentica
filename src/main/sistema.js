// Wrapper del ayudante PowerShell (ventana activa, teclas y silenciar audio).
const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

const TIMEOUT_MS = 1500;
const TIMEOUT_ARRANQUE_MS = 8000; // la primera petición compila el C#
const TIMEOUTS_PARA_REINICIAR = 3;

function rutaAyudante() {
  // Empaquetada, el .ps1 vive desempaquetado junto al asar.
  return path.join(__dirname, 'ayudante.ps1').replace('app.asar', 'app.asar.unpacked');
}

function crearSistema({ ruta = rutaAyudante(), timeoutMs = TIMEOUT_MS, timeoutArranqueMs = TIMEOUT_ARRANQUE_MS } = {}) {
  let hijo = null;
  let siguienteId = 1;
  let recienArrancado = false;
  let timeoutsSeguidos = 0;
  let reinicios = 0;
  const pendientes = new Map();

  function arrancar() {
    const esteHijo = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ruta], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    hijo = esteHijo;
    // Sin estos oyentes, un PowerShell bloqueado o muerto tumbaría la app.
    esteHijo.on('error', () => {});
    esteHijo.stdin.on('error', () => {});
    readline.createInterface({ input: esteHijo.stdout }).on('line', (linea) => {
      let r;
      try { r = JSON.parse(linea.replace(/^﻿/, '')); } catch { return; }
      const p = pendientes.get(r.id);
      if (!p) return;
      pendientes.delete(r.id);
      clearTimeout(p.timer);
      timeoutsSeguidos = 0;
      if (r.ok) p.resolver(r.valor);
      else p.rechazar(new Error(r.valor));
    });
    esteHijo.on('exit', () => {
      if (hijo === esteHijo) hijo = null;
      for (const p of pendientes.values()) { clearTimeout(p.timer); p.rechazar(new Error('ayudante terminó')); }
      pendientes.clear();
    });
  }

  function cerrar() {
    if (!hijo) return;
    const h = hijo;
    hijo = null;
    try { h.stdin.end(); } catch { /* ya cerrado */ }
    h.kill();
  }

  function pedir(cmd, extra = {}, esperaPropia) {
    if (!hijo) { arrancar(); recienArrancado = true; }
    const id = siguienteId++;
    return new Promise((resolver, rechazar) => {
      const espera = esperaPropia || (recienArrancado ? timeoutArranqueMs : timeoutMs);
      recienArrancado = false;
      const timer = setTimeout(() => {
        pendientes.delete(id);
        rechazar(new Error('timeout del ayudante'));
        // Un ayudante colgado (p. ej. una llamada de audio trabada) se reinicia.
        if (++timeoutsSeguidos >= TIMEOUTS_PARA_REINICIAR) {
          timeoutsSeguidos = 0;
          reinicios++;
          cerrar();
        }
      }, espera);
      pendientes.set(id, { resolver, rechazar, timer });
      hijo.stdin.write(`${JSON.stringify({ id, cmd, ...extra })}\n`);
    });
  }

  return {
    // La primera petición compila el C# y tarda más; precalentar al arrancar.
    calentar: () => pedir('proceso').catch(() => {}),
    procesoActivo: () => pedir('proceso').then((v) => v || '').catch(() => ''),
    silenciar: () => pedir('silenciar').catch(() => {}),
    // null si no se pudo consultar (en ese caso no se corrige nada).
    teclasAbajo: (codigos) => pedir('teclas', { codigos }).then((v) => (Array.isArray(v) ? v : v == null ? [] : [v])).catch(() => null),
    restaurarAudio: () => pedir('restaurar').catch(() => {}),
    // Texto del campo activo (UI Automation) o null. La primera vez carga las
    // librerías y tarda más.
    textoEnfocado: () => pedir('texto', {}, 5000).then((v) => (typeof v === 'string' && v ? v : null)).catch(() => null),
    cerrar,
    reinicios: () => reinicios,
  };
}

module.exports = { crearSistema };
