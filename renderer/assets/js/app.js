const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let currentView = 'estacion';
let appConfig = null;

// ========== PROGRESSIVE UNLOCK ==========

function isStationRegistered(config) {
  return !!(config.stationId && config.stationKey);
}

function hasScales(config) {
  return (config.scales || []).length > 0;
}

function updateLocks(config) {
  const stationDone = isStationRegistered(config);
  const scalesDone = hasScales(config);

  const menuLista = $('#menu-lista-basculas');
  const menuZona = $('#menu-zona-trabajo');
  const lockLista = $('#lock-lista');
  const lockZona = $('#lock-zona');

  if (stationDone) {
    menuLista.classList.remove('locked');
    lockLista.style.display = 'none';
  } else {
    menuLista.classList.add('locked');
    lockLista.style.display = '';
  }

  if (stationDone && scalesDone) {
    menuZona.classList.remove('locked');
    lockZona.style.display = 'none';
  } else {
    menuZona.classList.add('locked');
    lockZona.style.display = '';
  }
}

// ========== VIEW SWITCHING ==========

function switchView(viewName) {
  // Don't switch to locked views
  const menuItem = $(`#menu-${viewName}`);
  if (menuItem && menuItem.classList.contains('locked')) return;

  // Hide all views
  $$('.view').forEach(v => v.style.display = 'none');

  // Show target view
  const target = $(`#view-${viewName}`);
  if (target) target.style.display = 'block';

  // Update menu active state
  $$('.sidebar-item').forEach(item => item.classList.remove('active'));
  if (menuItem) menuItem.classList.add('active');

  // Update top bar title
  const titles = {
    'estacion': 'Estacion',
    'lista-basculas': 'Lista de Basculas',
    'zona-trabajo': 'Zona de Trabajo',
  };
  $('#top-bar-title').textContent = titles[viewName] || viewName;

  currentView = viewName;
  closeSidebar();

  // Refresh zona de trabajo data when switching to it
  if (viewName === 'zona-trabajo' && appConfig) {
    initZonaTrabajo(appConfig);
  }
}

// ========== SIDEBAR ==========

function openSidebar() {
  $('#sidebar').classList.add('open');
  $('#sidebar-overlay').classList.add('open');
}

function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#sidebar-overlay').classList.remove('open');
}

$('#hamburger-btn').addEventListener('click', openSidebar);
$('#sidebar-close').addEventListener('click', closeSidebar);
$('#sidebar-overlay').addEventListener('click', closeSidebar);

// Menu item clicks
$$('.sidebar-item').forEach(item => {
  item.addEventListener('click', () => {
    const view = item.dataset.view;
    if (view) switchView(view);
  });
});

// ========== LOGOUT ==========

$('#btn-logout').addEventListener('click', async () => {
  closeSidebar();
  try {
    await window.electronAPI.disconnect();
  } catch (_) {
    // Ignore disconnect errors
  }
  window.electronAPI.navigateToLogin();
});

// ========== CALLBACKS FROM VIEWS ==========

function onStationRegistered() {
  // Refresh config and unlock
  window.electronAPI.getConfig().then(config => {
    appConfig = config;
    updateLocks(config);
    // Auto-redirect to lista de basculas
    switchView('lista-basculas');
  });
}

function onReconfigured() {
  // Re-lock everything and go back to estacion
  window.electronAPI.getConfig().then(config => {
    appConfig = config;
    updateLocks(config);
    initListaBasculas(config);
    initZonaTrabajo(config);
    switchView('estacion');
    refreshServiceBadge();
  });
}

function onScalesChanged(count) {
  // Refresh config, unlock, and re-init zona de trabajo
  // NOTA: No llamar startService() aquí porque editScale/addScale/removeScale
  // en ipc-handlers.js ya reinician el ScaleManager. Doble reinicio causa
  // race condition con el puerto serial.
  window.electronAPI.getConfig().then(config => {
    appConfig = config;
    updateLocks(config);
    initZonaTrabajo(config);
    refreshServiceBadge();
  });
}

// ========== SERVICE STATUS ==========

async function refreshServiceBadge() {
  try {
    const config = await window.electronAPI.getConfig();
    const stationDone = isStationRegistered(config);
    const status = await window.electronAPI.getServiceStatus();
    const badge = $('#service-badge');
    const text = $('#badge-text');

    if (!stationDone) {
      badge.className = 'status-badge stopped';
      text.textContent = 'Inactivo';
    } else if (status.running) {
      badge.className = 'status-badge running';
      text.textContent = 'Activo';
    } else {
      badge.className = 'status-badge stopped';
      text.textContent = 'Inactivo';
    }
  } catch (_) {
    // Ignore
  }
}

// ========== INITIALIZATION ==========

async function initApp() {
  appConfig = await window.electronAPI.getConfig();
  updateLocks(appConfig);

  const stationDone = isStationRegistered(appConfig);
  const scalesDone = hasScales(appConfig);

  // Initialize views
  initEstacion(appConfig);
  if (stationDone) initListaBasculas(appConfig);
  if (stationDone && scalesDone) initZonaTrabajo(appConfig);

  // Determine starting view
  if (!stationDone) {
    switchView('estacion');
  } else if (!scalesDone) {
    switchView('lista-basculas');
  } else {
    // Everything configured - go to lista-basculas as home
    switchView('lista-basculas');
  }

  // Reactivate station and start service if configured
  if (stationDone && scalesDone) {
    // Re-register to reactivate station (and its scales) after disconnect/logout
    const regResult = await window.electronAPI.registerStation(appConfig.stationId);
    if (!regResult.success) {
      console.warn('Error re-registrando estacion:', regResult.error);
      // Mostrar aviso pero no bloquear - el servicio intentará conectar después
    }

    // Sincronizar zonas de trabajo con el servidor (activar/desactivar según working local)
    const syncResult = await window.electronAPI.syncZones();
    if (!syncResult.success) {
      console.warn('Error sincronizando zonas:', syncResult.error);
    }

    // Reload config and re-render views
    appConfig = await window.electronAPI.getConfig();
    initListaBasculas(appConfig);
    initZonaTrabajo(appConfig);
    updateLocks(appConfig);

    await window.electronAPI.startService();
  }

  refreshServiceBadge();
  setInterval(refreshServiceBadge, 3000);

  // Listen for scale updates
  window.electronAPI.onScaleUpdate((state) => {
    if (typeof updateZonaTrabajoScale === 'function') {
      updateZonaTrabajoScale(state);
    }
    if (typeof updateListaBadge === 'function') {
      updateListaBadge(state);
    }
  });
}

initApp();
