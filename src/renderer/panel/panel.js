// Panel de Habla Agéntica: Inicio, Prompts, Diccionario, Historial y Ajustes.
const api = window.habla;
const principal = document.getElementById('contenido');
let contenido = document.createElement('div'); // contenedor de la sección en construcción
let turnoNavegacion = 0;

const TECLAS = {"1":"Esc","2":"1","3":"2","4":"3","5":"4","6":"5","7":"6","8":"7","9":"8","10":"9","11":"0","14":"Retroceso","15":"Tab","16":"Q","17":"W","18":"E","19":"R","20":"T","21":"Y","22":"U","23":"I","24":"O","25":"P","28":"Enter","29":"Ctrl izq","30":"A","31":"S","32":"D","33":"F","34":"G","35":"H","36":"J","37":"K","38":"L","42":"Shift izq","44":"Z","45":"X","46":"C","47":"V","48":"B","49":"N","50":"M","54":"Shift der","56":"Alt izq","57":"Espacio","58":"Bloq Mayús","59":"F1","60":"F2","61":"F3","62":"F4","63":"F5","64":"F6","65":"F7","66":"F8","67":"F9","68":"F10","87":"F11","88":"F12","3613":"Ctrl der","3640":"Alt der","3675":"Win izq","3676":"Win der"};
TECLAS['86'] = '< >';
TECLAS['3666'] = 'Insert'; TECLAS['70'] = 'Bloq Despl'; TECLAS['3653'] = 'Pausa';
// Teclas que sirven como atajo por sí solas: no escriben ni hacen nada al
// soltarlas. No se incluyen Win (abre Inicio), Alt (activa menús), Alt der
// (es AltGr, para @), Bloq Mayús, Shift ni Ctrl izq (se usan a cada rato).
const TECLAS_SOLAS = new Set([3613, 3666, 70, 3653]);
const nombreAtajo =(codigos) => (codigos || []).map((c) => TECLAS[c] || `Tecla ${c}`).join(' + ');

// ---------- utilidades ----------
function el(tag, attrs = {}, ...hijos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else if (k === 'checked') n.checked = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const h of hijos.flat(Infinity)) {
    if (h === null || h === undefined || h === false) continue;
    n.append(h instanceof Node ? h : document.createTextNode(String(h)));
  }
  return n;
}

// Reemplaza los hijos de `nodo`, aplanando listas e ignorando valores vacíos.
function poner(nodo, ...hijos) {
  nodo.replaceChildren();
  for (const h of hijos.flat(Infinity)) {
    if (h === null || h === undefined || h === false) continue;
    nodo.append(h instanceof Node ? h : document.createTextNode(String(h)));
  }
}

let timerToast;
function toast(texto, error = false) {
  const t = document.getElementById('toast');
  t.textContent = texto;
  t.className = `visible${error ? ' error' : ''}`;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => { t.className = ''; }, 2600);
}

function cabecera(titulo, sub, ...derecha) {
  return el('div', { class: 'cabecera' }, el('div', {}, el('h1', {}, titulo), sub && el('p', { class: 'sub' }, sub)), el('div', { class: 'fila' }, ...derecha));
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const id = () => Math.random().toString(36).slice(2, 10);
const fechaCorta = (iso) => new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const numero = (n) => (n || 0).toLocaleString('es-CO');

function interruptor(titulo, descripcion, valor, alCambiar) {
  return el('label', { class: 'interruptor' },
    el('div', {}, titulo, descripcion && el('small', {}, descripcion)),
    el('span', { class: 'switch' }, el('input', { type: 'checkbox', role: 'switch', checked: valor, onchange: (e) => alCambiar(e.target.checked) }), el('i')));
}

// ---------- actualizaciones ----------
let estadoActualizacion = null;
let alCambiarActualizacion = null; // la tarjeta de Ajustes se repinta con esto

function textoActualizacion(e) {
  if (!e) return '';
  if (e.estado === 'desarrollo') return 'Estás en modo desarrollo: aquí no se actualiza solo.';
  if (e.estado === 'buscando') return 'Buscando actualizaciones…';
  if (e.estado === 'descargando') return `Descargando la versión ${e.version}… ${e.progreso}%`;
  if (e.estado === 'lista') return `La versión ${e.version} está lista para instalar.`;
  if (e.estado === 'error') return 'No pude buscar actualizaciones ahora (¿sin internet?). Reintento más tarde.';
  return `Tienes la última versión (${e.versionActual}).`;
}

function pintarBannerActualizacion(e) {
  const b = document.getElementById('banner-actualizacion');
  if (!e || (e.estado !== 'descargando' && e.estado !== 'lista')) { b.hidden = true; return; }
  b.hidden = false;
  poner(b, el('strong', {}, e.estado === 'lista' ? `Nueva versión ${e.version}` : 'Descargando actualización…'),
    e.estado === 'lista'
      ? el('button', { class: 'btn chico primario', onclick: () => api.instalarActualizacion() }, 'Reiniciar y actualizar')
      : `${e.progreso}%`);
}

function alLlegarEstadoActualizacion(e) {
  estadoActualizacion = e;
  pintarBannerActualizacion(e);
  if (alCambiarActualizacion) alCambiarActualizacion(e);
}
api.alActualizar(alLlegarEstadoActualizacion);
api.estadoActualizacion().then(alLlegarEstadoActualizacion);

// ---------- navegación ----------
const secciones = { inicio: verInicio, prompts: verPrompts, diccionario: verDiccionario, historial: verHistorial, estadisticas: verEstadisticas, ajustes: verAjustes };
let actual = null;

async function ir(seccion) {
  if (!secciones[seccion]) seccion = 'inicio';
  actual = seccion;
  document.querySelectorAll('nav button').forEach((b) => {
    if (b.dataset.seccion === seccion) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  // Cada sección se arma en un contenedor nuevo y solo se muestra si sigue
  // siendo la última pedida (evita que una sección lenta pise a otra).
  const turno = ++turnoNavegacion;
  contenido = document.createElement('div');
  await secciones[seccion]();
  if (turno !== turnoNavegacion) return;
  principal.replaceChildren(contenido);
  principal.scrollTop = 0;
}

document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => ir(b.dataset.seccion)));
api.alIr((s) => ir(s));

async function refrescarLateral() {
  const [estadoKey, ajustes] = await Promise.all([api.estadoKey(), api.leerAjustes()]);
  const chip = document.getElementById('estado-key');
  chip.className = `chip-estado ${estadoKey}`;
  chip.textContent = estadoKey === 'ok' ? 'Lista para dictar' : 'Falta la key de Groq';
  document.getElementById('atajo-lateral').textContent = nombreAtajo(ajustes.atajoDictado);
}

function tarjetaActualizacion() {
  const estado = el('p', { class: 'sub', style: 'margin:0 0 12px' });
  const boton = el('button', { class: 'btn' }, 'Buscar actualizaciones');
  const pintar = (e) => {
    estado.textContent = textoActualizacion(e);
    const lista = e && e.estado === 'lista';
    boton.textContent = lista ? 'Reiniciar y actualizar' : 'Buscar actualizaciones';
    boton.className = lista ? 'btn primario' : 'btn';
    boton.disabled = !!e && (e.estado === 'buscando' || e.estado === 'descargando' || e.estado === 'desarrollo');
  };
  boton.addEventListener('click', async () => {
    if (estadoActualizacion && estadoActualizacion.estado === 'lista') { api.instalarActualizacion(); return; }
    boton.disabled = true;
    pintar(await api.buscarActualizacion());
  });
  alCambiarActualizacion = pintar;
  pintar(estadoActualizacion);
  return el('div', { class: 'tarjeta' },
    el('h2', {}, 'Actualizaciones'),
    estado,
    boton);
}

// ---------- Inicio ----------
async function verInicio() {
  const [s, ajustes] = await Promise.all([api.stats(), api.leerAjustes()]);
  contenido.append(
    cabecera('Hola 👋', 'Tu voz, pulida y pegada donde estés.'),
    el('div', { class: 'metricas' },
      el('div', { class: 'metrica' }, el('b', {}, numero(s.palabrasHoy)), el('span', {}, 'palabras hoy')),
      el('div', { class: 'metrica' }, el('b', {}, `${s.racha} ${s.racha === 1 ? 'día' : 'días'}`), el('span', {}, 'de racha')),
      el('div', { class: 'metrica' }, el('b', {}, numero(s.ppm)), el('span', {}, 'palabras por minuto'))),
    el('div', { class: 'tarjeta destacada' },
      el('h2', {}, 'Cómo dictar'),
      el('p', { class: 'sub' }, 'Mantén ', el('kbd', {}, nombreAtajo(ajustes.atajoDictado)), ' mientras hablas y suelta para pegar. ',
        'Doble toque para dejarlo grabando (manos libres). ', el('kbd', {}, 'Esc'), ' cancela.'),
      el('p', { class: 'sub' }, 'Modo comando: selecciona un texto, mantén ', el('kbd', {}, nombreAtajo(ajustes.atajoComando)), ' y di qué hacer con él ("hazlo más formal").')),
    el('div', { class: 'tarjeta' },
      el('div', { class: 'fila entre' }, el('h2', {}, 'Últimos dictados'), el('button', { class: 'btn chico', onclick: () => ir('historial') }, 'Ver todo')),
      s.ultimos.length
        ? el('div', { class: 'lista' }, s.ultimos.map((h) => renglonDictado(h)))
        : el('p', { class: 'vacio-lista' }, 'Aún no has dictado nada. ¡Prueba el atajo!')),
  );
}

// ---------- Prompts ----------
let promptsEstado = null;
let promptSeleccionado = 'claude-ia';

async function verPrompts() {
  promptsEstado = await api.leerPrompts();
  const fabrica = await api.promptsFabrica();
  const indicador = el('span', { class: 'guardado' });
  const guardar = debounce(async () => {
    await api.guardarPrompts(promptsEstado);
    indicador.textContent = 'Guardado ✓';
    indicador.className = 'guardado si';
  }, 600);
  const cambiado = () => { indicador.textContent = 'Guardando…'; indicador.className = 'guardado'; guardar(); };

  const lista = el('div', { class: 'lista-prompts' });
  const editor = el('div', { class: 'tarjeta' });

  function buscar(idP) {
    if (idP === 'base') return { tipo: 'base' };
    const app = promptsEstado.porApp.find((p) => p.id === idP);
    if (app) return { tipo: 'app', p: app };
    if (promptsEstado.porDefecto.id === idP) return { tipo: 'defecto', p: promptsEstado.porDefecto };
    const c = promptsEstado.comandos.find((p) => p.id === idP);
    if (c) return { tipo: 'comando', p: c };
    return { tipo: 'base' };
  }

  function pintarLista() {
    const item = (idP, titulo, sub) => el('button', {
      class: 'item-prompt', 'aria-current': String(promptSeleccionado === idP),
      onclick: () => { promptSeleccionado = idP; pintarLista(); pintarEditor(); },
    }, titulo, sub && el('small', {}, sub));
    poner(lista, 
      el('h3', {}, 'General'),
      item('base', 'Reglas generales', 'Aplican en todas las apps'),
      el('h3', {}, 'Estilos por app'),
      promptsEstado.porApp.map((p) => item(p.id, p.nombre, p.procesos.join(', ') || 'Sin apps')),
      item(promptsEstado.porDefecto.id, promptsEstado.porDefecto.nombre, 'Cualquier otra app'),
      el('button', { class: 'btn chico', onclick: () => {
        const nuevo = { id: `app-${id()}`, nombre: 'Nuevo prompt', procesos: [], texto: '' };
        promptsEstado.porApp.push(nuevo); promptSeleccionado = nuevo.id; cambiado(); pintarLista(); pintarEditor();
      } }, '+ Estilo para una app'),
      el('h3', {}, 'Comandos (sobre texto seleccionado)'),
      promptsEstado.comandos.map((c) => item(c.id, c.nombre)),
      el('button', { class: 'btn chico', onclick: () => {
        const nuevo = { id: `cmd-${id()}`, nombre: 'Nuevo comando', texto: '' };
        promptsEstado.comandos.push(nuevo); promptSeleccionado = nuevo.id; cambiado(); pintarLista(); pintarEditor();
      } }, '+ Comando'),
    );
  }

  function pintarEditor() {
    const { tipo, p } = buscar(promptSeleccionado);
    const textoActual = tipo === 'base' ? promptsEstado.base : p.texto;
    const original = tipo === 'base' ? fabrica.base
      : tipo === 'defecto' ? fabrica.porDefecto.texto
      : (fabrica.porApp.find((x) => x.id === p.id) || fabrica.comandos.find((x) => x.id === p.id) || {}).texto;

    const area = el('textarea', { rows: 12, 'aria-label': 'Texto del prompt', oninput: (e) => {
      if (tipo === 'base') promptsEstado.base = e.target.value; else p.texto = e.target.value;
      cambiado();
    } });
    area.value = textoActual;

    const partes = [];
    if (tipo === 'app' || tipo === 'comando') {
      partes.push(el('label', { class: 'campo' }, el('span', {}, 'Nombre'),
        el('input', { type: 'text', value: p.nombre, oninput: (e) => { p.nombre = e.target.value; cambiado(); pintarLista(); } })));
    }
    if (tipo === 'app') partes.push(editorProcesos(p, () => { cambiado(); pintarLista(); }));
    partes.push(el('label', { class: 'campo' }, el('span', {},
      tipo === 'comando' ? 'Qué hace este comando con el texto seleccionado' : 'Instrucciones para pulir el dictado'), area));

    const entrada = el('textarea', { rows: 4, placeholder: 'Escribe una frase como la dirías hablando: "eh bueno este necesito que me ayudes con…"' });
    const salida = el('div', { class: 'resultado vacio' }, 'Aquí verás el resultado.');
    const botonProbar = el('button', { class: 'btn primario', onclick: async () => {
      if (!entrada.value.trim()) { entrada.focus(); return; }
      botonProbar.disabled = true; botonProbar.textContent = 'Probando…';
      const r = await api.probarPrompt({ texto: entrada.value, promptId: promptSeleccionado });
      botonProbar.disabled = false; botonProbar.textContent = 'Probar';
      salida.className = 'resultado';
      salida.textContent = r.error || r.texto;
    } }, 'Probar');

    poner(editor, 
      el('div', { class: 'fila entre' },
        el('h2', {}, tipo === 'base' ? 'Reglas generales' : p.nombre),
        el('div', { class: 'fila' }, indicador,
          original !== undefined && el('button', { class: 'btn chico', onclick: () => {
            if (!confirm('¿Volver al texto original?')) return;
            if (tipo === 'base') promptsEstado.base = original; else p.texto = original;
            cambiado(); pintarEditor();
          } }, 'Restaurar original'),
          (tipo === 'app' || tipo === 'comando') && original === undefined && el('button', { class: 'btn chico peligro', onclick: () => {
            if (!confirm(`¿Borrar "${p.nombre}"?`)) return;
            const arr = tipo === 'app' ? promptsEstado.porApp : promptsEstado.comandos;
            arr.splice(arr.indexOf(p), 1);
            promptSeleccionado = 'base'; cambiado(); pintarLista(); pintarEditor();
          } }, 'Borrar'))),
      tipo === 'base' && el('p', { class: 'sub' }, 'Se combina con el prompt de la app donde estés dictando.'),
      el('div', { style: 'height:12px' }),
      ...partes,
      el('h2', {}, 'Probar'),
      el('div', { class: 'prueba' }, entrada, salida),
      el('div', { class: 'fila', style: 'margin-top:10px' }, botonProbar),
    );
  }

  contenido.append(
    cabecera('Estilos y comandos', 'Cómo escribe la IA en cada app, y qué hace con el texto que seleccionas. Se guarda solo.'),
    el('div', { class: 'prompts' }, lista, editor),
  );
  pintarLista();
  pintarEditor();
}

function editorProcesos(p, alCambiar) {
  const caja = el('div', { class: 'chips' });
  const pintar = () => {
    const input = el('input', { type: 'text', placeholder: p.procesos.length ? 'Agregar…' : 'Ej: claude, WINWORD, opera', onkeydown: (e) => {
      const v = e.target.value.trim().replace(/\.exe$/i, '');
      if ((e.key === 'Enter' || e.key === ',') && v) {
        e.preventDefault();
        if (!p.procesos.some((x) => x.toLowerCase() === v.toLowerCase())) p.procesos.push(v);
        alCambiar(); pintar(); caja.querySelector('input').focus();
      } else if (e.key === 'Backspace' && !e.target.value && p.procesos.length) {
        p.procesos.pop(); alCambiar(); pintar(); caja.querySelector('input').focus();
      }
    } });
    poner(caja, ...p.procesos.map((proc) => el('span', { class: 'chip' }, proc,
      el('button', { 'aria-label': `Quitar ${proc}`, onclick: () => { p.procesos.splice(p.procesos.indexOf(proc), 1); alCambiar(); pintar(); } }, '×'))), input);
  };
  pintar();
  return el('div', { class: 'campo', style: 'margin-bottom:14px' },
    el('span', { style: 'display:block;font-size:12px;color:var(--tenue);margin-bottom:6px' }, 'Apps donde aplica (nombre del proceso, Enter para agregar)'), caja);
}

// ---------- Diccionario ----------
let pestanaDic = 'palabras';

async function verDiccionario() {
  const dic = await api.leerDiccionario();
  const guardar = async () => { await api.guardarDiccionario(dic); };
  const cuerpo = el('div', { class: 'tarjeta' });

  function pintar() {
    const esPalabras = pestanaDic === 'palabras';
    const campo1 = el('input', { type: 'text', placeholder: esPalabras ? 'Palabra (ej: Avalom)' : 'Lo que dices (ej: mi correo)' });
    const campo2 = el('input', { type: 'text', placeholder: esPalabras ? 'Reemplazar por (opcional)' : 'Texto que se pega' });
    const agregar = async (e) => {
      e.preventDefault();
      const a = campo1.value.trim();
      const b = campo2.value;
      if (!a || (!esPalabras && !b.trim())) { campo1.focus(); return; }
      if (esPalabras) dic.palabras.unshift({ id: id(), frase: a, reemplazo: b.trim() || null });
      else dic.snippets.unshift({ id: id(), frase: a, texto: b });
      await guardar();
      pintar();
      toast('Agregado ✓');
    };
    const items = esPalabras ? dic.palabras : dic.snippets;
    poner(cuerpo, 
      el('p', { class: 'sub', style: 'margin:0 0 12px' }, esPalabras
        ? 'Palabras que siempre deben quedar bien escritas. Con reemplazo, cambia una palabra por otra.'
        : 'Atajos de voz: si dices la frase, se pega el texto completo.'),
      el('form', { class: 'fila', onsubmit: agregar, style: 'margin-bottom:10px' },
        el('div', { class: 'crece' }, campo1), el('div', { class: 'crece' }, campo2), el('button', { class: 'btn primario', type: 'submit' }, 'Agregar')),
      items.length
        ? el('div', { class: 'lista' }, items.map((x) => el('div', { class: 'renglon' },
          el('strong', { class: 'crece' }, x.frase, x.auto && el('span', { class: 'etiqueta', style: 'margin-left:8px', title: 'La app la aprendió de tus correcciones' }, 'Aprendida')),
          esPalabras
            ? (x.reemplazo ? [el('span', { class: 'flecha' }, '→'), el('span', { class: 'crece' }, x.reemplazo)] : el('span', { class: 'crece sub', style: 'margin:0' }, 'Escritura exacta'))
            : [el('span', { class: 'flecha' }, '→'), el('span', { class: 'crece', style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, x.texto)],
          el('div', { class: 'acciones' }, el('button', { class: 'btn chico peligro', 'aria-label': `Borrar ${x.frase}`, onclick: async () => {
            items.splice(items.indexOf(x), 1); await guardar(); pintar();
          } }, 'Borrar')))))
        : el('p', { class: 'vacio-lista' }, 'Nada por aquí todavía. Puedes importar tu diccionario de Wispr Flow en Ajustes.'),
    );
  }

  const tabs = el('div', { class: 'pestanas', role: 'tablist' },
    ['palabras', 'snippets'].map((p) => el('button', { role: 'tab', 'aria-selected': String(pestanaDic === p), onclick: () => {
      pestanaDic = p;
      tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.p === p)));
      pintar();
    }, 'data-p': p }, p === 'palabras' ? `Palabras (${dic.palabras.length})` : `Snippets (${dic.snippets.length})`)));

  contenido.append(cabecera('Diccionario', 'Lo que Habla Agéntica debe escribir siempre igual.'), tabs, cuerpo);
  pintar();
}

// ---------- Historial ----------
let busquedaHist = '';
let paginaHist = 0;

function renglonDictado(h, conAcciones = false, alCambiar) {
  const etiquetas = { error: ['error', 'Error'], crudo: ['crudo', 'Sin pulir'], importado: ['', 'Wispr'] };
  const [claseEt, textoEt] = etiquetas[h.estado] || [];
  const crudoVisible = el('p', { class: 'crudo', hidden: true }, h.crudo || '(sin texto crudo)');
  const campoEdicion = el('textarea', { rows: 4, style: 'width:100%;box-sizing:border-box' });
  campoEdicion.value = h.pulido || '';
  const editor = el('div', { hidden: true, style: 'margin-top:8px' },
    el('p', { class: 'sub', style: 'margin:0 0 6px' }, 'Corrige el texto. Si cambias una palabra, la app la aprende para la próxima.'),
    campoEdicion,
    el('div', { class: 'fila', style: 'margin-top:6px;gap:6px' },
      el('button', { class: 'btn chico primario', onclick: async () => {
        const r = await api.corregirHistorial(h.id, campoEdicion.value);
        if (!r.ok) { toast('El texto no puede quedar vacío', true); return; }
        toast(r.aprendidas.length ? `Aprendí: ${r.aprendidas.join(', ')}` : 'Guardado. No encontré palabras nuevas que aprender.');
        alCambiar && alCambiar();
      } }, 'Guardar y aprender'),
      el('button', { class: 'btn chico', onclick: () => { campoEdicion.value = h.pulido || ''; editor.hidden = true; } }, 'Cancelar')));
  return el('div', { class: 'dictado' },
    el('div', { class: 'meta' }, fechaCorta(h.fecha), h.app && el('span', {}, h.app), h.tiempos && el('span', { title: `Voz ${h.tiempos.voz} ms · Pulido ${h.tiempos.pulido} ms · Pegar ${h.tiempos.pegado} ms` }, `⏱ ${((h.tiempos.voz + h.tiempos.pulido + h.tiempos.pegado) / 1000).toFixed(1)} s`), textoEt && el('span', { class: `etiqueta ${claseEt}` }, textoEt), h.corregido && el('span', { class: 'etiqueta' }, 'Corregido'),
      conAcciones && el('div', { class: 'acciones', style: 'margin-left:auto;display:flex;gap:6px' },
        h.estado === 'error'
          ? el('button', { class: 'btn chico primario', onclick: async (e) => {
            e.target.disabled = true; e.target.textContent = 'Reintentando…';
            const r = await api.reintentarHistorial(h.id);
            toast(r && r.estado !== 'error' ? 'Listo, ya está en el historial' : 'Sigue fallando, revisa la conexión', !(r && r.estado !== 'error'));
            alCambiar();
          } }, 'Reintentar')
          : [
            el('button', { class: 'btn chico', onclick: () => { navigator.clipboard.writeText(h.pulido); toast('Copiado ✓'); } }, 'Copiar'),
            el('button', { class: 'btn chico', onclick: () => api.pegarHistorial(h.id) }, 'Pegar'),
            el('button', { class: 'btn chico', title: 'Corrige el texto y la app aprende las palabras', onclick: () => { editor.hidden = !editor.hidden; if (!editor.hidden) campoEdicion.focus(); } }, 'Corregir'),
            el('button', { class: 'btn chico', onclick: () => { crudoVisible.hidden = !crudoVisible.hidden; } }, 'Ver crudo'),
          ],
        el('button', { class: 'btn chico peligro', onclick: async () => { await api.borrarHistorial(h.id); alCambiar(); } }, 'Borrar'))),
    el('p', {}, h.pulido || (h.estado === 'error' ? 'El audio quedó guardado. Dale "Reintentar".' : '')),
    crudoVisible, editor);
}

async function verHistorial() {
  const lista = el('div', { class: 'lista' });
  const paginacion = el('div', { class: 'paginacion' });
  const tarjeta = el('div', { class: 'tarjeta' }, lista, paginacion);

  async function cargar() {
    const r = await api.listarHistorial({ busqueda: busquedaHist, pagina: paginaHist });
    const paginas = Math.max(1, Math.ceil(r.total / 50));
    poner(lista, ...(r.items.length
      ? r.items.map((h) => renglonDictado(h, true, cargar))
      : [el('p', { class: 'vacio-lista' }, busquedaHist ? 'No encontré dictados con eso.' : 'Tu historial está vacío.')]));
    poner(paginacion, 
      el('button', { class: 'btn chico', disabled: paginaHist === 0, onclick: () => { paginaHist--; cargar(); principal.scrollTop = 0; } }, '← Anterior'),
      `${numero(r.total)} dictados · página ${paginaHist + 1} de ${paginas}`,
      el('button', { class: 'btn chico', disabled: paginaHist >= paginas - 1, onclick: () => { paginaHist++; cargar(); principal.scrollTop = 0; } }, 'Siguiente →'));
  }

  const buscador = el('input', { type: 'search', placeholder: 'Buscar en tus dictados…', value: busquedaHist, style: 'width:280px',
    oninput: debounce((e) => { busquedaHist = e.target.value; paginaHist = 0; cargar(); }, 250) });
  contenido.append(cabecera('Historial', 'Todo lo que has dictado, en tu computador.', buscador), tarjeta);
  await cargar();
}

// ---------- Estadísticas ----------
async function verEstadisticas() {
  const r = await api.insights();
  const maxPalabras = Math.max(1, ...r.mapa.map((d) => d.palabras));
  const nivel = (p) => (p === 0 ? 0 : p < maxPalabras * 0.15 ? 1 : p < maxPalabras * 0.4 ? 2 : p < maxPalabras * 0.7 ? 3 : 4);

  // Columnas por semana (domingo a sábado), como un calendario.
  const semanas = [];
  let semana = new Array(r.mapa[0].diaSemana).fill(null);
  for (const d of r.mapa) {
    semana.push(d);
    if (semana.length === 7) { semanas.push(semana); semana = []; }
  }
  if (semana.length) semanas.push(semana.concat(new Array(7 - semana.length).fill(null)));
  const nombresMes = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  let mesAnterior = -1;
  const meses = semanas.map((s) => {
    const primero = s.find(Boolean);
    const m = primero ? Number(primero.fecha.slice(5, 7)) - 1 : -1;
    const etiqueta = m !== mesAnterior ? nombresMes[m] : '';
    mesAnterior = m;
    return el('span', {}, etiqueta);
  });
  const hoy = r.mapa[r.mapa.length - 1].fecha;
  const rachaDesde = new Date(`${hoy}T12:00:00`);
  rachaDesde.setDate(rachaDesde.getDate() - r.rachaActual + 1);
  const enRacha = (f) => r.rachaActual > 0 && new Date(`${f}T12:00:00`) >= rachaDesde;

  // Semicírculo de 0 a 200 palabras por minuto.
  const fraccion = Math.min(1, r.ppm / 200);
  const ang = Math.PI * (1 - fraccion);
  const fx = (60 + 48 * Math.cos(ang)).toFixed(1);
  const fy = (60 - 48 * Math.sin(ang)).toFixed(1);
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const medidor = svgEl('svg', { viewBox: '0 0 120 66', class: 'medidor', 'aria-hidden': 'true' });
  const defs = svgEl('defs', {});
  const grad = svgEl('linearGradient', { id: 'gm', x1: '0', x2: '1' });
  grad.append(svgEl('stop', { offset: '0', 'stop-color': '#7C3AED' }), svgEl('stop', { offset: '1', 'stop-color': '#C4B5FD' }));
  defs.append(grad);
  medidor.append(defs,
    svgEl('path', { d: 'M12 60 A48 48 0 0 1 108 60', fill: 'none', stroke: '#232328', 'stroke-width': '10', 'stroke-linecap': 'round' }),
    svgEl('path', { d: `M12 60 A48 48 0 0 1 ${fx} ${fy}`, fill: 'none', stroke: 'url(#gm)', 'stroke-width': '10', 'stroke-linecap': 'round' }));

  const libros = r.libros > 0
    ? `¡Ya escribiste ${r.libros === 1 ? 'un libro completo' : `${r.libros} libros completos`}! 📚`
    : `Vas en el ${Math.round(r.totalPalabras / 1000)}% de tu primer libro 📖`;

  contenido.append(
    cabecera('Estadísticas', 'Cómo usas tu voz para escribir.'),
    el('div', { class: 'metricas' },
      el('div', { class: 'metrica' }, el('b', {}, numero(r.ppm)), el('span', {}, 'palabras por minuto'), medidor),
      el('div', { class: 'metrica' }, el('b', {}, numero(r.palabrasCorregidas)), el('span', {}, 'palabras corregidas por la IA'),
        el('p', { class: 'sub detalle' }, `En ${numero(r.dictados)} dictados quitó muletillas y arregló palabras por ti.`)),
      el('div', { class: 'metrica' }, el('b', {}, numero(r.totalPalabras)), el('span', {}, 'palabras dictadas en total'),
        el('p', { class: 'sub detalle' }, libros))),
    el('div', { class: 'estadisticas' },
      el('div', { class: 'tarjeta' },
        el('div', { class: 'fila entre' }, el('h2', {}, 'Dónde dictas'), el('span', { class: 'sub', style: 'margin:0' }, `${r.appsDistintas} apps`)),
        el('div', { class: 'barras-uso' }, r.uso.map((u, i) => el('div', { class: 'barra-uso' },
          el('div', { class: 'pista' }, el('div', { class: `relleno${i === 0 ? ' principal' : ''}`, style: `width:${Math.max(u.porcentaje, 2)}%` }, i === 0 ? `${u.porcentaje}%` : '')),
          el('span', { class: 'pct' }, i === 0 ? '' : `${u.porcentaje}%`),
          el('span', { class: 'etiqueta-uso' }, `${numero(u.dictados)} dictados · ${u.nombre}`))))),
      el('div', { class: 'tarjeta' },
        el('div', { class: 'fila entre' }, el('h2', { class: 'grande' }, `${r.rachaActual} ${r.rachaActual === 1 ? 'día' : 'días'} de racha`),
          el('span', { class: 'sub', style: 'margin:0' }, `Racha más larga: ${r.rachaMasLarga} días`)),
        el('div', { class: 'meses' }, meses),
        el('div', { class: 'mapa' }, semanas.map((s) => el('div', { class: 'semana' }, s.map((d) => (d
          ? el('i', { class: `n${nivel(d.palabras)}${enRacha(d.fecha) && d.palabras ? ' racha' : ''}`, title: `${d.fecha}: ${numero(d.palabras)} palabras` })
          : el('i', { class: 'vacio' })))))),
        el('div', { class: 'leyenda' }, 'Menos', [0, 1, 2, 3, 4].map((n) => el('i', { class: `n${n}` })), 'Más',
          el('span', { style: 'margin-left:auto' }), el('i', { class: 'n4 racha' }), 'Racha actual'))),
  );
}

// ---------- Ajustes ----------
async function verAjustes() {
  const [ajustes, estadoKey, mics, hayWispr] = await Promise.all([api.leerAjustes(), api.estadoKey(), api.listarMics(), api.existeWispr()]);
  const guardar = async (parcial) => { Object.assign(ajustes, parcial); await api.guardarAjustes(parcial); toast('Guardado ✓'); refrescarLateral(); };

  // Key
  const campoKey = el('input', { type: 'password', placeholder: estadoKey === 'ok' ? '•••••••••••• (guardada)' : 'gsk_…', autocomplete: 'off' });
  const tarjetaKey = el('div', { class: `tarjeta${estadoKey === 'ok' ? '' : ' destacada'}` },
    el('h2', {}, 'Key de Groq'),
    el('p', { class: 'sub', style: 'margin:0 0 12px' }, estadoKey === 'ok' ? 'Guardada y cifrada en este computador.' : 'Hace falta para transcribir. Créala gratis en console.groq.com → API Keys.'),
    el('form', { class: 'fila', onsubmit: async (e) => {
      e.preventDefault();
      const r = await api.guardarKey(campoKey.value);
      if (r.ok) { toast('Key guardada ✓'); campoKey.value = ''; refrescarLateral(); ir('ajustes'); } else toast(r.error, true);
    } }, el('div', { class: 'crece' }, campoKey), el('button', { class: 'btn primario', type: 'submit' }, estadoKey === 'ok' ? 'Cambiar' : 'Guardar')));

  // Micrófono
  const selectorMic = el('select', { onchange: (e) => guardar({ micId: e.target.value || null }) },
    el('option', { value: '' }, 'Predeterminado de Windows'),
    mics.map((m) => el('option', { value: m.deviceId }, m.label)));
  selectorMic.value = ajustes.micId && mics.some((m) => m.deviceId === ajustes.micId) ? ajustes.micId : '';
  const micPerdido = ajustes.micId && !mics.some((m) => m.deviceId === ajustes.micId);

  // Atajos
  function filaAtajo(titulo, clave) {
    const kbd = el('kbd', {}, nombreAtajo(ajustes[clave]));
    const boton = el('button', { class: 'btn chico', onclick: async () => {
      boton.textContent = 'Presiona el atajo…'; boton.disabled = true;
      const teclas = await api.capturarAtajo();
      boton.textContent = 'Cambiar'; boton.disabled = false;
      if (!teclas) return;
      if (teclas.length === 1 && !TECLAS_SOLAS.has(teclas[0])) {
        toast(teclas[0] === 86
          ? 'La tecla < > sola escribiría "<". Úsala con otra tecla o prueba Ctrl der. (Fn no la ve Windows)'
          : 'Esa tecla sola estorbaría al escribir. Úsala con otra tecla o elige Ctrl der, Insert o Bloq Despl.', true);
        return;
      }
      await guardar({ [clave]: teclas });
      kbd.textContent = nombreAtajo(teclas);
    } }, 'Cambiar');
    return el('div', { class: 'interruptor' }, el('div', {}, titulo), el('div', { class: 'fila' }, kbd, boton));
  }

  // Importar
  const resultadoImport = el('p', { class: 'sub' });
  const botonImport = el('button', { class: 'btn primario', disabled: !hayWispr, onclick: async () => {
    botonImport.disabled = true; botonImport.textContent = 'Importando…';
    try {
      const c = await api.importarWispr();
      resultadoImport.textContent = `Listo: ${c.palabras} palabras, ${c.snippets} snippets, ${c.comandos} comandos y ${numero(c.historial)} dictados nuevos.`;
      toast('Importado ✓');
    } catch (e) {
      resultadoImport.textContent = `No se pudo importar: ${e.message}`;
    }
    botonImport.textContent = 'Importar de nuevo'; botonImport.disabled = false;
  } }, 'Importar desde Wispr Flow');

  const selModelo = (clave, opciones) => {
    const s = el('select', { onchange: (e) => guardar({ [clave]: e.target.value }) }, opciones.map(([v, t]) => el('option', { value: v }, t)));
    s.value = ajustes[clave];
    return s;
  };

  contenido.append(
    cabecera('Ajustes'),
    tarjetaKey,
    el('div', { class: 'tarjeta' },
      el('h2', {}, 'Micrófono'),
      el('p', { class: 'sub', style: 'margin:0 0 12px' }, 'Habla Agéntica usa siempre este micrófono y nunca cambia a otro por su cuenta.'),
      micPerdido && el('p', { style: 'color:var(--error);margin:0 0 10px' }, 'El micrófono que elegiste no está conectado. Conéctalo o elige otro.'),
      selectorMic),
    el('div', { class: 'tarjeta' },
      el('h2', {}, 'Atajos'),
      filaAtajo('Dictar (mantener o doble toque)', 'atajoDictado'),
      filaAtajo('Modo comando (sobre texto seleccionado)', 'atajoComando'),
      el('div', { class: 'interruptor' }, el('div', {}, 'Cancelar grabación'), el('kbd', {}, 'Esc'))),
    el('div', { class: 'tarjeta' },
      el('h2', {}, 'Comportamiento'),
      interruptor('Silenciar el audio mientras dictas', 'Pausa la música o videos para que no se cuelen.', ajustes.silenciarAudio, (v) => guardar({ silenciarAudio: v })),
      interruptor('Micrófono siempre listo', 'El dictado empieza al instante. El micrófono queda abierto (Windows muestra su ícono), pero solo se graba mientras usas el atajo. Si usas audífonos Bluetooth, apágalo: con el micrófono abierto suenan peor.', ajustes.micListo !== false, (v) => guardar({ micListo: v })),
      interruptor('Aprender de mis correcciones', 'Si corriges una palabra después de que la app pega, la aprende y la agrega al diccionario. Para esto lee el texto del campo donde pegó durante un minuto; no guarda ni envía ese texto a ninguna parte, y no mira campos de contraseña.', ajustes.aprenderCorrecciones !== false, (v) => guardar({ aprenderCorrecciones: v })),
      interruptor('Sonidos al empezar y terminar', null, ajustes.sonidos, (v) => guardar({ sonidos: v })),
      interruptor('Abrir al iniciar Windows', 'Queda en la bandeja, junto a la hora.', ajustes.abrirAlIniciar, (v) => guardar({ abrirAlIniciar: v }))),
    el('div', { class: 'tarjeta' },
      el('h2', {}, 'Modelos'),
      el('label', { class: 'campo' }, el('span', {}, 'Transcripción'), selModelo('modeloVoz', [
        ['whisper-large-v3', 'Whisper Large v3 (más preciso, recomendado)'], ['whisper-large-v3-turbo', 'Whisper Turbo (más rápido, menos preciso)']])),
      el('label', { class: 'campo', style: 'margin:0' }, el('span', {}, 'Pulido'), selModelo('modeloPulido', [
        ['openai/gpt-oss-120b', 'GPT-OSS 120B (recomendado)'], ['openai/gpt-oss-20b', 'GPT-OSS 20B (más rápido)']]))),
    tarjetaActualizacion(),
    el('div', { class: 'tarjeta' },
      el('h2', {}, 'Importar desde Wispr Flow'),
      el('p', { class: 'sub', style: 'margin:0 0 12px' }, hayWispr
        ? 'Trae tu diccionario, snippets e historial. No modifica nada de Wispr y puedes repetirlo sin duplicar.'
        : 'No encontré Wispr Flow en este computador.'),
      botonImport, resultadoImport),
  );
}

// ---------- arranque ----------
refrescarLateral();
ir(new URLSearchParams(location.search).get('seccion') || 'inicio');
