// Actualizaciones automáticas: revisa las versiones (releases) del repositorio
// en GitHub, descarga la nueva en segundo plano y avisa para reiniciar.
// `autoUpdater` llega de afuera (electron-updater) para poder probarlo.

const PRIMERA_REVISION_MS = 15 * 1000;
const INTERVALO_MS = 6 * 60 * 60 * 1000;

function crearActualizador({ autoUpdater, versionActual, alCambiar = () => {}, alDescargar = () => {}, programar = setTimeout, repetir = setInterval }) {
  let estado = { estado: 'inactivo', versionActual, version: null, progreso: 0, error: null };

  const cambiar = (parcial) => {
    estado = { ...estado, ...parcial };
    alCambiar(estado);
  };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // si no reinicia ahora, se instala al cerrar
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => cambiar({ estado: 'buscando', error: null }));
  autoUpdater.on('update-available', (info) => cambiar({ estado: 'descargando', version: info.version, progreso: 0 }));
  autoUpdater.on('update-not-available', () => cambiar({ estado: 'al-dia', version: null }));
  autoUpdater.on('download-progress', (p) => cambiar({ progreso: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => {
    cambiar({ estado: 'lista', version: info.version, progreso: 100 });
    alDescargar(info.version);
  });
  autoUpdater.on('error', (e) => cambiar({ estado: 'error', error: String((e && e.message) || e || 'error desconocido').slice(0, 200) }));

  async function buscar() {
    // Mientras baja o espera reinicio no se vuelve a buscar.
    if (estado.estado === 'descargando' || estado.estado === 'lista') return estado;
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      // El evento 'error' ya dejó el motivo en el estado.
    }
    return estado;
  }

  function iniciar() {
    programar(buscar, PRIMERA_REVISION_MS);
    const t = repetir(buscar, INTERVALO_MS);
    if (t && t.unref) t.unref();
  }

  function instalar() {
    if (estado.estado !== 'lista') return false;
    autoUpdater.quitAndInstall(false, true); // no silencioso, y vuelve a abrir la app
    return true;
  }

  return { iniciar, buscar, instalar, estado: () => estado };
}

module.exports = { crearActualizador };
