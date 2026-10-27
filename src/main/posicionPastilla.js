// Calcula dónde poner la ventana de la pastilla: la posición que el usuario
// guardó al arrastrarla (metida dentro de su pantalla) o, si esa pantalla ya
// no está, abajo al centro de la pantalla principal.
const MARGEN_INFERIOR = 40;

function seCruza(r, x, y, ancho, alto) {
  return x < r.x + r.width && x + ancho > r.x && y < r.y + r.height && y + alto > r.y;
}

function posicionPastilla(guardada, pantallas, principal, { ancho, alto }) {
  if (guardada && Number.isFinite(guardada.x) && Number.isFinite(guardada.y)) {
    const pantalla = pantallas.find((p) => seCruza(p.workArea, guardada.x, guardada.y, ancho, alto));
    if (pantalla) {
      const r = pantalla.workArea;
      return {
        x: Math.min(Math.max(guardada.x, r.x), r.x + r.width - ancho),
        y: Math.min(Math.max(guardada.y, r.y), r.y + r.height - alto),
      };
    }
  }
  const r = principal.workArea;
  return { x: Math.round(r.x + (r.width - ancho) / 2), y: r.y + r.height - alto - MARGEN_INFERIOR };
}

// ¿El cursor (coordenadas de pantalla) está sobre la pastilla? `rect` es la
// pastilla dentro de la ventana; el margen la hace más fácil de agarrar.
const MARGEN_PUNTERO = 6;
function cursorSobrePastilla(cursor, ventana, rect) {
  if (!rect) return false;
  const x = ventana.x + rect.x;
  const y = ventana.y + rect.y;
  return cursor.x >= x - MARGEN_PUNTERO && cursor.x <= x + rect.width + MARGEN_PUNTERO
    && cursor.y >= y - MARGEN_PUNTERO && cursor.y <= y + rect.height + MARGEN_PUNTERO;
}

module.exports = { posicionPastilla, cursorSobrePastilla };
