// Elige el prompt de pulido según el proceso de la ventana activa.
function elegirPrompt(proceso, prompts) {
  const p = (proceso || '').toLowerCase();
  const encontrado = p && prompts.porApp.find((x) => x.procesos.some((q) => q.toLowerCase() === p));
  return encontrado || prompts.porDefecto;
}

module.exports = { elegirPrompt };
