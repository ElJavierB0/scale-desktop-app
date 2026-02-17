// lista-basculas.js - Scale list with CRUD, modals, working toggle

let allScales = [];
let editingScaleId = null;
let pendingRemoveScaleId = null;

function showListAlert(selector, type, msg) {
  const el = document.querySelector(selector);
  el.className = `alert alert-${type} show`;
  el.textContent = msg;
}

function hideListAlert(selector) {
  const el = document.querySelector(selector);
  if (el) {
    el.className = 'alert';
    el.textContent = '';
  }
}

function initListaBasculas(config) {
  allScales = config.scales || [];
  renderScalesList();
}

function renderScalesList() {
  const container = document.querySelector('#scales-list');

  if (allScales.length === 0) {
    container.innerHTML =
      '<p style="font-size:13px;color:var(--text-muted);">No hay basculas configuradas. Usa los botones de arriba para agregar una.</p>';
    return;
  }

  container.innerHTML = '';
  allScales.forEach((s) => {
    const div = document.createElement('div');
    div.className = 'scale-item';

    const working = s.working !== false;
    div.innerHTML = `
      <div class="scale-info">
        <strong>${s.scaleId}</strong>
        <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:2px;">${s.port} @ ${s.baudRate} baud</span>
        <div style="margin-top:4px;">
          <span class="badge badge-warning" id="list-status-${s.scaleId}">Conectando...</span>
          ${working ? '<span class="badge badge-info" style="margin-left:4px;">Zona de Trabajo</span>' : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <label class="toggle-switch" title="Zona de Trabajo">
          <input type="checkbox" class="toggle-working" data-scale-id="${s.scaleId}" ${working ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <button class="btn btn-outline btn-sm btn-edit-scale" data-scale-id="${s.scaleId}">Editar</button>
        <button class="btn btn-danger btn-sm btn-remove-scale" data-scale-id="${s.scaleId}">Quitar</button>
      </div>
    `;
    container.appendChild(div);
  });

  // Bind working toggles
  container.querySelectorAll('.toggle-working').forEach((toggle) => {
    toggle.addEventListener('change', async () => {
      const scaleId = toggle.dataset.scaleId;
      const working = toggle.checked;

      // Primero guardar localmente (fuente de verdad)
      const result = await window.electronAPI.editScale(scaleId, { working });
      if (result.success) {
        const config = await window.electronAPI.getConfig();
        allScales = config.scales || [];
        renderScalesList();
        if (typeof onScalesChanged === 'function') onScalesChanged(allScales.length);
      }

      // Luego sincronizar con el servidor (best-effort)
      const zoneResult = await window.electronAPI.setZone(scaleId, working);
      if (!zoneResult.success) {
        console.warn('Error sincronizando zona con servidor:', zoneResult.error);
      }
    });
  });

  // Bind edit buttons
  container.querySelectorAll('.btn-edit-scale').forEach((btn) => {
    btn.addEventListener('click', () => {
      const scaleId = btn.dataset.scaleId;
      openEditModal(scaleId);
    });
  });

  // Bind remove buttons (open custom modal)
  container.querySelectorAll('.btn-remove-scale').forEach((btn) => {
    btn.addEventListener('click', () => {
      const scaleId = btn.dataset.scaleId;
      pendingRemoveScaleId = scaleId;
      document.querySelector('#remove-scale-msg').textContent = `Quitar la bascula "${scaleId}"?`;
      document.querySelector('#modal-remove-scale').style.display = 'flex';
    });
  });
}

function updateListaBadge(state) {
  const badge = document.querySelector(`#list-status-${CSS.escape(state.scaleId)}`);
  if (!badge) return;

  if (state.connected) {
    if (state.stable) {
      badge.textContent = `${state.weight.toFixed(3)} kg - Estable`;
      badge.className = 'badge badge-success';
    } else {
      badge.textContent = `${state.weight.toFixed(3)} kg`;
      badge.className = 'badge badge-warning';
    }
  } else {
    badge.textContent = 'Desconectada';
    badge.className = 'badge badge-warning';
  }
}

// ========== MODAL: Auto-detect ==========

function openModal(id) {
  document.querySelector(`#${id}`).style.display = 'flex';
}

function closeModal(id) {
  document.querySelector(`#${id}`).style.display = 'none';
}

document.querySelector('#btn-auto-detect').addEventListener('click', () => {
  hideListAlert('#alert-detect');
  document.querySelector('#detected-list').innerHTML = '';
  const emptyMsg = document.querySelector('#detect-empty');
  if (emptyMsg) emptyMsg.style.display = '';
  openModal('modal-autodetect');
});

document.querySelector('#modal-autodetect-close').addEventListener('click', () => {
  closeModal('modal-autodetect');
});

document.querySelector('#modal-autodetect').addEventListener('click', (e) => {
  if (e.target === document.querySelector('#modal-autodetect')) closeModal('modal-autodetect');
});

document.querySelector('#btn-start-detect').addEventListener('click', async () => {
  const btn = document.querySelector('#btn-start-detect');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Buscando...';

  hideListAlert('#alert-detect');
  document.querySelector('#detected-list').innerHTML = '';
  const emptyMsg = document.querySelector('#detect-empty');
  if (emptyMsg) emptyMsg.style.display = 'none';
  showListAlert('#alert-detect', 'info', 'Buscando basculas conectadas... Esto puede tomar unos segundos.');

  const detected = await window.electronAPI.autoDetectScales();

  btn.disabled = false;
  btn.textContent = origText;
  hideListAlert('#alert-detect');

  if (detected.length === 0) {
    showListAlert('#alert-detect', 'warning', 'No se detectaron basculas. Usa "Configurar manualmente".');
    return;
  }

  const list = document.querySelector('#detected-list');
  list.innerHTML = '';
  const nextNum = allScales.length + 1;

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
        <input type="text" placeholder="BASCULA_0${nextNum + i}" value="BASCULA_0${nextNum + i}"
          style="width:120px;padding:4px 8px;font-size:12px;border:1px solid var(--border);border-radius:4px;"
          class="detected-scale-id" data-index="${i}">
        <button class="btn btn-success btn-sm btn-add-detected" data-index="${i}">Agregar</button>
      </div>
    `;
    list.appendChild(div);
    div._detectedData = d;
  });

  list.querySelectorAll('.btn-add-detected').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.index);
      const item = list.children[idx];
      const d = item._detectedData;
      const scaleId = item.querySelector('.detected-scale-id').value.trim();

      if (!scaleId) return alert('Ingresa un Scale ID');

      btn.disabled = true;
      btn.textContent = 'Agregando...';

      const result = await window.electronAPI.addScale({
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
        working: true,
      });

      if (result.success) {
        btn.textContent = 'Agregada';
        const config = await window.electronAPI.getConfig();
        allScales = config.scales || [];
        renderScalesList();
        if (typeof onScalesChanged === 'function') onScalesChanged(allScales.length);
      } else {
        alert('Error: ' + result.error);
        btn.disabled = false;
        btn.textContent = 'Agregar';
      }
    });
  });
});

// ========== MODAL: Manual config ==========

document.querySelector('#btn-manual-mode').addEventListener('click', async () => {
  hideListAlert('#test-result');
  openModal('modal-manual');

  // Load ports
  const ports = await window.electronAPI.scanPorts();
  const portSelect = document.querySelector('#manual-port');
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
  const profileSelect = document.querySelector('#manual-profile');
  profileSelect.innerHTML = '';
  profiles.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.description;
    profileSelect.appendChild(opt);
  });
});

document.querySelector('#modal-manual-close').addEventListener('click', () => {
  closeModal('modal-manual');
});

document.querySelector('#modal-manual').addEventListener('click', (e) => {
  if (e.target === document.querySelector('#modal-manual')) closeModal('modal-manual');
});

// Toggle custom fields
document.querySelector('#manual-profile').addEventListener('change', () => {
  const isCustom = document.querySelector('#manual-profile').value === 'custom';
  document.querySelector('#custom-fields').style.display = isCustom ? 'block' : 'none';
});

// Test reading
document.querySelector('#btn-test-reading').addEventListener('click', async () => {
  const portPath = document.querySelector('#manual-port').value;
  const profileId = document.querySelector('#manual-profile').value;

  if (!portPath) return showListAlert('#test-result', 'danger', 'Selecciona un puerto');

  const btn = document.querySelector('#btn-test-reading');
  btn.disabled = true;
  btn.textContent = 'Probando...';
  hideListAlert('#test-result');

  let customConfig = null;
  if (profileId === 'custom') {
    const pollRaw = document.querySelector('#custom-poll').value;
    customConfig = {
      baudRate: parseInt(document.querySelector('#custom-baud').value),
      dataBits: parseInt(document.querySelector('#custom-databits').value),
      parity: document.querySelector('#custom-parity').value,
      stopBits: parseInt(document.querySelector('#custom-stopbits').value),
      pollCommand: pollRaw ? pollRaw.replace(/\\r/g, '\r').replace(/\\n/g, '\n') : null,
      delimiter: '\r',
      timeout: 3000,
    };
  }

  const result = await window.electronAPI.testScaleReading(portPath, profileId, customConfig);

  btn.disabled = false;
  btn.textContent = 'Probar lectura';

  if (result.success) {
    showListAlert('#test-result', 'success', `Lectura exitosa: ${result.weight} kg (raw: "${result.raw}")`);
  } else {
    showListAlert('#test-result', 'danger', result.error);
  }
});

// Add scale (manual)
document.querySelector('#btn-add-scale').addEventListener('click', async () => {
  const portPath = document.querySelector('#manual-port').value;
  const profileId = document.querySelector('#manual-profile').value;
  const scaleId = document.querySelector('#manual-scale-id').value.trim();

  if (!portPath) return showListAlert('#test-result', 'danger', 'Selecciona un puerto');
  if (!scaleId) return showListAlert('#test-result', 'danger', 'Ingresa un Scale ID');

  const btn = document.querySelector('#btn-add-scale');
  btn.disabled = true;
  btn.textContent = 'Agregando...';

  let scaleConfig;
  if (profileId === 'custom') {
    const pollRaw = document.querySelector('#custom-poll').value;
    scaleConfig = {
      scaleId,
      port: portPath,
      profileId: 'custom',
      baudRate: parseInt(document.querySelector('#custom-baud').value),
      dataBits: parseInt(document.querySelector('#custom-databits').value),
      parity: document.querySelector('#custom-parity').value,
      stopBits: parseInt(document.querySelector('#custom-stopbits').value),
      pollCommand: pollRaw ? pollRaw.replace(/\\r/g, '\r').replace(/\\n/g, '\n') : null,
      delimiter: '\r',
      readIntervalMs: 200,
      working: true,
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
      working: true,
    };
  }

  const result = await window.electronAPI.addScale(scaleConfig);

  btn.disabled = false;
  btn.textContent = 'Agregar bascula';

  if (result.success) {
    hideListAlert('#test-result');
    document.querySelector('#manual-scale-id').value = '';
    const config = await window.electronAPI.getConfig();
    allScales = config.scales || [];
    renderScalesList();
    closeModal('modal-manual');
    if (typeof onScalesChanged === 'function') onScalesChanged(allScales.length);
  } else {
    showListAlert('#test-result', 'danger', result.error);
  }
});

// ========== MODAL: Edit scale ==========

async function openEditModal(scaleId) {
  editingScaleId = scaleId;
  const scale = allScales.find(s => s.scaleId === scaleId);
  if (!scale) return;

  document.querySelector('#edit-scale-id').value = scale.scaleId;
  hideListAlert('#edit-alert');

  // Load ports
  const ports = await window.electronAPI.scanPorts();
  const portSelect = document.querySelector('#edit-port');
  portSelect.innerHTML = '';
  ports.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.path;
    opt.textContent = `${p.path} ${p.manufacturer || ''}`.trim();
    opt.selected = p.path === scale.port;
    portSelect.appendChild(opt);
  });
  // Ensure current port is in the list
  if (!ports.find(p => p.path === scale.port)) {
    const opt = document.createElement('option');
    opt.value = scale.port;
    opt.textContent = `${scale.port} (actual)`;
    opt.selected = true;
    portSelect.prepend(opt);
  }

  // Load profiles
  const profiles = await window.electronAPI.getProfiles();
  const profileSelect = document.querySelector('#edit-profile');
  profileSelect.innerHTML = '';
  profiles.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.description;
    opt.selected = p.id === scale.profileId;
    profileSelect.appendChild(opt);
  });

  // Show custom fields if custom profile
  const isCustom = scale.profileId === 'custom';
  document.querySelector('#edit-custom-fields').style.display = isCustom ? 'block' : 'none';

  if (isCustom) {
    document.querySelector('#edit-custom-baud').value = scale.baudRate;
    document.querySelector('#edit-custom-databits').value = scale.dataBits;
    document.querySelector('#edit-custom-parity').value = scale.parity;
    document.querySelector('#edit-custom-stopbits').value = scale.stopBits;
    document.querySelector('#edit-custom-poll').value = scale.pollCommand || '';
  }

  openModal('modal-edit');
}

document.querySelector('#modal-edit-close').addEventListener('click', () => {
  closeModal('modal-edit');
});

document.querySelector('#modal-edit').addEventListener('click', (e) => {
  if (e.target === document.querySelector('#modal-edit')) closeModal('modal-edit');
});

document.querySelector('#edit-profile').addEventListener('change', () => {
  const isCustom = document.querySelector('#edit-profile').value === 'custom';
  document.querySelector('#edit-custom-fields').style.display = isCustom ? 'block' : 'none';
});

// Test reading from edit modal
document.querySelector('#btn-edit-test').addEventListener('click', async () => {
  const portPath = document.querySelector('#edit-port').value;
  const profileId = document.querySelector('#edit-profile').value;

  if (!portPath) return showListAlert('#edit-alert', 'danger', 'Selecciona un puerto');

  const btn = document.querySelector('#btn-edit-test');
  btn.disabled = true;
  btn.textContent = 'Probando...';
  hideListAlert('#edit-alert');

  let customConfig = null;
  if (profileId === 'custom') {
    const pollRaw = document.querySelector('#edit-custom-poll').value;
    customConfig = {
      baudRate: parseInt(document.querySelector('#edit-custom-baud').value),
      dataBits: parseInt(document.querySelector('#edit-custom-databits').value),
      parity: document.querySelector('#edit-custom-parity').value,
      stopBits: parseInt(document.querySelector('#edit-custom-stopbits').value),
      pollCommand: pollRaw ? pollRaw.replace(/\\r/g, '\r').replace(/\\n/g, '\n') : null,
      delimiter: '\r',
      timeout: 3000,
    };
  }

  const result = await window.electronAPI.testScaleReading(portPath, profileId, customConfig);

  btn.disabled = false;
  btn.textContent = 'Probar lectura';

  if (result.success) {
    showListAlert('#edit-alert', 'success', `Lectura exitosa: ${result.weight} kg`);
  } else {
    showListAlert('#edit-alert', 'danger', result.error);
  }
});

// Save edit
document.querySelector('#btn-edit-save').addEventListener('click', async () => {
  if (!editingScaleId) return;

  const portPath = document.querySelector('#edit-port').value;
  const profileId = document.querySelector('#edit-profile').value;

  if (!portPath) return showListAlert('#edit-alert', 'danger', 'Selecciona un puerto');

  const btn = document.querySelector('#btn-edit-save');
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  hideListAlert('#edit-alert');

  let newConfig;
  if (profileId === 'custom') {
    const pollRaw = document.querySelector('#edit-custom-poll').value;
    newConfig = {
      port: portPath,
      profileId: 'custom',
      baudRate: parseInt(document.querySelector('#edit-custom-baud').value),
      dataBits: parseInt(document.querySelector('#edit-custom-databits').value),
      parity: document.querySelector('#edit-custom-parity').value,
      stopBits: parseInt(document.querySelector('#edit-custom-stopbits').value),
      pollCommand: pollRaw ? pollRaw.replace(/\\r/g, '\r').replace(/\\n/g, '\n') : null,
      delimiter: '\r',
    };
  } else {
    const profiles = await window.electronAPI.getProfiles();
    const profile = profiles.find(p => p.id === profileId);
    newConfig = {
      port: portPath,
      profileId: profile.id,
      baudRate: profile.baudRate,
      dataBits: profile.dataBits,
      parity: profile.parity,
      stopBits: profile.stopBits,
      pollCommand: profile.pollCommand,
      delimiter: profile.delimiter,
    };
  }

  const result = await window.electronAPI.editScale(editingScaleId, newConfig);

  btn.disabled = false;
  btn.textContent = 'Guardar cambios';

  if (result.success) {
    const config = await window.electronAPI.getConfig();
    allScales = config.scales || [];
    renderScalesList();
    closeModal('modal-edit');
  } else {
    showListAlert('#edit-alert', 'danger', result.error);
  }
});

// ========== MODAL: Remove scale confirmation ==========

document.querySelector('#modal-remove-close').addEventListener('click', () => {
  closeModal('modal-remove-scale');
  pendingRemoveScaleId = null;
});

document.querySelector('#btn-remove-cancel').addEventListener('click', () => {
  closeModal('modal-remove-scale');
  pendingRemoveScaleId = null;
});

document.querySelector('#modal-remove-scale').addEventListener('click', (e) => {
  if (e.target === document.querySelector('#modal-remove-scale')) {
    closeModal('modal-remove-scale');
    pendingRemoveScaleId = null;
  }
});

document.querySelector('#btn-remove-confirm').addEventListener('click', async () => {
  if (!pendingRemoveScaleId) return;

  const btn = document.querySelector('#btn-remove-confirm');
  btn.disabled = true;
  btn.textContent = 'Quitando...';

  const result = await window.electronAPI.removeScale(pendingRemoveScaleId);

  btn.disabled = false;
  btn.textContent = 'Quitar';

  if (result.success) {
    closeModal('modal-remove-scale');
    pendingRemoveScaleId = null;
    const config = await window.electronAPI.getConfig();
    allScales = config.scales || [];
    renderScalesList();
    if (typeof onScalesChanged === 'function') onScalesChanged(allScales.length);
  } else {
    // Show error inline in the modal
    document.querySelector('#remove-scale-msg').textContent = 'Error: ' + result.error;
  }
});
