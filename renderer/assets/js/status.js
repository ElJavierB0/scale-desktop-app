const $ = (sel) => document.querySelector(sel);

let serviceRunning = true;

// Load initial config
async function init() {
  const config = await window.electronAPI.getConfig();
  $('#info-server').textContent = config.serverUrl || '-';
  $('#info-station').textContent = config.stationId || '-';

  // Create scale cards based on configured scales
  const container = $('#scales-container');
  container.innerHTML = '';

  const scales = config.scales || [];
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

  // Listen for real-time updates
  window.electronAPI.onScaleUpdate((state) => {
    updateScaleUI(state);
  });

  // Poll status every 2 seconds as backup
  setInterval(refreshStatus, 2000);
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

  // Update service badge
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

  // Update scale states from polling
  if (status.scales) {
    status.scales.forEach(updateScaleUI);
  }
}

// Actions
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

// Init
init();
