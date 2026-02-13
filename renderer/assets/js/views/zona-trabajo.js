// zona-trabajo.js - Working zone with live weight display

let workingScales = [];
let zonaCurrentScaleId = null;

function initZonaTrabajo(config) {
  workingScales = (config.scales || []).filter(s => s.working !== false);
  renderWorkingGrid();
}

function renderWorkingGrid() {
  const grid = document.querySelector('#working-scales-grid');
  const empty = document.querySelector('#zona-empty');

  if (workingScales.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = '';

  workingScales.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'scale-card';
    card.dataset.scaleId = s.scaleId;
    card.innerHTML = `
      <div class="scale-card-name">${s.scaleId}</div>
      <div class="scale-card-weight unstable" id="zona-weight-${s.scaleId}">0.000</div>
      <div class="scale-card-unit">kg</div>
      <div style="margin-top:6px;">
        <span class="badge badge-warning" id="zona-badge-${s.scaleId}">Conectando...</span>
      </div>
    `;
    card.addEventListener('click', () => {
      showZonaDetail(s);
    });
    grid.appendChild(card);
  });
}

function showZonaDetail(scale) {
  zonaCurrentScaleId = scale.scaleId;
  document.querySelector('#zona-grid').style.display = 'none';
  document.querySelector('#zona-detail').style.display = 'block';

  document.querySelector('#zona-detail-name').textContent = scale.scaleId;
  document.querySelector('#zona-detail-weight').textContent = '0.000';
  document.querySelector('#zona-detail-weight').className = 'weight-value unstable';
  document.querySelector('#zona-detail-status').textContent = 'Conectando...';
  document.querySelector('#zona-detail-status').className = 'badge badge-warning';
  document.querySelector('#zona-detail-reads').textContent = '0 lecturas';
}

function showZonaGrid() {
  zonaCurrentScaleId = null;
  document.querySelector('#zona-grid').style.display = 'block';
  document.querySelector('#zona-detail').style.display = 'none';
}

// Back button
document.querySelector('#btn-zona-back').addEventListener('click', showZonaGrid);

// Called from app.js on scale-update events
function updateZonaTrabajoScale(state) {
  // Update grid card
  const weightEl = document.querySelector(`#zona-weight-${CSS.escape(state.scaleId)}`);
  const badgeEl = document.querySelector(`#zona-badge-${CSS.escape(state.scaleId)}`);

  if (weightEl) {
    weightEl.textContent = state.weight.toFixed(3);
    weightEl.className = `scale-card-weight ${state.stable ? 'stable' : 'unstable'}`;
  }

  if (badgeEl) {
    if (state.connected) {
      if (state.stable) {
        badgeEl.textContent = 'Estable';
        badgeEl.className = 'badge badge-success';
      } else {
        badgeEl.textContent = 'Leyendo...';
        badgeEl.className = 'badge badge-warning';
      }
    } else {
      badgeEl.textContent = state.lastError || 'Desconectada';
      badgeEl.className = 'badge badge-warning';
    }
  }

  // Update detail view if active
  if (zonaCurrentScaleId && state.scaleId === zonaCurrentScaleId) {
    const detailWeight = document.querySelector('#zona-detail-weight');
    const detailStatus = document.querySelector('#zona-detail-status');
    const detailReads = document.querySelector('#zona-detail-reads');

    detailWeight.textContent = state.weight.toFixed(3);
    detailWeight.className = `weight-value ${state.stable ? 'stable' : 'unstable'}`;

    if (state.connected) {
      if (state.stable) {
        detailStatus.textContent = 'Estable';
        detailStatus.className = 'badge badge-success';
      } else {
        detailStatus.textContent = 'Leyendo...';
        detailStatus.className = 'badge badge-warning';
      }
    } else {
      detailStatus.textContent = state.lastError || 'Desconectada';
      detailStatus.className = 'badge badge-warning';
    }

    detailReads.textContent = `${state.readCount} lecturas`;
  }
}
