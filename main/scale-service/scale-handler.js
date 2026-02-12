const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const { log } = require('./logger');
const { parseWeight } = require('./serial-utils');

class ScaleHandler {
  constructor(scaleConfig, apiClient, appConfig) {
    this.scaleId = scaleConfig.scaleId;
    this.portPath = scaleConfig.port;
    this.baudRate = scaleConfig.baudRate || 9600;
    this.dataBits = scaleConfig.dataBits || 8;
    this.parity = scaleConfig.parity || 'none';
    this.stopBits = scaleConfig.stopBits || 1;
    this.readIntervalMs = scaleConfig.readIntervalMs || 200;
    this.pollCommand = scaleConfig.pollCommand || 'W\r\n';
    this.delimiter = scaleConfig.delimiter || '\r';

    this.apiClient = apiClient;
    this.appConfig = appConfig;

    // State
    this.readings = [];
    this.lastSentWeight = null;
    this.lastSentStable = null;
    this.lastSentTime = 0;
    this.stableStartTime = null;
    this.port = null;
    this.parser = null;
    this.pollInterval = null;
    this.apiInterval = null;
    this.reconnecting = false;
    this.readCount = 0;
    this.currentWeight = 0;
    this.currentStable = false;
    this.apiBackoffUntil = 0;
    this.connected = false;
    this.lastError = null;

    // Callback for UI updates
    this.onStateChange = null;
  }

  getCurrentState() {
    return {
      scaleId: this.scaleId,
      port: this.portPath,
      weight: this.currentWeight,
      stable: this.currentStable,
      connected: this.connected,
      readCount: this.readCount,
      lastError: this.lastError,
    };
  }

  checkStability() {
    const windowSize = this.appConfig.stabilityWindowSize || 5;
    const threshold = this.appConfig.stabilityThresholdKg || 0.05;
    const requiredMs = this.appConfig.stabilityRequiredMs || 500;

    if (this.readings.length < windowSize) return false;

    const window = this.readings.slice(-windowSize);
    const min = Math.min(...window);
    const max = Math.max(...window);
    const variation = max - min;
    const avgWeight = window.reduce((a, b) => a + b, 0) / window.length;

    if (avgWeight <= 0) {
      this.stableStartTime = null;
      return false;
    }

    if (variation > threshold) {
      this.stableStartTime = null;
      return false;
    }

    const now = Date.now();
    if (!this.stableStartTime) {
      this.stableStartTime = now;
      return false;
    }

    return (now - this.stableStartTime >= requiredMs);
  }

  async sendToApi() {
    const weight = this.currentWeight;
    const stable = this.currentStable;
    const now = Date.now();

    if (now < this.apiBackoffUntil) return;

    const changed = weight !== this.lastSentWeight || stable !== this.lastSentStable;
    const heartbeatDue = (now - this.lastSentTime) >= (this.appConfig.heartbeatMs || 2000);

    if (!changed && !heartbeatDue) return;
    if (!stable && !heartbeatDue) return;

    const payload = {
      station_id: this.appConfig.stationId,
      scale_id: this.scaleId,
      weight: weight,
      stable: stable,
      timestamp: new Date().toISOString(),
    };

    const result = await this.apiClient.sendWeight(payload);

    if (result.success) {
      this.lastSentWeight = weight;
      this.lastSentStable = stable;
      this.lastSentTime = now;
      if (changed && stable && weight > 0) {
        log('info', `>>> PESO ESTABLE: ${weight} kg`, this.scaleId);
      }
    } else if (result.rateLimited) {
      this.apiBackoffUntil = now + 5000;
      log('warn', 'Rate limited (429) - backoff 5s', this.scaleId);
    } else {
      log('warn', `Error enviando peso: ${result.error || `status ${result.status}`}`, this.scaleId);
    }
  }

  processReading(raw) {
    this.readCount++;
    const weight = parseWeight(raw);

    if (this.readCount <= 3 || this.readCount % 100 === 0) {
      log('debug', `Lectura #${this.readCount} -> ${weight} kg`, this.scaleId);
    }

    if (weight === null) return;

    this.currentWeight = Math.round(weight * 1000) / 1000;

    const windowSize = this.appConfig.stabilityWindowSize || 5;
    this.readings.push(weight);
    if (this.readings.length > windowSize * 2) {
      this.readings.splice(0, this.readings.length - windowSize);
    }

    this.currentStable = this.checkStability();

    // Notify UI
    if (this.onStateChange) {
      this.onStateChange(this.getCurrentState());
    }
  }

  startPolling() {
    if (this.pollInterval) return;
    if (!this.pollCommand) return; // Continuous transmission, no polling needed

    log('info', `Polling cada ${this.readIntervalMs}ms`, this.scaleId);

    this.pollInterval = setInterval(() => {
      if (this.port && this.port.isOpen) {
        this.port.write(this.pollCommand, (err) => {
          if (err) log('error', `Error poll: ${err.message}`, this.scaleId);
        });
      }
    }, this.readIntervalMs);
  }

  startApiSync() {
    if (this.apiInterval) return;

    const interval = this.appConfig.apiSyncIntervalMs || 500;
    log('info', `Sincronizando con API cada ${interval}ms`, this.scaleId);

    this.apiInterval = setInterval(() => {
      this.sendToApi();
    }, interval);
  }

  stopTimers() {
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
    if (this.apiInterval) { clearInterval(this.apiInterval); this.apiInterval = null; }
  }

  connect() {
    if (this.reconnecting) return;

    log('info', `Conectando a ${this.portPath} @ ${this.baudRate} baud...`, this.scaleId);

    try {
      this.port = new SerialPort({
        path: this.portPath,
        baudRate: this.baudRate,
        dataBits: this.dataBits,
        parity: this.parity,
        stopBits: this.stopBits,
        autoOpen: false,
      });
    } catch (err) {
      log('error', `Error creando puerto: ${err.message}`, this.scaleId);
      this.lastError = err.message;
      this.connected = false;
      this.scheduleReconnect();
      return;
    }

    this.parser = this.port.pipe(new ReadlineParser({ delimiter: this.delimiter }));

    this.port.open((err) => {
      if (err) {
        log('error', `No se pudo abrir puerto: ${err.message}`, this.scaleId);
        this.lastError = err.message;
        this.connected = false;
        this.scheduleReconnect();
        return;
      }

      log('info', `Puerto abierto: ${this.portPath}`, this.scaleId);
      this.reconnecting = false;
      this.connected = true;
      this.lastError = null;

      // Reset state
      this.readings.length = 0;
      this.lastSentWeight = null;
      this.lastSentStable = null;
      this.lastSentTime = 0;
      this.stableStartTime = null;
      this.currentWeight = 0;
      this.currentStable = false;
      this.readCount = 0;

      this.startPolling();
      this.startApiSync();

      if (this.onStateChange) {
        this.onStateChange(this.getCurrentState());
      }
    });

    this.parser.on('data', (data) => {
      this.processReading(data);
    });

    this.port.on('error', (err) => {
      log('error', `Error puerto serial: ${err.message}`, this.scaleId);
      this.lastError = err.message;
      this.connected = false;
      this.cleanup();
      this.scheduleReconnect();
    });

    this.port.on('close', () => {
      log('warn', 'Puerto serial cerrado', this.scaleId);
      this.connected = false;
      this.cleanup();
      this.scheduleReconnect();
    });
  }

  cleanup() {
    this.stopTimers();
    if (this.port && this.port.isOpen) {
      try { this.port.close(); } catch (e) { /* ignore */ }
    }
    this.port = null;
    this.parser = null;
  }

  scheduleReconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    const delay = this.appConfig.reconnectIntervalMs || 5000;
    log('info', `Reintentando en ${delay / 1000}s...`, this.scaleId);
    setTimeout(() => { this.reconnecting = false; this.connect(); }, delay);
  }

  destroy() {
    this.cleanup();
    this.reconnecting = true; // Prevent reconnection
  }
}

module.exports = { ScaleHandler };
