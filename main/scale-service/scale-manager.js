const { ScaleHandler } = require('./scale-handler');
const { ApiClient } = require('./api-client');
const { log, cleanOldLogs } = require('./logger');

class ScaleManager {
  constructor(config) {
    this.config = config;
    this.handlers = [];
    this.apiClient = new ApiClient(config);
    this.configPollTimer = null;
    this.lastConfigHash = null;
    this.running = false;

    // Callback for UI updates (forwarded from handlers)
    this.onScaleUpdate = null;
  }

  configHash(scales) {
    return JSON.stringify(scales.map(s => ({
      id: s.scaleId, port: s.port, baud: s.baudRate,
      data: s.dataBits, parity: s.parity, stop: s.stopBits,
      interval: s.readIntervalMs, poll: s.pollCommand,
    })));
  }

  startHandlers(scales) {
    for (const scaleConfig of scales) {
      log('info', `Iniciando bascula ${scaleConfig.scaleId} en ${scaleConfig.port}`, scaleConfig.scaleId);
      const handler = new ScaleHandler(scaleConfig, this.apiClient, this.config);

      // Forward state changes to manager callback
      handler.onStateChange = (state) => {
        if (this.onScaleUpdate) {
          this.onScaleUpdate(state);
        }
      };

      this.handlers.push(handler);
      handler.connect();
    }
  }

  stopAllHandlers() {
    for (const h of this.handlers) {
      h.destroy();
    }
    this.handlers.length = 0;
  }

  async applyApiConfig() {
    const apiConfig = await this.apiClient.fetchConfig();
    if (!apiConfig || !apiConfig.scales || apiConfig.scales.length === 0) {
      log('warn', 'No se obtuvo configuracion valida de la API');
      return false;
    }

    const newHash = this.configHash(apiConfig.scales);
    if (newHash === this.lastConfigHash) {
      log('debug', 'Configuracion sin cambios');
      return true;
    }

    log('info', 'Configuracion cambio, reiniciando handlers...');
    this.lastConfigHash = newHash;
    this.config.stationId = apiConfig.stationId;

    this.stopAllHandlers();
    this.startHandlers(apiConfig.scales);
    return true;
  }

  async start() {
    if (this.running) return;
    this.running = true;

    log('info', 'Iniciando Scale Manager...');
    log('info', `Estacion: ${this.config.stationId}`);
    log('info', `Servidor: ${this.config.serverUrl}`);

    cleanOldLogs();

    // Start with local config (only scales in work zone)
    const workingScales = (this.config.scales || []).filter(s => s.working !== false);
    if (workingScales.length > 0) {
      this.startHandlers(workingScales);
    }

    // Also try API config and set up polling
    const success = await this.applyApiConfig();
    if (!success && this.handlers.length === 0) {
      log('warn', 'No se pudo obtener config de API y no hay config local');
    }

    // Poll API config periodically for remote changes
    this.configPollTimer = setInterval(async () => {
      log('debug', 'Verificando cambios en configuracion de API...');
      await this.applyApiConfig();
    }, 30000);
  }

  stop() {
    if (!this.running) return;
    this.running = false;

    log('info', 'Deteniendo Scale Manager...');
    if (this.configPollTimer) {
      clearInterval(this.configPollTimer);
      this.configPollTimer = null;
    }
    this.stopAllHandlers();
    this.lastConfigHash = null;
  }

  getStatus() {
    return {
      running: this.running,
      stationId: this.config.stationId,
      serverUrl: this.config.serverUrl,
      scales: this.handlers.map(h => h.getCurrentState()),
    };
  }
}

module.exports = { ScaleManager };
