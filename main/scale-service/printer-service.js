const os   = require('os');
const fs   = require('fs');
const path = require('path');
const http  = require('http');
const https = require('https');
const { BrowserWindow } = require('electron');
const { log } = require('./logger');

// QR code library (instalada vía npm)
let QRCode;
try { QRCode = require('qrcode'); } catch (_) { QRCode = null; }

// ── Windows raw-print via PowerShell + Win32 WritePrinter API ─────────────────
const WIN_PS1_CONTENT = `\
Param(
  [Parameter(Mandatory=$true)][string]$printerName,
  [Parameter(Mandatory=$true)][string]$filePath
)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class RawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA")]
  public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.Drv")] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA")]
  public static extern Int32 StartDocPrinter(IntPtr h, Int32 l, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA d);
  [DllImport("winspool.Drv")] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv")] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv")] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv")]
  public static extern bool WritePrinter(IntPtr h, IntPtr b, Int32 c, out Int32 w);
  public static bool Send(string name, byte[] bytes) {
    IntPtr hp; Int32 dw = 0;
    if (!OpenPrinter(name, out hp, IntPtr.Zero)) return false;
    var d = new DOCINFOA { pDocName = "TSPL", pDataType = "RAW" };
    StartDocPrinter(hp, 1, d); StartPagePrinter(hp);
    IntPtr ptr = Marshal.AllocCoTaskMem(bytes.Length);
    Marshal.Copy(bytes, 0, ptr, bytes.Length);
    WritePrinter(hp, ptr, bytes.Length, out dw);
    Marshal.FreeCoTaskMem(ptr);
    EndPagePrinter(hp); EndDocPrinter(hp); ClosePrinter(hp);
    return dw == bytes.Length;
  }
}
'@ -Language CSharp
$bytes = [System.IO.File]::ReadAllBytes($filePath)
if (-not [RawPrint]::Send($printerName, $bytes)) { exit 1 }
`;

let _winPs1Path = null;
function getWinPs1Path() {
  if (_winPs1Path && fs.existsSync(_winPs1Path)) return _winPs1Path;
  _winPs1Path = path.join(os.tmpdir(), 'superpesca_rawprint.ps1');
  fs.writeFileSync(_winPs1Path, WIN_PS1_CONTENT, 'utf8');
  return _winPs1Path;
}

// ── Helpers: logo y QR como base64 ───────────────────────────────────────────

/**
 * Descarga una imagen desde una URL HTTP/HTTPS y la retorna como data URL base64.
 * Retorna null si falla (sin crash).
 */
async function fetchLogoBase64(url) {
  if (!url) return null;
  try {
    return await new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, { timeout: 5000 }, (res) => {
        if (res.statusCode !== 200) { res.resume(); return resolve(null); }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buf  = Buffer.concat(chunks);
          const ext  = (url.match(/\.(png|jpg|jpeg|gif|webp|svg)/i) || [])[1] || 'png';
          const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
          resolve(`data:${mime};base64,${buf.toString('base64')}`);
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  } catch (err) {
    log('warn', `fetchLogoBase64 falló para ${url}: ${err.message}`);
    return null;
  }
}

/**
 * Genera un QR PNG como data URL base64 usando la librería qrcode.
 * Retorna null si la librería no está disponible.
 */
async function generateQRBase64(text) {
  if (!QRCode || !text) return null;
  try {
    return await QRCode.toDataURL(text, {
      width:                240,
      margin:               1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch (err) {
    log('warn', `generateQRBase64 falló: ${err.message}`);
    return null;
  }
}

// ── Render ticket.html → 1-bit bitmap via Electron offscreen ─────────────────
async function renderTicketBitmap(job, printer, serverUrl) {
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

  // Para etiquetas grandes (≥90mm) obtener logo y QR como base64
  let logoBase64     = null;
  let qrImageBase64  = null;
  if (wMm >= 90) {
    const qrData = serverUrl ? `${serverUrl}/delivery-detail/${job.order_id}` : `Pedido #${job.order_id}`;
    [logoBase64, qrImageBase64] = await Promise.all([
      fetchLogoBase64(job.logo_url || null),
      generateQRBase64(qrData),
    ]);
  }

  const query = {
    orderId:         String(job.order_id),
    clientName:      job.client_name   || '',
    clientBusiness:  job.client_business || '',
    productName:     job.product_name  || '',
    weight:          parseFloat(job.weight).toFixed(2),
    date:            dateStr,
    time:            timeStr,
    deliveryAddress: job.delivery_address || '',
    businessName:    'Super Pescadería Del Río',
    w:               String(wMm),
    h:               String(hMm),
    ...(logoBase64    && { logoBase64 }),
    ...(qrImageBase64 && { qrImageBase64 }),
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
        // Pausa para que terminen de renderizarse imágenes/estilos
        await new Promise((r) => setTimeout(r, 350));

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

// ── TSPL: etiqueta pequeña/mediana (texto nativo + QR) ───────────────────────
function buildTicketTSPL(job, printer, serverUrl) {
  const wMm  = printer.labelWidthMm  || 50;
  const hMm  = printer.labelHeightMm || 25;
  const wDot = Math.round(wMm * 8);   // 203 DPI ≈ 8 dots/mm
  const hDot = Math.round(hMm * 8);

  const now     = new Date();
  const dateStr = now.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  // Escala de fuente proporcional al ancho: 1x para etiquetas ~50mm, 2x para ~100mm+
  const scale = Math.max(1, Math.floor(wMm / 50));

  // Métricas de fuentes TSPL × escala (dots/char)
  const FW = { '1': 8 * scale, '2': 12 * scale, '4': 24 * scale };
  const FH = { '1': 12 * scale, '2': 20 * scale, '4': 32 * scale };

  // QR: cellwidth adaptativo (4 para 50mm, 5 para 100mm+)
  const QR_CW = scale + 3;
  const QR_X  = Math.floor(wDot * 0.62);  // 62% del ancho desde la izquierda

  // Truncado dinámico: silencioso (sin indicador)
  const trunc = (text, font, maxDots) => {
    const max = Math.floor(maxDots / FW[font]);
    return text.length > max ? text.substring(0, max) : text;
  };
  const cx = (text, f) => Math.max(0, Math.floor((wDot - text.length * FW[f]) / 2));

  const orderId = String(job.order_id);          // sin padding de ceros
  const weight  = parseFloat(job.weight).toFixed(2);
  const unit    = (job.unit || 'KGM').toLowerCase();
  const qrData  = serverUrl ? `${serverUrl}/delivery-detail/${job.order_id}` : `Pedido #${orderId}`;

  // Fila 1: negocio del cliente (o nombre si no tiene negocio)
  const rawHeader = (job.client_business || job.client_name || '');
  const header    = trunc(rawHeader, '2', wDot - 10);

  // Fila 2: producto — ocupa toda la fila, sin restricción del QR
  const rawProduct = (job.product_name || '');
  const product    = trunc(rawProduct, '2', wDot - 10);

  const QR_X_AVAIL = wDot - QR_X - 5;           // dots disponibles desde QR_X hasta el borde
  const PED_STR = trunc(`Pedido #${orderId}`, '2', QR_X_AVAIL);
  const W_STR   = `${weight} ${unit}`;
  const DT_STR  = `${dateStr}  ${timeStr}`;

  // Coordenadas Y calculadas desde el contenido
  const Y_HDR  = 4;
  const Y_DIV1 = Y_HDR  + FH['2'] + 4;   // bajo fila 1 (negocio)
  const Y_PROD = Y_DIV1 + 3;
  const Y_DIV2 = Y_PROD + FH['2'] + 4;   // bajo fila 2 (producto)
  const Y_WGHT = Y_DIV2 + 3;             // peso + pedido en la misma fila
  const Y_QR   = Y_WGHT + FH['4'] + 3;   // QR justo debajo del peso/pedido
  const Y_DIV3 = hDot - FH['1'] - 8;     // barra inferior
  const Y_DATE = Y_DIV3 + 3;

  // QR cellwidth: el máximo que cabe en la zona disponible
  const qrZoneDots = Y_DIV3 - Y_QR;
  const qrModules  = 29;   // versión 3 (URLs ~35 chars, ECC M)
  const QR_CW_CALC = Math.max(2, Math.min(scale + 3, Math.floor(qrZoneDots / qrModules)));

  const lines = [
    `SIZE ${wMm} mm,${hMm} mm\r\n`,
    `GAP 3 mm,0\r\n`,
    `CODEPAGE 1252\r\n`,
    `CLS\r\n`,
    // Fila 1: negocio/nombre cliente, centrado
    `TEXT ${cx(header, '2')},${Y_HDR},"2",0,${scale},${scale},"${header}"\r\n`,
    `BAR 0,${Y_DIV1},${wDot},2\r\n`,
    // Fila 2: producto (izquierda, truncado al ancho disponible antes del QR)
    `TEXT 5,${Y_PROD},"2",0,${scale},${scale},"${product}"\r\n`,
    `BAR 0,${Y_DIV2},${wDot},2\r\n`,
    // Fila 3: peso (izq.) y pedido (der.) en la misma línea — QR abajo a la derecha
    `TEXT 5,${Y_WGHT},"4",0,${scale},${scale},"${W_STR}"\r\n`,
    `TEXT ${QR_X},${Y_WGHT},"2",0,${scale},${scale},"${PED_STR}"\r\n`,
    `QRCODE ${QR_X},${Y_QR},M,${QR_CW_CALC},A,0,"${qrData}"\r\n`,
    // Barra inferior + fecha/hora
    `BAR 0,${Y_DIV3},${wDot},2\r\n`,
    `TEXT 5,${Y_DATE},"1",0,${scale},${scale},"${DT_STR}"\r\n`,
    `PRINT 1,1\r\n`,
  ];

  // latin1 (ISO-8859-1): cada char de JS se mapea 1:1 a su byte
  // Para el rango español (á é í ó ú ñ ü Á É...) es idéntico a CP1252
  return Buffer.from(lines.join(''), 'latin1');
}

// ── TSPL: etiqueta grande (≥90mm) — bitmap completo desde HTML ───────────────
/**
 * Para etiquetas 102×152mm+: renderiza ticket.html como bitmap y lo
 * envía como comando TSPL BITMAP. Permite logo, fuentes TrueType y QR
 * renderizados en HTML, sin limitaciones del modo texto TSPL.
 */
async function buildLargeLabelTSPL(job, printer, serverUrl) {
  const { data, bytesPerRow, height, wMm, hMm } = await renderTicketBitmap(job, printer, serverUrl);

  // En el bitmap: 0=negro, 1=blanco. TSPL BITMAP: 1=negro (imprime punto).
  const inverted = Buffer.from(data.map((b) => ~b & 0xFF));

  // Construir el comando TSPL mezclando ASCII y binario
  const header = Buffer.from(
    `SIZE ${wMm} mm,${hMm} mm\r\n` +
    `GAP 3 mm,0\r\n` +
    `CLS\r\n` +
    `BITMAP 0,0,${bytesPerRow},${height},0,`,
    'ascii'
  );
  const footer = Buffer.from('\r\nPRINT 1,1\r\n', 'ascii');

  return Buffer.concat([header, inverted, footer]);
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
          // No hay impresora activa ahora → descartar el job para que no se acumule.
          log('debug', `Sin tiquetera activa para bascula ${job.scale_identifier}, descartando job #${job.id}`);
          this.apiClient.completePrintJob(job.id).catch(() => {});
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
    const protocol = printer.protocol || 'tspl';
    const wMm      = printer.labelWidthMm || 50;
    let cmd;

    if (protocol === 'tspl' && wMm >= 90) {
      // Etiqueta grande (ej. 102×152mm): renderizar HTML → bitmap → TSPL BITMAP
      cmd = await buildLargeLabelTSPL(job, printer, this.config.serverUrl || '');
    } else if (protocol === 'tspl') {
      // Etiqueta pequeña/mediana: TSPL texto nativo (rápido, sin dependencias de imagen)
      cmd = buildTicketTSPL(job, printer, this.config.serverUrl || '');
    } else {
      // ESC/POS: renderizar ticket.html a bitmap raster
      const { data, bytesPerRow, height } = await renderTicketBitmap(job, printer, this.config.serverUrl || '');
      const wBytes = bytesPerRow;
      const hLines = height;
      const header = Buffer.from([
        0x1B, 0x40,
        0x1D, 0x76, 0x30, 0x00,
        wBytes & 0xFF, (wBytes >> 8) & 0xFF,
        hLines & 0xFF, (hLines >> 8) & 0xFF,
      ]);
      const footer   = Buffer.from([0x0A, 0x0A, 0x0A]);
      const inverted = Buffer.from(data.map((b) => ~b & 0xFF));
      cmd = Buffer.concat([header, inverted, footer]);
    }

    if (process.platform === 'win32') {
      if (!printer.printerName) throw new Error('Tiquetera sin nombre de impresora Windows configurado');
      await this._printWindows(printer.printerName, cmd);
    } else {
      const { vendorId, productId } = printer;
      if (vendorId == null || productId == null) throw new Error('Tiquetera sin dispositivo USB configurado');
      await this._printUsb(vendorId, productId, cmd);
    }
  }

  // ── Windows: raw print via PowerShell + Win32 WritePrinter ──────────────────
  async _printWindows(printerName, cmd) {
    const { execFile } = require('child_process');
    const tmpFile = path.join(os.tmpdir(), `tspl_${Date.now()}.bin`);
    fs.writeFileSync(tmpFile, cmd);

    return new Promise((resolve, reject) => {
      execFile('powershell', [
        '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', getWinPs1Path(),
        '-printerName', printerName,
        '-filePath', tmpFile,
      ], { timeout: 10000 }, (err, _stdout, stderr) => {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
        if (err) return reject(new Error(`Error imprimiendo (Windows): ${stderr || err.message}`));
        resolve();
      });
    });
  }

  // ── Mac/Linux: raw print via node-usb ───────────────────────────────────────
  async _printUsb(vendorId, productId, cmd) {
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
