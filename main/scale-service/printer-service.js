const os   = require('os');
const path = require('path');
const { BrowserWindow } = require('electron');
const { log } = require('./logger');

// ── Render ticket.html → 1-bit bitmap via Electron offscreen ─────────────────
async function renderTicketBitmap(job, printer) {
  const wMm = printer.labelWidthMm  || 50;
  const hMm = printer.labelHeightMm || 25;

  // Printer: 203 DPI → ~8 dots/mm
  const wDots = Math.round(wMm * 8);
  const hDots = Math.round(hMm * 8);

  // Browser: 96 DPI → 1 mm = 3.7795 px
  const px96 = 96 / 25.4;
  const winW  = Math.round(wMm * px96);
  const winH  = Math.round(hMm * px96);

  const now     = new Date();
  const dateStr = now.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  const query = {
    orderId:     String(job.order_id).padStart(3, '0'),
    clientName:  job.client_name  || '',
    productName: job.product_name || '',
    weight:      parseFloat(job.weight).toFixed(3),
    date:        dateStr,
    time:        timeStr,
    w:           String(wMm),
    h:           String(hMm),
  };

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show:        false,
      width:       winW,
      height:      winH,
      frame:       false,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration:  false,
        contextIsolation: true,
      },
    });

    const ticketPath = path.join(__dirname, '..', '..', 'renderer', 'ticket.html');
    win.loadFile(ticketPath, { query });

    win.webContents.once('did-finish-load', async () => {
      try {
        // Breve pausa para que terminen de aplicarse estilos/fuentes
        await new Promise((r) => setTimeout(r, 200));

        const image = await win.webContents.capturePage();
        win.destroy();

        if (!image || image.isEmpty()) {
          return reject(new Error('capturePage() devolvio imagen vacia'));
        }

        // Escalar a resolución de la impresora (203 DPI)
        const scaled  = image.resize({ width: wDots, height: hDots });
        const bgraBuf = scaled.toBitmap(); // Buffer BGRA, 4 bytes/px
        const { width, height } = scaled.getSize();

        // Convertir a 1 bit por pixel (0 = negro, 1 = blanco, MSB first)
        const bytesPerRow = Math.ceil(width / 8);
        const data        = Buffer.alloc(bytesPerRow * height, 0xFF); // inicia todo blanco

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const pi  = (y * width + x) * 4;
            const lum = 0.299 * bgraBuf[pi + 2]   // R
                      + 0.587 * bgraBuf[pi + 1]   // G
                      + 0.114 * bgraBuf[pi];       // B
            if (lum < 128) {
              const bi = y * bytesPerRow + Math.floor(x / 8);
              data[bi] &= ~(1 << (7 - (x % 8)));  // poner bit en 0 = negro
            }
          }
        }

        resolve({ data, bytesPerRow, width, height, wMm, hMm });
      } catch (err) {
        win.destroy();
        reject(err);
      }
    });

    win.webContents.once('did-fail-load', (_e, _code, desc) => {
      win.destroy();
      reject(new Error(`Error cargando ticket.html: ${desc}`));
    });
  });
}

// ── USB Printer Adapter (node-usb v2.x) ──────────────────────────────────────
class UsbPrinterAdapter {
  constructor(vendorId, productId) {
    const { findByIds } = require('usb');
    const device = findByIds(vendorId, productId);
    if (!device) {
      throw new Error(`Impresora USB no encontrada (VID:${vendorId} PID:${productId})`);
    }
    this.device   = device;
    this.endpoint = null;
    this.iface    = null;
  }

  open(callback) {
    try { this.device.open(); }
    catch (err) { return callback(new Error(`Error abriendo USB: ${err.message}`)); }

    const interfaces = this.device.interfaces;
    let idx = 0;

    const tryIface = () => {
      if (idx >= interfaces.length) {
        try { this.device.close(); } catch (_) {}
        return callback(new Error('No se encontro endpoint OUT en la impresora'));
      }
      const iface = interfaces[idx++];
      iface.setAltSetting(iface.altSetting, () => {
        try {
          if (os.platform() !== 'win32') {
            try { if (iface.isKernelDriverActive()) iface.detachKernelDriver(); } catch (_) {}
          }
          iface.claim();
          const ep = iface.endpoints.find((e) => e.direction === 'out');
          if (ep) { this.iface = iface; this.endpoint = ep; return callback(null); }
        } catch (_) {}
        tryIface();
      });
    };
    tryIface();
  }

  write(data, callback) {
    this.endpoint.transfer(data, callback || (() => {}));
  }

  close(callback) {
    const finish = () => {
      try { this.device.close(); } catch (_) {}
      callback && callback(null);
    };
    if (this.iface) {
      try { return this.iface.release(true, finish); } catch (_) {}
    }
    finish();
  }
}

// ── PrinterService ────────────────────────────────────────────────────────────
class PrinterService {
  constructor(apiClient, config) {
    this.apiClient  = apiClient;
    this.config     = config;
    this.pollTimer  = null;
    this.processing = new Set();
    this.running    = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    log('info', 'Iniciando PrinterService (poll cada 2s)...');
    this.pollTimer = setInterval(() => this.poll(), 2000);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    log('info', 'PrinterService detenido');
  }

  updateConfig(newConfig) {
    this.config = newConfig;
  }

  async poll() {
    try {
      const jobs = await this.apiClient.fetchPrintJobs();
      if (!jobs || jobs.length === 0) return;

      for (const job of jobs) {
        if (this.processing.has(job.id)) continue;

        const printer = (this.config.printers || []).find(
          (p) => p.scaleId === job.scale_identifier && p.active !== false
        );

        if (!printer) {
          log('debug', `Sin tiquetera activa para bascula ${job.scale_identifier} (job #${job.id})`);
          continue;
        }

        this.processing.add(job.id);

        this.printTicket(job, printer)
          .then(() => this.apiClient.completePrintJob(job.id))
          .then(() => log('info', `Ticket impreso: pedido #${job.order_id} en ${printer.printerId}`))
          .catch((err) => log('error', `Error imprimiendo ticket #${job.id}: ${err.message}`))
          .finally(() => this.processing.delete(job.id));
      }
    } catch (err) {
      log('warn', `Error en poll de print jobs: ${err.message}`);
    }
  }

  async printTicket(job, printer) {
    const { vendorId, productId } = printer;
    if (vendorId == null || productId == null) {
      throw new Error('Tiquetera sin dispositivo USB configurado');
    }

    // 1. Renderizar ticket.html → bitmap 1-bit
    const { data, bytesPerRow, height, wMm, hMm } = await renderTicketBitmap(job, printer);

    // 2. Construir comando según protocolo
    const protocol = printer.protocol || 'tspl';
    let cmd;

    if (protocol === 'tspl') {
      // TSPL BITMAP: SIZE → GAP → CLS → BITMAP x,y,bytesPerRow,height,mode,<data> → PRINT
      const header = `SIZE ${wMm} mm,${hMm} mm\r\nGAP 3 mm,0\r\nCLS\r\nBITMAP 0,0,${bytesPerRow},${height},0,`;
      const footer = '\r\nPRINT 1,1\r\n';
      cmd = Buffer.concat([Buffer.from(header, 'ascii'), data, Buffer.from(footer, 'ascii')]);
    } else {
      // ESC/POS raster: GS v 0 (bit image mode)
      const ESC = '\x1b';
      const GS  = '\x1d';
      const wBytes = bytesPerRow;
      const hLines  = height;
      // GS v 0: m=0 (normal density), xL xH yL yH + data
      const header = Buffer.from([
        0x1B, 0x40,                         // ESC @ initialize
        0x1D, 0x76, 0x30, 0x00,             // GS v 0 mode=0
        wBytes & 0xFF, (wBytes >> 8) & 0xFF, // xL xH (width in bytes)
        hLines & 0xFF, (hLines >> 8) & 0xFF, // yL yH (height in lines)
      ]);
      const footer = Buffer.from([0x0A, 0x0A, 0x0A]); // 3 LF feeds
      // Invert bits for ESC/POS (1=black, 0=white, opposite of TSPL)
      const inverted = Buffer.from(data.map((b) => ~b & 0xFF));
      cmd = Buffer.concat([header, inverted, footer]);
    }

    // 3. Enviar al USB
    const adapter = new UsbPrinterAdapter(vendorId, productId);

    await new Promise((resolve, reject) => {
      adapter.open((err) => {
        if (err) return reject(new Error(`Error abriendo impresora: ${err.message}`));

        adapter.write(cmd, (writeErr) => {
          if (writeErr) {
            adapter.close(() => {});
            return reject(new Error(`Error escribiendo a impresora: ${writeErr.message}`));
          }
          setTimeout(() => adapter.close(() => resolve()), 400);
        });
      });
    });
  }
}

module.exports = { PrinterService };
