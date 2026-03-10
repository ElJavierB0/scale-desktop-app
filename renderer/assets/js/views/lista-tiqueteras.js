// lista-tiqueteras.js - USB thermal printer list with CRUD and active toggle

let allPrinters = [];
let editingPrinterId = null;
let pendingRemovePrinterId = null;

// USB device selected in each modal
let addSelectedVendorId    = null;
let addSelectedProductId   = null;
let addSelectedDisplayName = null;
let addSelectedPrinterName = null;
let editSelectedVendorId    = null;
let editSelectedProductId   = null;
let editSelectedDisplayName = null;
let editSelectedPrinterName = null;

const IS_WINDOWS = window.electronAPI.platform === 'win32';

function showPrinterAlert(selector, type, msg) {
  const el = document.querySelector(selector);
  el.className = `alert alert-${type} show`;
  el.textContent = msg;
}

function hidePrinterAlert(selector) {
  const el = document.querySelector(selector);
  if (el) {
    el.className = 'alert';
    el.textContent = '';
  }
}

function initListaTiqueteras(config) {
  allPrinters = config.printers || [];
  renderPrintersList();
}

function renderPrintersList() {
  const container = document.querySelector('#printers-list');

  if (allPrinters.length === 0) {
    container.innerHTML =
      '<p style="font-size:13px;color:var(--text-muted);">No hay tiqueteras configuradas. Usa el boton de abajo para agregar una.</p>';
    return;
  }

  container.innerHTML = '';
  allPrinters.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'scale-item';

    const active = p.active !== false;
    const vidHex = p.vendorId  != null ? `0x${p.vendorId.toString(16).padStart(4, '0')}`  : '—';
    const pidHex = p.productId != null ? `0x${p.productId.toString(16).padStart(4, '0')}` : '—';
    const deviceLabel = p.displayName || `VID:${vidHex} PID:${pidHex}`;

    div.innerHTML = `
      <div class="scale-info">
        <strong>${p.printerId}</strong>
        <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:2px;">${deviceLabel}</span>
        <div style="margin-top:4px;">
          <span class="badge badge-info">Bascula: ${p.scaleId || '—'}</span>
          <span class="badge badge-info" style="margin-left:4px;">${p.labelWidthMm || 50}×${p.labelHeightMm || 25}mm</span>
          <span class="badge badge-info" style="margin-left:4px;text-transform:uppercase;">${p.protocol || 'tspl'}</span>
          ${active ? '' : '<span class="badge badge-warning" style="margin-left:4px;">Inactiva</span>'}
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <label class="toggle-switch" title="Activar/Desactivar">
          <input type="checkbox" class="toggle-printer-active" data-printer-id="${p.printerId}" ${active ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <button class="btn btn-outline btn-sm btn-edit-printer" data-printer-id="${p.printerId}">Editar</button>
        <button class="btn btn-danger btn-sm btn-remove-printer" data-printer-id="${p.printerId}">Quitar</button>
      </div>
    `;
    container.appendChild(div);
  });

  // Bind active toggles
  container.querySelectorAll('.toggle-printer-active').forEach((toggle) => {
    toggle.addEventListener('change', async () => {
      const printerId = toggle.dataset.printerId;
      const active = toggle.checked;
      const result = await window.electronAPI.editPrinter(printerId, { active });
      if (result.success) {
        const config = await window.electronAPI.getConfig();
        allPrinters = config.printers || [];
        renderPrintersList();
      }
    });
  });

  // Bind edit buttons
  container.querySelectorAll('.btn-edit-printer').forEach((btn) => {
    btn.addEventListener('click', () => openEditPrinterModal(btn.dataset.printerId));
  });

  // Bind remove buttons
  container.querySelectorAll('.btn-remove-printer').forEach((btn) => {
    btn.addEventListener('click', () => {
      pendingRemovePrinterId = btn.dataset.printerId;
      document.querySelector('#remove-printer-msg').textContent =
        `Quitar la tiquetera "${btn.dataset.printerId}"?`;
      document.querySelector('#modal-remove-printer').style.display = 'flex';
    });
  });
}

// ========== USB SCAN HELPER ==========

async function scanAndShowUsbPrinters(listId, statusId, onSelect, currentVendorId, currentProductId) {
  const statusEl = document.querySelector(statusId);
  const listEl   = document.querySelector(listId);
  statusEl.textContent = 'Buscando...';
  listEl.innerHTML = '';

  const devices = await window.electronAPI.scanUsbPrinters();

  if (devices.length === 0) {
    statusEl.textContent = 'No se encontraron impresoras USB conectadas';
    return;
  }

  statusEl.textContent = `${devices.length} impresora(s) USB encontrada(s) — selecciona una`;

  devices.forEach((d) => {
    const isSelected = IS_WINDOWS
      ? d.printerName === currentVendorId   // currentVendorId reutilizado como printerName en Windows
      : d.vendorId === currentVendorId && d.productId === currentProductId;
    const item = document.createElement('div');
    item.style.cssText = `cursor:pointer;padding:8px 10px;margin-bottom:4px;border-radius:6px;border:1px solid ${isSelected ? 'var(--primary)' : 'var(--border)'};font-size:12px;`;
    item.textContent = d.displayName;

    item.addEventListener('click', () => {
      listEl.querySelectorAll('div').forEach((el) => (el.style.borderColor = 'var(--border)'));
      item.style.borderColor = 'var(--primary)';
      onSelect(d.vendorId ?? null, d.productId ?? null, d.displayName, d.printerName ?? null);
    });

    listEl.appendChild(item);
    if (isSelected) onSelect(d.vendorId ?? null, d.productId ?? null, d.displayName, d.printerName ?? null);
  });
}

// ========== MODAL: Agregar tiquetera ==========

document.querySelector('#btn-add-printer-mode').addEventListener('click', () => {
  hidePrinterAlert('#add-printer-alert');
  document.querySelector('#add-printer-id').value = '';
  document.querySelector('#add-scan-status').textContent = 'Presiona "Buscar" para detectar impresoras USB';
  document.querySelector('#add-usb-list').innerHTML = '';
  addSelectedVendorId    = null;
  addSelectedProductId   = null;
  addSelectedDisplayName = null;
  addSelectedPrinterName = null;
  loadScalesIntoSelect('#add-printer-scale');
  document.querySelector('#modal-add-printer').style.display = 'flex';
});

document.querySelector('#btn-scan-usb-add').addEventListener('click', () => {
  scanAndShowUsbPrinters(
    '#add-usb-list', '#add-scan-status',
    (vid, pid, name, printerName) => { addSelectedVendorId = vid; addSelectedProductId = pid; addSelectedDisplayName = name; addSelectedPrinterName = printerName; },
    addSelectedVendorId, addSelectedProductId
  );
});

document.querySelector('#modal-add-printer-close').addEventListener('click', () => {
  document.querySelector('#modal-add-printer').style.display = 'none';
});

document.querySelector('#modal-add-printer').addEventListener('click', (e) => {
  if (e.target === document.querySelector('#modal-add-printer'))
    document.querySelector('#modal-add-printer').style.display = 'none';
});

document.querySelector('#btn-confirm-add-printer').addEventListener('click', async () => {
  const printerId = document.querySelector('#add-printer-id').value.trim();
  const scaleId   = document.querySelector('#add-printer-scale').value;

  if (!printerId) return showPrinterAlert('#add-printer-alert', 'danger', 'Ingresa un ID para la tiquetera');
  if (IS_WINDOWS && !addSelectedPrinterName) return showPrinterAlert('#add-printer-alert', 'danger', 'Selecciona una impresora de la lista');
  if (!IS_WINDOWS && addSelectedVendorId == null) return showPrinterAlert('#add-printer-alert', 'danger', 'Selecciona una impresora USB');

  const btn = document.querySelector('#btn-confirm-add-printer');
  btn.disabled = true;
  btn.textContent = 'Agregando...';

  const labelWidthMm  = parseInt(document.querySelector('#add-label-width').value)  || 50;
  const labelHeightMm = parseInt(document.querySelector('#add-label-height').value) || 25;

  const protocol = document.querySelector('#add-printer-protocol').value;

  const result = await window.electronAPI.addPrinter({
    printerId,
    vendorId:     addSelectedVendorId,
    productId:    addSelectedProductId,
    printerName:  addSelectedPrinterName || null,
    displayName:  addSelectedDisplayName || '',
    protocol,
    scaleId:      scaleId || null,
    labelWidthMm,
    labelHeightMm,
    active: true,
  });

  btn.disabled = false;
  btn.textContent = 'Agregar tiquetera';

  if (result.success) {
    document.querySelector('#modal-add-printer').style.display = 'none';
    const config = await window.electronAPI.getConfig();
    allPrinters = config.printers || [];
    renderPrintersList();
  } else {
    showPrinterAlert('#add-printer-alert', 'danger', result.error);
  }
});

// ========== MODAL: Editar tiquetera ==========

async function openEditPrinterModal(printerId) {
  editingPrinterId = printerId;
  const printer = allPrinters.find((p) => p.printerId === printerId);
  if (!printer) return;

  hidePrinterAlert('#edit-printer-alert');
  document.querySelector('#edit-printer-id-label').value = printer.printerId;
  loadScalesIntoSelect('#edit-printer-scale', printer.scaleId);
  document.querySelector('#edit-label-width').value    = printer.labelWidthMm  || 50;
  document.querySelector('#edit-label-height').value   = printer.labelHeightMm || 25;
  document.querySelector('#edit-printer-protocol').value = printer.protocol || 'tspl';

  editSelectedVendorId    = printer.vendorId    ?? null;
  editSelectedProductId   = printer.productId   ?? null;
  editSelectedDisplayName = printer.displayName ?? null;
  editSelectedPrinterName = printer.printerName ?? null;
  document.querySelector('#edit-usb-list').innerHTML = '';

  const statusEl = document.querySelector('#edit-scan-status');
  if (editSelectedDisplayName) {
    statusEl.textContent = `Actual: ${editSelectedDisplayName} — Presiona "Buscar" para cambiar`;
  } else if (!IS_WINDOWS && editSelectedVendorId != null) {
    statusEl.textContent = `Actual: VID:0x${editSelectedVendorId.toString(16).padStart(4,'0')} PID:0x${editSelectedProductId.toString(16).padStart(4,'0')} — Presiona "Buscar" para cambiar`;
  } else {
    statusEl.textContent = 'Sin impresora asignada. Presiona "Buscar".';
  }

  document.querySelector('#modal-edit-printer').style.display = 'flex';
}

document.querySelector('#btn-scan-usb-edit').addEventListener('click', () => {
  scanAndShowUsbPrinters(
    '#edit-usb-list', '#edit-scan-status',
    (vid, pid, name, printerName) => { editSelectedVendorId = vid; editSelectedProductId = pid; editSelectedDisplayName = name; editSelectedPrinterName = printerName; },
    editSelectedVendorId, editSelectedProductId
  );
});

document.querySelector('#modal-edit-printer-close').addEventListener('click', () => {
  document.querySelector('#modal-edit-printer').style.display = 'none';
});

document.querySelector('#modal-edit-printer').addEventListener('click', (e) => {
  if (e.target === document.querySelector('#modal-edit-printer'))
    document.querySelector('#modal-edit-printer').style.display = 'none';
});

document.querySelector('#btn-edit-printer-save').addEventListener('click', async () => {
  if (!editingPrinterId) return;

  const scaleId = document.querySelector('#edit-printer-scale').value;

  if (IS_WINDOWS && !editSelectedPrinterName)
    return showPrinterAlert('#edit-printer-alert', 'danger', 'Selecciona una impresora de la lista');
  if (!IS_WINDOWS && editSelectedVendorId == null)
    return showPrinterAlert('#edit-printer-alert', 'danger', 'Selecciona una impresora USB');

  const btn = document.querySelector('#btn-edit-printer-save');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const labelWidthMm  = parseInt(document.querySelector('#edit-label-width').value)  || 50;
  const labelHeightMm = parseInt(document.querySelector('#edit-label-height').value) || 25;

  const protocol = document.querySelector('#edit-printer-protocol').value;

  const result = await window.electronAPI.editPrinter(editingPrinterId, {
    vendorId:    editSelectedVendorId,
    productId:   editSelectedProductId,
    printerName: editSelectedPrinterName || null,
    displayName: editSelectedDisplayName || '',
    protocol,
    scaleId:     scaleId || null,
    labelWidthMm,
    labelHeightMm,
  });

  btn.disabled = false;
  btn.textContent = 'Guardar cambios';

  if (result.success) {
    const config = await window.electronAPI.getConfig();
    allPrinters = config.printers || [];
    renderPrintersList();
    document.querySelector('#modal-edit-printer').style.display = 'none';
  } else {
    showPrinterAlert('#edit-printer-alert', 'danger', result.error);
  }
});

// ========== MODAL: Confirmar quitar tiquetera ==========

document.querySelector('#modal-remove-printer-close').addEventListener('click', () => {
  document.querySelector('#modal-remove-printer').style.display = 'none';
  pendingRemovePrinterId = null;
});

document.querySelector('#btn-remove-printer-cancel').addEventListener('click', () => {
  document.querySelector('#modal-remove-printer').style.display = 'none';
  pendingRemovePrinterId = null;
});

document.querySelector('#modal-remove-printer').addEventListener('click', (e) => {
  if (e.target === document.querySelector('#modal-remove-printer')) {
    document.querySelector('#modal-remove-printer').style.display = 'none';
    pendingRemovePrinterId = null;
  }
});

document.querySelector('#btn-remove-printer-confirm').addEventListener('click', async () => {
  if (!pendingRemovePrinterId) return;

  const btn = document.querySelector('#btn-remove-printer-confirm');
  btn.disabled = true;
  btn.textContent = 'Quitando...';

  const result = await window.electronAPI.removePrinter(pendingRemovePrinterId);

  btn.disabled = false;
  btn.textContent = 'Quitar';

  if (result.success) {
    document.querySelector('#modal-remove-printer').style.display = 'none';
    pendingRemovePrinterId = null;
    const config = await window.electronAPI.getConfig();
    allPrinters = config.printers || [];
    renderPrintersList();
  } else {
    document.querySelector('#remove-printer-msg').textContent = 'Error: ' + result.error;
  }
});

// ========== HELPERS ==========

function loadScalesIntoSelect(selector, selectedScaleId) {
  const select = document.querySelector(selector);
  select.innerHTML = '<option value="">— Sin asignar —</option>';
  const scales = (typeof allScales !== 'undefined' ? allScales : []);
  scales.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.scaleId;
    opt.textContent = s.scaleId;
    opt.selected = s.scaleId === selectedScaleId;
    select.appendChild(opt);
  });
}
