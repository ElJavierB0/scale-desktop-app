// estacion.js - Station registration and display view

function showEstacionAlert(type, msg) {
  const el = document.querySelector('#alert-estacion');
  el.className = `alert alert-${type} show`;
  el.textContent = msg;
}

function hideEstacionAlert() {
  const el = document.querySelector('#alert-estacion');
  el.className = 'alert';
  el.textContent = '';
}

function initEstacion(config) {
  const stationDone = !!(config.stationId && config.stationKey);

  if (stationDone) {
    // Display mode
    showEstacionDisplay(config);
  } else {
    // Register mode
    showEstacionRegister();
    // Auto-suggest hostname
    prefillHostname();
  }
}

function prefillHostname() {
  window.electronAPI.getHostname().then((name) => {
    const input = document.querySelector('#stationName');
    if (input && !input.value) input.value = name;
  });
}

function showEstacionRegister() {
  document.querySelector('#estacion-register').style.display = 'block';
  document.querySelector('#estacion-display').style.display = 'none';
  // Hide FAB reconfigure when in register mode
  const fab = document.querySelector('#fab-reconfigure');
  if (fab) fab.style.display = 'none';
}

function showEstacionDisplay(config) {
  document.querySelector('#estacion-register').style.display = 'none';
  document.querySelector('#estacion-display').style.display = 'block';
  // Show FAB reconfigure when in display mode
  const fab = document.querySelector('#fab-reconfigure');
  if (fab) fab.style.display = '';

  document.querySelector('#est-server').textContent = config.serverUrl || '-';
  document.querySelector('#est-station-id').textContent = config.stationId || '-';

  // Show full station key
  document.querySelector('#est-station-key').textContent = config.stationKey || '-';

  document.querySelector('#est-status').innerHTML =
    '<span class="badge badge-success">Conectada</span>';

  // Auto-launch toggle
  const toggle = document.querySelector('#toggle-autolaunch');
  if (toggle) {
    toggle.checked = config.autoLaunch === true;
  }
}

// Reconfigure button -> opens custom modal
document.querySelector('#btn-reconfigure').addEventListener('click', () => {
  document.querySelector('#modal-reconfig').style.display = 'flex';
});

document.querySelector('#modal-reconfig-close').addEventListener('click', () => {
  document.querySelector('#modal-reconfig').style.display = 'none';
});

document.querySelector('#btn-reconfig-cancel').addEventListener('click', () => {
  document.querySelector('#modal-reconfig').style.display = 'none';
});

document.querySelector('#modal-reconfig').addEventListener('click', (e) => {
  if (e.target === document.querySelector('#modal-reconfig')) {
    document.querySelector('#modal-reconfig').style.display = 'none';
  }
});

document.querySelector('#btn-reconfig-confirm').addEventListener('click', async () => {
  const btn = document.querySelector('#btn-reconfig-confirm');
  btn.disabled = true;
  btn.textContent = 'Reconfigurando...';

  const alertEl = document.querySelector('#alert-reconfig');
  alertEl.className = 'alert';
  alertEl.textContent = '';

  const result = await window.electronAPI.reconfigure();

  btn.disabled = false;
  btn.textContent = 'Reconfigurar';

  if (result.success) {
    document.querySelector('#modal-reconfig').style.display = 'none';
    // Show register form with hostname pre-filled
    showEstacionRegister();
    document.querySelector('#stationName').value = '';
    prefillHostname();
    // Notify app.js to re-lock everything
    if (typeof onReconfigured === 'function') {
      onReconfigured();
    }
  } else {
    alertEl.className = 'alert alert-danger show';
    alertEl.textContent = 'Error: ' + result.error;
  }
});

// Auto-launch toggle
document.querySelector('#toggle-autolaunch').addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  const result = await window.electronAPI.setAutoLaunch(enabled);
  if (!result.success) {
    // Revert toggle on failure
    e.target.checked = !enabled;
    showEstacionAlert('danger', 'Error: ' + result.error);
  }
});

// Register button
document.querySelector('#btn-register-station').addEventListener('click', async () => {
  const name = document.querySelector('#stationName').value.trim();
  if (!name) return showEstacionAlert('danger', 'Ingresa un nombre de estacion');

  hideEstacionAlert();
  const btn = document.querySelector('#btn-register-station');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Registrando...';

  try {
    const result = await window.electronAPI.registerStation(name);

    btn.disabled = false;
    btn.textContent = origText;

    if (result.success) {
      const msg = result.data.message
        ? `Estacion recuperada: ${result.data.stationId}`
        : `Estacion registrada: ${result.data.stationId}`;
      showEstacionAlert('success', msg);

      // Update display and navigate immediately
      const config = await window.electronAPI.getConfig();
      showEstacionDisplay(config);
      // Notify app.js to unlock next step
      if (typeof onStationRegistered === 'function') {
        onStationRegistered();
      }
    } else {
      showEstacionAlert('danger', `Error: ${result.error}`);
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = origText;
    showEstacionAlert('danger', `Error inesperado: ${err.message}`);
  }
});
