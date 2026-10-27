import { describe, it, expect } from 'vitest';
import { buscarHistorial, mezclarImportacion, calcularStats, calcularInsights } from '../src/main/logicaPanel.js';
import { copiaFabrica } from '../src/main/promptsFabrica.js';

const h = (id, pulido, fecha = '2026-10-16T10:00:00Z', extra = {}) => ({ id, pulido, crudo: '', fecha, palabras: 2, duracionSeg: 1, estado: 'pulido', ...extra });

describe('buscarHistorial', () => {
  it('encuentra sin tildes ni mayúsculas, más recientes primero', () => {
    const lista = [h('a', 'Una canción', '2026-10-15T10:00:00Z'), h('b', 'otra cosa'), h('c', 'CANCION nueva', '2026-10-16T11:00:00Z')];
    const r = buscarHistorial(lista, { busqueda: 'cancion', pagina: 0 });
    expect(r.items.map((x) => x.id)).toEqual(['c', 'a']);
    expect(r.total).toBe(2);
  });

  it('pagina de a 50', () => {
    const lista = Array.from({ length: 120 }, (_, i) => h(`i${i}`, 'x', new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()));
    expect(buscarHistorial(lista, { busqueda: '', pagina: 0 }).items).toHaveLength(50);
    expect(buscarHistorial(lista, { busqueda: '', pagina: 2 }).items).toHaveLength(20);
  });

  it('oculta las entradas vacías', () => {
    expect(buscarHistorial([h('v', '', undefined, { estado: 'vacio' })], { busqueda: '', pagina: 0 }).total).toBe(0);
  });
});

describe('mezclarImportacion', () => {
  const importado = {
    palabras: [{ id: 'w1', frase: 'Avalom', reemplazo: null }],
    snippets: [{ id: 'w2', frase: 'mi correo', texto: 'a@b.com' }],
    comandos: [{ id: 'w3', nombre: 'Organizar ideas', texto: 'x' }],
    historial: [h('wispr-1', 'Hola.')],
  };

  it('agrega lo nuevo y cuenta', () => {
    const r = mezclarImportacion({ palabras: [], snippets: [] }, { comandos: [] }, [], importado);
    expect(r.conteo).toEqual({ palabras: 1, snippets: 1, comandos: 1, historial: 1 });
  });

  it('importar dos veces no duplica (palabras sin tildes/mayúsculas, comandos por nombre)', () => {
    const dic = { palabras: [{ id: 'x', frase: 'avalom', reemplazo: null }], snippets: [{ id: 'y', frase: 'Mi Correo', texto: 'a@b.com' }] };
    const prompts = { comandos: [{ id: 'organizar', nombre: 'Organizar ideas', texto: 'y' }] };
    const r = mezclarImportacion(dic, prompts, [h('wispr-1', 'Hola.')], importado);
    expect(r.conteo).toEqual({ palabras: 0, snippets: 0, comandos: 0, historial: 0 });
    expect(r.diccionario.palabras).toHaveLength(1);
  });
});

describe('calcularInsights', () => {
  const prompts = copiaFabrica();
  const ahora = new Date('2026-10-16T15:00:00');
  const dia = (d, extra) => h(`x${d}${Math.random()}`, 'a', new Date(`2026-10-${String(d).padStart(2, '0')}T10:00:00`).toISOString(), { palabras: 10, duracionSeg: 6, ...extra });

  it('cuenta palabras corregidas entre lo crudo y lo pulido', () => {
    const r = calcularInsights([dia(16, { crudo: 'eh hola avalom como estas', pulido: 'Hola, Avalom, ¿cómo estás?' })], prompts, ahora);
    expect(r.palabrasCorregidas).toBe(1);
  });

  it('agrupa el uso por estilo de la app y da porcentajes', () => {
    const lista = [dia(16, { app: 'claude' }), dia(16, { app: 'claude' }), dia(16, { app: 'claude' }), dia(16, { app: 'WINWORD' })];
    const r = calcularInsights(lista, prompts, ahora);
    expect(r.uso[0]).toMatchObject({ nombre: 'Claude / IA', dictados: 3, porcentaje: 75 });
    expect(r.uso[1]).toMatchObject({ nombre: 'Documentos', dictados: 1, porcentaje: 25 });
    expect(r.appsDistintas).toBe(2);
  });

  it('calcula racha actual, la más larga y el mapa de días', () => {
    const lista = [1, 2, 3, 4, 5, 10, 14, 15, 16].map((d) => dia(d));
    const r = calcularInsights(lista, prompts, ahora);
    expect(r.rachaActual).toBe(3);
    expect(r.rachaMasLarga).toBe(5);
    expect(r.mapa).toHaveLength(20 * 7);
    expect(r.mapa.at(-1)).toMatchObject({ fecha: '2026-10-16', palabras: 10 });
  });

  it('libros escritos cada 100.000 palabras', () => {
    const r = calcularInsights([dia(16, { palabras: 252145 })], prompts, ahora);
    expect(r.totalPalabras).toBe(252145);
    expect(r.libros).toBe(2);
  });
});

describe('calcularStats', () => {
  it('cuenta palabras de hoy, racha de días y ppm', () => {
    const ahora = new Date('2026-10-16T15:00:00');
    const lista = [
      h('1', 'a b', new Date('2026-10-16T09:00:00').toISOString(), { palabras: 10, duracionSeg: 6 }),
      h('2', 'a b', new Date('2026-10-15T09:00:00').toISOString(), { palabras: 20, duracionSeg: 6 }),
      h('3', 'a b', new Date('2026-10-14T09:00:00').toISOString(), { palabras: 30, duracionSeg: 12 }),
      h('4', 'a b', new Date('2026-10-10T09:00:00').toISOString(), { palabras: 5, duracionSeg: 3 }),
    ];
    const s = calcularStats(lista, ahora);
    expect(s.palabrasHoy).toBe(10);
    expect(s.racha).toBe(3);
    expect(s.ppm).toBe(Math.round(65 / (27 / 60)));
    expect(s.ultimos.map((x) => x.id)).toEqual(['1', '2', '3', '4']);
  });
});
