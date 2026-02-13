const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Server connection
  verifyServer: (url, token) => ipcRenderer.invoke('verify-server', url, token),

  // Station
  registerStation: (name) => ipcRenderer.invoke('register-station', name),
  getHostname: () => ipcRenderer.invoke('get-hostname'),

  // Scale detection
  scanPorts: () => ipcRenderer.invoke('scan-ports'),
  autoDetectScales: () => ipcRenderer.invoke('auto-detect-scales'),
  testScaleReading: (portPath, profileId, customConfig) =>
    ipcRenderer.invoke('test-scale-reading', portPath, profileId, customConfig),
  getProfiles: () => ipcRenderer.invoke('get-profiles'),

  // Config
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  getConfig: () => ipcRenderer.invoke('get-config'),

  // Service
  startService: () => ipcRenderer.invoke('start-service'),
  stopService: () => ipcRenderer.invoke('stop-service'),
  getServiceStatus: () => ipcRenderer.invoke('get-service-status'),

  // Scale management
  addScale: (scaleConfig) => ipcRenderer.invoke('add-scale', scaleConfig),
  removeScale: (scaleId) => ipcRenderer.invoke('remove-scale', scaleId),
  editScale: (scaleId, newConfig) => ipcRenderer.invoke('edit-scale', scaleId, newConfig),
  disconnect: () => ipcRenderer.invoke('disconnect'),
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
  navigateToApp: () => ipcRenderer.send('navigate-to-app'),
  navigateToLogin: () => ipcRenderer.send('navigate-to-login'),
});
