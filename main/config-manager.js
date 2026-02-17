const Store = require('electron-store');

const schema = {
  serverUrl: { type: 'string', default: '' },
  bearerToken: { type: 'string', default: '' },
  stationId: { type: 'string', default: '' },
  stationKey: { type: 'string', default: '' },
  scales: {
    type: 'array',
    default: [],
    items: {
      type: 'object',
      properties: {
        scaleId: { type: 'string' },
        port: { type: 'string' },
        profileId: { type: 'string' },
        baudRate: { type: 'number' },
        dataBits: { type: 'number' },
        parity: { type: 'string' },
        stopBits: { type: 'number' },
        pollCommand: { type: ['string', 'null'] },
        delimiter: { type: 'string' },
        readIntervalMs: { type: 'number' },
        working: { type: 'boolean', default: true },
      },
    },
  },
  autoLaunch: { type: 'boolean', default: false },
  rememberSession: { type: 'boolean', default: false },
  configured: { type: 'boolean', default: false },
  // Stability config
  stabilityWindowSize: { type: 'number', default: 5 },
  stabilityThresholdKg: { type: 'number', default: 0.05 },
  stabilityRequiredMs: { type: 'number', default: 500 },
  // API sync config
  apiSyncIntervalMs: { type: 'number', default: 200 },
  heartbeatMs: { type: 'number', default: 2000 },
  reconnectIntervalMs: { type: 'number', default: 5000 },
};

let store = null;

function init() {
  store = new Store({ schema });
  return store;
}

function getStore() {
  if (!store) init();
  return store;
}

function isConfigured() {
  const s = getStore();
  return s.get('configured') === true
    && s.get('serverUrl')
    && s.get('stationId')
    && s.get('scales', []).length > 0;
}

function getAll() {
  const s = getStore();
  return {
    serverUrl: s.get('serverUrl'),
    bearerToken: s.get('bearerToken'),
    stationId: s.get('stationId'),
    stationKey: s.get('stationKey'),
    scales: s.get('scales'),
    autoLaunch: s.get('autoLaunch'),
    rememberSession: s.get('rememberSession'),
    configured: s.get('configured'),
    stabilityWindowSize: s.get('stabilityWindowSize'),
    stabilityThresholdKg: s.get('stabilityThresholdKg'),
    stabilityRequiredMs: s.get('stabilityRequiredMs'),
    apiSyncIntervalMs: s.get('apiSyncIntervalMs'),
    heartbeatMs: s.get('heartbeatMs'),
    reconnectIntervalMs: s.get('reconnectIntervalMs'),
  };
}

function set(key, value) {
  getStore().set(key, value);
}

function resetAll() {
  getStore().clear();
}

module.exports = { init, getStore, isConfigured, getAll, set, resetAll };
