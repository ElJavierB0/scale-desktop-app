const $ = (sel) => document.querySelector(sel);

let serviceRunning = true;

// ========== INITIALIZATION ==========

async function init() {
  const config = await window.electronAPI.getConfig();
  $('#info-server').textContent = config.serverUrl || '-';
  $('#info-station').textContent = config.stationId || '-';

  // Create scale weight cards
  renderWeightCards(config.scales || []);

  // Render scales management list
  renderScalesList(config.scales || []);

  // Listen for real-time updates
  window.electronAPI.onScaleUpdate((state) => {
    updateScaleUI(state);
  });

  // Poll status every 2 seconds as backup
  setInterval(refreshStatus, 2000);
}

// ========== WEIGHT DISPLAY ==========

function renderWeightCards(scales) {
  const container = $('#scales-container');
  container.innerHTML = '';

  if (scales.length === 0) {
    container.innerHTML = '<div class="info-card"><p style="color:var(--text-muted)">No hay basculas configuradas.</p></div>';
    return;
  }

  scales.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'info-card';
    card.id = `scale-card-${s.scaleId}`;
    card.innerHTML = `
      <h3>${s.scaleId} <span style="font-weight:400;font-size:12px;color:var(--text-muted)">${s.port}</span></h3>
      <div class="weight-display">
        <div class="weight-value unstable" id="weight-${s.scaleId}">0.000</div>
        <div class="weight-unit">kg</div>
        <div style="margin-top:8px;">
          <span class="badge badge-warning" id="status-${s.scaleId}">Conectando...</span>
          <span style="font-size:11px;color:var(--text-muted);margin-left:8px;" id="reads-${s.scaleId}">0 lecturas</span>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function updateScaleUI(state) {
  const weightEl = $(`#weight-${state.scaleId}`);
  const statusEl = $(`#status-${state.scaleId}`);
  const readsEl = $(`#reads-${state.scaleId}`);

  if (!weightEl) return;

  weightEl.textContent = state.weight.toFixed(3);
  weightEl.className = `weight-value ${state.stable ? 'stable' : 'unstable'}`;

  if (state.connected) {
    if (state.stable) {
      statusEl.textContent = 'Estable';
      statusEl.className = 'badge badge-success';
    } else {
      statusEl.textContent = 'Leyendo...';
      statusEl.className = 'badge badge-warning';
    }
  } else {
    statusEl.textContent = state.lastError || 'Desconectada';
    statusEl.className = 'badge badge-warning';
  }

  readsEl.textContent = `${state.readCount} lecturas`;
}

async function refreshStatus() {
  const status = await window.electronAPI.getServiceStatus();

  const badge = $('#service-badge');
  const badgeText = $('#badge-text');

  if (status.running) {
    badge.className = 'status-badge running';
    badgeText.textContent = 'Activo';
    serviceRunning = true;
  } else {
    badge.className = 'status-badge stopped';
    badgeText.textContent = 'Detenido';
    serviceRunning = false;
  }

  if (status.scales) {
    status.scales.forEach(updateScaleUI);
  }
}

// ========== SCALES MANAGEMENT LIST ==========

function renderScalesList(scales) {
  const container = $('#scales-list');

  if (scales.length === 0) {
    container.innerHTML = '<p style="font-size:13px;color:var(--text-muted);">No hay basculas configuradas.</p>';
    return;
  }

  container.innerHTML = '';
  scales.forEach((s) => {
    const div = document.createElement('div');
    div.className = 'scale-item';
    div.innerHTML = `
      <div class="scale-info">
        <strong>${s.scaleId}</strong>
        <span>${s.port} @ ${s.baudRate} baud (${s.profileId})</span>
      </div>
      <button class="btn btn-danger btn-sm btn-remove-scale" data-scale-id="${s.scaleId}">Quitar</button>
    `;
    container.appendChild(div);
  });

  // Bind remove buttons
  container.querySelectorAll('.btn-remove-scale').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const scaleId = btn.dataset.scaleId;
      if (!confirm(`¿Quitar la bascula "${scaleId}"?`)) return;

      btn.disabled = true;
      btn.textContent = 'Quitando...';

      const result = await window.electronAPI.removeScale(scaleId);
      if (result.success) {
        // Reload everything
        const config = await window.electronAPI.getConfig();
        renderWeightCards(config.scales || []);
        renderScalesList(config.scales || []);
      } else {
        alert('Error: ' + result.error);
        btn.disabled = false;
        btn.textContent = 'Quitar';
      }
    });
  });
}

// ========== ADD SCALE FORM ==========

$('#btn-show-add-form').addEventListener('click', async () => {
  const form = $('#add-scale-form');
  form.style.display = 'block';
  $('#btn-show-add-form').style.display = 'none';
  hideAlert('#add-test-result');

  // Load ports
  const ports = await window.electronAPI.scanPorts();
  const portSelect = $('#add-port');
  portSelect.innerHTML = '';
  if (ports.length === 0) {
    portSelect.innerHTML = '<option value="">No se encontraron puertos</option>';
  } else {
    ports.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.path;
      opt.textContent = `${p.path} ${p.manufacturer || ''}`.trim();
      portSelect.appendChild(opt);
    });
  }

  // Load profiles
  const profiles = await window.electronAPI.getProfiles();
  const profileSelect = $('#add-profile');
  profileSelect.innerHTML = '';
  profiles.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.description;
    profileSelect.appendChild(opt);
  });

  // Auto-suggest scale ID
  const config = await window.electronAPI.getConfig();
  const existingScales = config.scales || [];
  const nextNum = existingScales.length + 1;
  $('#add-scale-id').value = `BASCULA_0${nextNum}`;
});

// Toggle custom fields based on profile selection
$('#add-profile').addEventListener('change', () => {
  const isCustom = $('#add-profile').value === 'custom';
  $('#add-custom-fields').style.display = isCustom ? 'block' : 'none';
});

// Cancel add form
$('#btn-cancel-add').addEventListener('click', () => {
  $('#add-scale-form').style.display = 'none';
  $('#btn-show-add-form').style.display = '';
  hideAlert('#add-test-result');
});

// Test reading
$('#btn-test-add').addEventListener('click', async () => {
  const portPath = $('#add-port').value;
  const profileId = $('#add-profile').value;

  if (!portPath) return showAlert('#add-test-result', 'danger', 'Selecciona un puerto');

  const btn = $('#btn-test-add');
  btn.disabled = true;
  btn.textContent = 'Probando...';
  hideAlert('#add-test-result');

  let customConfig = null;
  if (profileId === 'custom') {
    const pollRaw = $('#add-poll').value;
    customConfig = {
      baudRate: parseInt($('#add-baud').value),
      dataBits: parseInt($('#add-databits').value),
      parity: $('#add-parity').value,
      stopBits: parseInt($('#add-stopbits').value),
      pollCommand: pollRaw ? pollRaw.replace(/\\r/g, '\r').replace(/\\n/g, '\n') : null,
      delimiter: '\r',
      timeout: 3000,
    };
  }

  const result = await window.electronAPI.testScaleReading(portPath, profileId, customConfig);

  btn.disabled = false;
  btn.textContent = 'Probar lectura';

  if (result.success) {
    showAlert('#add-test-result', 'success', `Lectura exitosa: ${result.weight} kg (raw: "${result.raw}")`);
  } else {
    showAlert('#add-test-result', 'danger', result.error);
  }
});

// Confirm add scale
$('#btn-confirm-add').addEventListener('click', async () => {
  const portPath = $('#add-port').value;
  const profileId = $('#add-profile').value;
  const scaleId = $('#add-scale-id').value.trim();

  if (!portPath) return showAlert('#add-test-result', 'danger', 'Selecciona un puerto');
  if (!scaleId) return showAlert('#add-test-result', 'danger', 'Ingresa un Scale ID');

  const btn = $('#btn-confirm-add');
  btn.disabled = true;
  btn.textContent = 'Agregando...';

  let scaleConfig;
  if (profileId === 'custom') {
    const pollRaw = $('#add-poll').value;
    scaleConfig = {
      scaleId,
      port: portPath,
      profileId: 'custom',
      baudRate: parseInt($('#add-baud').value),
      dataBits: parseInt($('#add-databits').value),
      parity: $('#add-parity').value,
      stopBits: parseInt($('#add-stopbits').value),
      pollCommand: pollRaw ? pollRaw.replace(/\\r/g, '\r').replace(/\\n/g, '\n') : null,
      delimiter: '\r',
      readIntervalMs: 200,
    };
  } else {
    const profiles = await window.electronAPI.getProfiles();
    const profile = profiles.find(p => p.id === profileId);
    scaleConfig = {
      scaleId,
      port: portPath,
      profileId: profile.id,
      baudRate: profile.baudRate,
      dataBits: profile.dataBits,
      parity: profile.parity,
      stopBits: profile.stopBits,
      pollCommand: profile.pollCommand,
      delimiter: profile.delimiter,
      readIntervalMs: 200,
    };
  }

  const result = await window.electronAPI.addScale(scaleConfig);

  btn.disabled = false;
  btn.textContent = 'Agregar bascula';

  if (result.success) {
    // Hide form, reload UI
    $('#add-scale-form').style.display = 'none';
    $('#btn-show-add-form').style.display = '';
    hideAlert('#add-test-result');

    const config = await window.electronAPI.getConfig();
    renderWeightCards(config.scales || []);
    renderScalesList(config.scales || []);
  } else {
    showAlert('#add-test-result', 'danger', result.error);
  }
});

// ========== SERVICE ACTIONS ==========

$('#btn-stop').addEventListener('click', async () => {
  await window.electronAPI.stopService();
  serviceRunning = false;
  $('#service-badge').className = 'status-badge stopped';
  $('#badge-text').textContent = 'Detenido';
  $('#btn-stop').style.display = 'none';
  $('#btn-restart').style.display = '';
});

$('#btn-restart').addEventListener('click', async () => {
  const result = await window.electronAPI.startService();
  if (result.success) {
    serviceRunning = true;
    $('#service-badge').className = 'status-badge running';
    $('#badge-text').textContent = 'Activo';
    $('#btn-stop').style.display = '';
    $('#btn-restart').style.display = 'none';
  }
});

$('#btn-reconfigure').addEventListener('click', async () => {
  await window.electronAPI.reconfigure();
  window.electronAPI.navigateToWizard();
});

// ========== UTILS ==========

function showAlert(selector, type, msg) {
  const el = $(selector);
  el.className = `alert alert-${type} show`;
  el.textContent = msg;
}

function hideAlert(selector) {
  const el = $(selector);
  if (el) {
    el.className = 'alert';
    el.textContent = '';
  }
}

// ========== INIT ==========
init();
