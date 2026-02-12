const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Wizard step 1: Server connection
  verifyServer: (url, token) => ipcRenderer.invoke('verify-server', url, token),

  // Wizard step 2: Register station
  registerStation: (name) => ipcRenderer.invoke('register-station', name),
  getHostname: () => ipcRenderer.invoke('get-hostname'),

  // Wizard step 3: Scale detection
  scanPorts: () => ipcRenderer.invoke('scan-ports'),
  autoDetectScales: () => ipcRenderer.invoke('auto-detect-scales'),
  testScaleReading: (portPath, profileId, customConfig) =>
    ipcRenderer.invoke('test-scale-reading', portPath, profileId, customConfig),
  getProfiles: () => ipcRenderer.invoke('get-profiles'),

  // Wizard step 4: Save and start
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  startService: () => ipcRenderer.invoke('start-service'),

  // Status page
  getServiceStatus: () => ipcRenderer.invoke('get-service-status'),
  stopService: () => ipcRenderer.invoke('stop-service'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  isConfigured: () => ipcRenderer.invoke('is-configured'),
  reconfigure: () => ipcRenderer.invoke('reconfigure'),

  // Events from main
  onScaleUpdate: (callback) => {
    ipcRenderer.on('scale-update', (_event, data) => callback(data));
  },
  onServiceStatus: (callback) => {
    ipcRenderer.on('service-status', (_event, data) => callback(data));
  },
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // Navigation
  navigateToStatus: () => ipcRenderer.send('navigate-to-status'),
  navigateToWizard: () => ipcRenderer.send('navigate-to-wizard'),
});
