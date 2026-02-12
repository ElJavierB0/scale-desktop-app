// State
let currentStep = 1;
const configuredScales = [];
let serverVerified = false;
let stationRegistered = false;

// DOM helpers
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function showAlert(id, type, msg) {
  const el = $(id);
  el.className = `alert alert-${type} show`;
  el.textContent = msg;
}

function hideAlert(id) {
  const el = $(id);
  el.className = 'alert';
  el.textContent = '';
}

function setLoading(btn, loading) {
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span> Espera...';
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.originalText || btn.textContent;
    btn.disabled = false;
  }
}

// Step navigation
function goToStep(step) {
  // Update dots
  for (let i = 1; i <= 4; i++) {
    const dot = $(`#dot-${i}`);
    dot.classList.remove('active', 'done');
    if (i < step) dot.classList.add('done');
    else if (i === step) dot.classList.add('active');
  }

  // Update lines
  for (let i = 1; i <= 3; i++) {
    const line = $(`#line-${i}`);
    line.classList.toggle('done', i < step);
  }

  // Show/hide panels
  for (let i = 1; i <= 4; i++) {
    $(`#step-${i}`).classList.toggle('active', i === step);
  }

  currentStep = step;

  // Populate summary when entering step 4
  if (step === 4) populateSummary();
}

// ==================== Step 1: Server Connection ====================
$('#btn-verify').addEventListener('click', async () => {
  const url = $('#serverUrl').value.trim();
  const token = $('#bearerToken').value.trim();

  if (!url) return showAlert('#alert-step1', 'danger', 'Ingresa la URL del servidor');
  if (!token) return showAlert('#alert-step1', 'danger', 'Ingresa el Bearer Token');

  hideAlert('#alert-step1');
  const btn = $('#btn-verify');
  setLoading(btn, true);

  const result = await window.electronAPI.verifyServer(url, token);

  setLoading(btn, false);

  if (result.success) {
    showAlert('#alert-step1', 'success', 'Conexion verificada correctamente');
    serverVerified = true;
    $('#btn-next-1').disabled = false;

    // Save to config now so step 2 can use it
    await window.electronAPI.saveConfig({ serverUrl: url, bearerToken: token });
  } else {
    showAlert('#alert-step1', 'danger', `Error: ${result.error}`);
    serverVerified = false;
    $('#btn-next-1').disabled = true;
  }
});

$('#btn-next-1').addEventListener('click', () => {
  if (!serverVerified) return;
  goToStep(2);
  // Auto-suggest hostname
  window.electronAPI.getHostname().then((name) => {
    if (!$('#stationName').value) {
      $('#stationName').value = name;
    }
  });
});

// ==================== Step 2: Register Station ====================
$('#btn-register').addEventListener('click', async () => {
  const name = $('#stationName').value.trim();
  if (!name) return showAlert('#alert-step2', 'danger', 'Ingresa un nombre de estacion');

  hideAlert('#alert-step2');
  const btn = $('#btn-register');
  setLoading(btn, true);

  const result = await window.electronAPI.registerStation(name);

  setLoading(btn, false);

  if (result.success) {
    const msg = result.data.message
      ? `Estacion recuperada: ${result.data.stationId}`
      : `Estacion registrada: ${result.data.stationId}`;
    showAlert('#alert-step2', 'success', msg);
    stationRegistered = true;
    $('#btn-next-2').disabled = false;
  } else {
    showAlert('#alert-step2', 'danger', `Error: ${result.error}`);
    stationRegistered = false;
    $('#btn-next-2').disabled = true;
  }
});

$('#btn-back-2').addEventListener('click', () => goToStep(1));
$('#btn-next-2').addEventListener('click', () => {
  if (!stationRegistered) return;
  goToStep(3);
});

// ==================== Step 3: Detect Scales ====================
$('#btn-auto-detect').addEventListener('click', async () => {
  hideAlert('#alert-step3');
  $('#auto-detect-results').style.display = 'none';
  $('#manual-config').style.display = 'none';

  const btn = $('#btn-auto-detect');
  setLoading(btn, true);

  showAlert('#alert-step3', 'info', 'Buscando basculas conectadas... Esto puede tomar unos segundos.');

  const detected = await window.electronAPI.autoDetectScales();

  setLoading(btn, false);
  hideAlert('#alert-step3');

  if (detected.length === 0) {
    showAlert('#alert-step3', 'warning',
      'No se detectaron basculas automaticamente. Usa "Configurar manualmente".');
    return;
  }

  $('#auto-detect-results').style.display = 'block';
  const list = $('#detected-list');
  list.innerHTML = '';

  detected.forEach((d, i) => {
    const div = document.createElement('div');
    div.className = 'port-item';
    div.innerHTML = `
      <div>
        <span class="port-path">${d.port}</span>
        <span class="port-info">${d.profile.brand} ${d.profile.model}</span>
        <span class="badge badge-success">${d.weight} kg</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <input type="text" placeholder="BASCULA_0${i + 1}" value="BASCULA_0${i + 1}"
          style="width:120px;padding:4px 8px;font-size:12px;border:1px solid var(--border);border-radius:4px;"
          class="detected-scale-id" data-index="${i}">
        <button class="btn btn-success btn-sm btn-add-detected" data-index="${i}">Agregar</button>
      </div>
    `;
    list.appendChild(div);

    // Store detection data for adding
    div._detectedData = d;
  });

  // Bind add buttons
  list.querySelectorAll('.btn-add-detected').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      const item = list.children[idx];
      const d = item._detectedData;
      const scaleId = item.querySelector('.detected-scale-id').value.trim();

      if (!scaleId) return alert('Ingresa un Scale ID');

      addScale({
        scaleId,
        port: d.port,
        profileId: d.profile.id,
        baudRate: d.profile.baudRate,
        dataBits: d.profile.dataBits,
        parity: d.profile.parity,
        stopBits: d.profile.stopBits,
        pollCommand: d.profile.pollCommand,
        delimiter: d.profile.delimiter,
        readIntervalMs: 200,
      });

      btn.disabled = true;
      btn.textContent = 'Agregada';
    });
  });
});

// Manual mode
$('#btn-manual-mode').addEventListener('click', async () => {
  $('#manual-config').style.display = 'block';
  $('#auto-detect-results').style.display = 'none';
  hideAlert('#alert-step3');

  // Load ports
  const ports = await window.electronAPI.scanPorts();
  const portSelect = $('#manual-port');
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
  const profileSelect = $('#manual-profile');
  profileSelect.innerHTML = '';
  profiles.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.description;
    profileSelect.appendChild(opt);
  });
});

// Toggle custom fields
$('#manual-profile').addEventListener('change', () => {
  const isCustom = $('#manual-profile').value === 'custom';
  $('#custom-fields').style.display = isCustom ? 'block' : 'none';
});

// Test reading
$('#btn-test-reading').addEventListener('click', async () => {
  const portPath = $('#manual-port').value;
  const profileId = $('#manual-profile').value;

  if (!portPath) return showAlert('#test-result', 'danger', 'Selecciona un puerto');

  const btn = $('#btn-test-reading');
  setLoading(btn, true);
  hideAlert('#test-result');

  let customConfig = null;
  if (profileId === 'custom') {
    const pollRaw = $('#custom-poll').value;
    customConfig = {
      baudRate: parseInt($('#custom-baud').value),
      dataBits: parseInt($('#custom-databits').value),
      parity: $('#custom-parity').value,
      stopBits: parseInt($('#custom-stopbits').value),
      pollCommand: pollRaw ? pollRaw.replace(/\\r/g, '\r').replace(/\\n/g, '\n') : null,
      delimiter: '\r',
      timeout: 3000,
    };
  }

  const result = await window.electronAPI.testScaleReading(portPath, profileId, customConfig);

  setLoading(btn, false);

  if (result.success) {
    showAlert('#test-result', 'success', `Lectura exitosa: ${result.weight} kg (raw: "${result.raw}")`);
  } else {
    showAlert('#test-result', 'danger', result.error);
  }
});

// Add scale (manual)
$('#btn-add-scale').addEventListener('click', async () => {
  const portPath = $('#manual-port').value;
  const profileId = $('#manual-profile').value;
  const scaleId = $('#manual-scale-id').value.trim();

  if (!portPath) return showAlert('#test-result', 'danger', 'Selecciona un puerto');
  if (!scaleId) return showAlert('#test-result', 'danger', 'Ingresa un Scale ID');

  const profiles = await window.electronAPI.getProfiles();
  const profile = profiles.find(p => p.id === profileId);

  let scaleConfig;
  if (profileId === 'custom') {
    const pollRaw = $('#custom-poll').value;
    scaleConfig = {
      scaleId,
      port: portPath,
      profileId: 'custom',
      baudRate: parseInt($('#custom-baud').value),
      dataBits: parseInt($('#custom-databits').value),
      parity: $('#custom-parity').value,
      stopBits: parseInt($('#custom-stopbits').value),
      pollCommand: pollRaw ? pollRaw.replace(/\\r/g, '\r').replace(/\\n/g, '\n') : null,
      delimiter: '\r',
      readIntervalMs: 200,
    };
  } else {
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

  addScale(scaleConfig);
  hideAlert('#test-result');
  $('#manual-scale-id').value = '';
});

function addScale(scaleConfig) {
  // Prevent duplicates by scaleId or port
  if (configuredScales.find(s => s.scaleId === scaleConfig.scaleId)) {
    return alert('Ya existe una bascula con ese Scale ID');
  }
  if (configuredScales.find(s => s.port === scaleConfig.port)) {
    return alert('Ya existe una bascula configurada en ese puerto');
  }

  configuredScales.push(scaleConfig);
  renderScalesList();
  $('#btn-next-3').disabled = false;
}

function removeScale(index) {
  configuredScales.splice(index, 1);
  renderScalesList();
  $('#btn-next-3').disabled = configuredScales.length === 0;
}

function renderScalesList() {
  const container = $('#scales-list');

  if (configuredScales.length === 0) {
    container.innerHTML = '<p style="font-size:13px;color:var(--text-muted);">Ninguna bascula configurada.</p>';
    return;
  }

  container.innerHTML = '';
  configuredScales.forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'scale-item';
    div.innerHTML = `
      <div class="scale-info">
        <strong>${s.scaleId}</strong>
        <span>${s.port} @ ${s.baudRate} baud (${s.profileId})</span>
      </div>
      <button class="btn btn-danger btn-sm" onclick="removeScale(${i})">Quitar</button>
    `;
    container.appendChild(div);
  });
}

// Make removeScale accessible from onclick
window.removeScale = removeScale;

$('#btn-back-3').addEventListener('click', () => goToStep(2));
$('#btn-next-3').addEventListener('click', () => {
  if (configuredScales.length === 0) return;
  goToStep(4);
});

// ==================== Step 4: Summary ====================
function populateSummary() {
  const url = $('#serverUrl').value.trim();
  const station = $('#stationName').value.trim();

  $('#sum-server').textContent = url;
  $('#sum-station').textContent = station;
  $('#sum-scales').textContent = `${configuredScales.length} bascula(s)`;

  const details = $('#sum-scale-details');
  details.innerHTML = '';

  configuredScales.forEach((s) => {
    const div = document.createElement('div');
    div.className = 'scale-item';
    div.innerHTML = `
      <div class="scale-info">
        <strong>${s.scaleId}</strong>
        <span>${s.port} @ ${s.baudRate} baud</span>
      </div>
    `;
    details.appendChild(div);
  });
}

$('#btn-back-4').addEventListener('click', () => goToStep(3));

$('#btn-start').addEventListener('click', async () => {
  const btn = $('#btn-start');
  setLoading(btn, true);
  hideAlert('#alert-step4');

  // Save full config
  const saveResult = await window.electronAPI.saveConfig({
    serverUrl: $('#serverUrl').value.trim(),
    bearerToken: $('#bearerToken').value.trim(),
    scales: configuredScales,
    autoLaunch: $('#autoLaunch').checked,
  });

  if (!saveResult.success) {
    setLoading(btn, false);
    showAlert('#alert-step4', 'danger', `Error guardando config: ${saveResult.error}`);
    return;
  }

  // Start service
  const startResult = await window.electronAPI.startService();

  setLoading(btn, false);

  if (startResult.success) {
    // Navigate to status page
    window.electronAPI.navigateToStatus();
  } else {
    showAlert('#alert-step4', 'danger', `Error iniciando servicio: ${startResult.error}`);
  }
});
