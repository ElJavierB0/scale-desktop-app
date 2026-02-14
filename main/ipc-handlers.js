const { ipcMain } = require('electron');
const os = require('os');
const configManager = require('./config-manager');
const { getAllProfiles, getProfileById } = require('./scale-profiles');
const { listPorts, autoDetect, testScaleReading } = require('./scale-service/serial-utils');
const { ApiClient } = require('./scale-service/api-client');
const { log } = require('./scale-service/logger');

let scaleManager = null;

function setScaleManager(manager) {
  scaleManager = manager;
}

function registerHandlers(getMainWindow) {
  // Step 1: Verify server connection
  ipcMain.handle('verify-server', async (_event, url, token) => {
    const client = new ApiClient({ serverUrl: url, bearerToken: token });
    return await client.verifyConnection();
  });

  // Step 2: Register station
  ipcMain.handle('register-station', async (_event, name) => {
    const config = configManager.getAll();
    const client = new ApiClient({ serverUrl: config.serverUrl, bearerToken: config.bearerToken });
    const result = await client.registerStation(name);

    if (result.success) {
      configManager.set('stationId', result.data.stationId);
      configManager.set('stationKey', result.data.stationKey);
      // No resetear working flags; el servidor ya reactivó todas las básculas.
      // La app sincronizará zona (active/inactive) después de iniciar el servicio.
    }

    return result;
  });

  ipcMain.handle('get-hostname', async () => {
    return os.hostname();
  });

  // Step 3: Scale detection
  ipcMain.handle('scan-ports', async () => {
    return await listPorts();
  });

  ipcMain.handle('auto-detect-scales', async () => {
    return await autoDetect();
  });

  ipcMain.handle('test-scale-reading', async (_event, portPath, profileId, customConfig) => {
    let config;
    if (profileId === 'custom' && customConfig) {
      config = customConfig;
    } else {
      const profile = getProfileById(profileId);
      if (!profile) return { success: false, error: 'Perfil no encontrado' };
      config = {
        baudRate: profile.baudRate,
        dataBits: profile.dataBits,
        parity: profile.parity,
        stopBits: profile.stopBits,
        pollCommand: profile.pollCommand,
        delimiter: profile.delimiter,
        timeout: 3000,
      };
    }
    return await testScaleReading(portPath, config);
  });

  ipcMain.handle('get-profiles', async () => {
    return getAllProfiles();
  });

  // Step 4: Save config and start
  ipcMain.handle('save-config', async (_event, newConfig) => {
    try {
      if (newConfig.serverUrl) configManager.set('serverUrl', newConfig.serverUrl);
      if (newConfig.bearerToken) configManager.set('bearerToken', newConfig.bearerToken);
      if (newConfig.stationId) configManager.set('stationId', newConfig.stationId);
      if (newConfig.stationKey) configManager.set('stationKey', newConfig.stationKey);
      if (newConfig.scales) configManager.set('scales', newConfig.scales);
      if (newConfig.autoLaunch !== undefined) configManager.set('autoLaunch', newConfig.autoLaunch);
      configManager.set('configured', true);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('start-service', async () => {
    try {
      if (scaleManager) {
        scaleManager.stop();
      }

      const { ScaleManager } = require('./scale-service/scale-manager');
      const config = configManager.getAll();
      scaleManager = new ScaleManager(config);

      // Forward scale updates to renderer
      scaleManager.onScaleUpdate = (state) => {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('scale-update', state);
        }
      };

      await scaleManager.start();
      return { success: true };
    } catch (err) {
      log('error', `Error iniciando servicio: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // Status page
  ipcMain.handle('get-service-status', async () => {
    if (!scaleManager) {
      return { running: false, scales: [] };
    }
    return scaleManager.getStatus();
  });

  ipcMain.handle('stop-service', async () => {
    if (scaleManager) {
      scaleManager.stop();
      scaleManager = null;
    }
    return { success: true };
  });

  ipcMain.handle('get-config', async () => {
    return configManager.getAll();
  });

  // Toggle auto-launch on system startup
  ipcMain.handle('set-auto-launch', async (_event, enabled) => {
    try {
      const AutoLaunch = require('auto-launch');
      const autoLauncher = new AutoLaunch({
        name: 'Scale Desktop App',
        isHidden: true,
      });

      if (enabled) {
        await autoLauncher.enable();
      } else {
        await autoLauncher.disable();
      }

      configManager.set('autoLaunch', enabled);
      log('info', `Auto-launch ${enabled ? 'activado' : 'desactivado'}`);
      return { success: true };
    } catch (err) {
      log('error', `Error configurando auto-launch: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('is-configured', async () => {
    return configManager.isConfigured();
  });

  // Reconfigure: clear station + scales, keep server credentials
  ipcMain.handle('reconfigure', async () => {
    try {
      if (scaleManager) {
        scaleManager.stop();
        scaleManager = null;
      }
      configManager.set('stationId', '');
      configManager.set('stationKey', '');
      configManager.set('scales', []);
      configManager.set('configured', false);
      return { success: true };
    } catch (err) {
      log('error', `Error reconfigurando: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // Edit a scale's configuration
  ipcMain.handle('edit-scale', async (_event, scaleId, newConfig) => {
    try {
      const config = configManager.getAll();
      const scales = config.scales || [];
      const index = scales.findIndex(s => s.scaleId === scaleId);

      if (index === -1) {
        return { success: false, error: 'Bascula no encontrada' };
      }

      // Check port conflicts (if port changed)
      if (newConfig.port && newConfig.port !== scales[index].port) {
        const conflict = scales.find((s, i) => i !== index && s.port === newConfig.port);
        if (conflict) {
          return { success: false, error: `El puerto ${newConfig.port} ya esta en uso por ${conflict.scaleId}` };
        }
      }

      // Merge new config into existing
      scales[index] = { ...scales[index], ...newConfig };
      configManager.set('scales', scales);

      // Restart service to pick up changes
      if (scaleManager) {
        scaleManager.stop();
      }

      if (scales.length > 0) {
        const { ScaleManager } = require('./scale-service/scale-manager');
        const updatedConfig = configManager.getAll();
        scaleManager = new ScaleManager(updatedConfig);

        scaleManager.onScaleUpdate = (state) => {
          const win = getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send('scale-update', state);
          }
        };

        await scaleManager.start();
      }

      log('info', `Bascula editada: ${scaleId}`);
      return { success: true };
    } catch (err) {
      log('error', `Error editando bascula: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // Sync all scale zones to server based on local working flags
  ipcMain.handle('sync-zones', async () => {
    try {
      const config = configManager.getAll();
      if (!config.serverUrl || !config.bearerToken || !config.stationKey) {
        return { success: false, error: 'No configurado' };
      }
      const client = new ApiClient(config);
      const scales = config.scales || [];
      const results = [];

      for (const s of scales) {
        const active = s.working !== false;
        const result = await client.setZone(s.scaleId, active);
        results.push({ scaleId: s.scaleId, active, success: result.success });
        if (!result.success) {
          log('warn', `Error sincronizando zona ${s.scaleId}: ${result.error}`);
        }
      }

      log('info', `Zonas sincronizadas: ${results.filter(r => r.success).length}/${results.length}`);
      return { success: true, results };
    } catch (err) {
      log('error', `Error sincronizando zonas: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // Set scale zone status (active/inactive on server)
  ipcMain.handle('set-zone', async (_event, scaleId, active) => {
    try {
      const config = configManager.getAll();
      if (!config.serverUrl || !config.bearerToken || !config.stationKey) {
        return { success: false, error: 'No configurado' };
      }
      const client = new ApiClient(config);
      return await client.setZone(scaleId, active);
    } catch (err) {
      log('error', `Error actualizando zona de bascula: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // Disconnect from server (marks station inactive)
  ipcMain.handle('disconnect', async () => {
    try {
      const config = configManager.getAll();
      if (config.serverUrl && config.bearerToken && config.stationKey) {
        const { ApiClient } = require('./scale-service/api-client');
        const client = new ApiClient(config);
        await client.disconnect();
      }

      if (scaleManager) {
        scaleManager.stop();
        scaleManager = null;
      }

      // No resetear working flags localmente; al reconectar se sincronizan con el servidor.
      // Así el usuario mantiene su configuración de zona de trabajo entre sesiones.

      return { success: true };
    } catch (err) {
      log('error', `Error desconectando: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // Scale management: add a scale and restart service
  ipcMain.handle('add-scale', async (_event, scaleConfig) => {
    try {
      const config = configManager.getAll();
      const scales = config.scales || [];

      // Check duplicates
      if (scales.find(s => s.scaleId === scaleConfig.scaleId)) {
        return { success: false, error: 'Ya existe una bascula con ese Scale ID' };
      }
      if (scales.find(s => s.port === scaleConfig.port)) {
        return { success: false, error: 'Ya existe una bascula configurada en ese puerto' };
      }

      scales.push(scaleConfig);
      configManager.set('scales', scales);

      // Restart service to pick up new scale
      if (scaleManager) {
        scaleManager.stop();
      }

      const { ScaleManager } = require('./scale-service/scale-manager');
      const updatedConfig = configManager.getAll();
      scaleManager = new ScaleManager(updatedConfig);

      scaleManager.onScaleUpdate = (state) => {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('scale-update', state);
        }
      };

      await scaleManager.start();
      log('info', `Bascula agregada: ${scaleConfig.scaleId} en ${scaleConfig.port}`);
      return { success: true };
    } catch (err) {
      log('error', `Error agregando bascula: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // Scale management: remove a scale and restart service
  ipcMain.handle('remove-scale', async (_event, scaleId) => {
    try {
      const config = configManager.getAll();
      const scales = (config.scales || []).filter(s => s.scaleId !== scaleId);
      configManager.set('scales', scales);

      // Restart service
      if (scaleManager) {
        scaleManager.stop();
      }

      if (scales.length > 0) {
        const { ScaleManager } = require('./scale-service/scale-manager');
        const updatedConfig = configManager.getAll();
        scaleManager = new ScaleManager(updatedConfig);

        scaleManager.onScaleUpdate = (state) => {
          const win = getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send('scale-update', state);
          }
        };

        await scaleManager.start();
      } else {
        scaleManager = null;
      }

      log('info', `Bascula eliminada: ${scaleId}`);
      return { success: true };
    } catch (err) {
      log('error', `Error eliminando bascula: ${err.message}`);
      return { success: false, error: err.message };
    }
  });
}

function getScaleManager() {
  return scaleManager;
}

module.exports = { registerHandlers, setScaleManager, getScaleManager };
