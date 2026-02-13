const { app, BrowserWindow } = require('electron');
const path = require('path');
const configManager = require('./config-manager');
const { registerHandlers, getScaleManager } = require('./ipc-handlers');
const { createTray, destroyTray } = require('./tray-manager');
const { log } = require('./scale-service/logger');

let mainWindow = null;
let isQuitting = false;

function createWindow(page) {
  const win = new BrowserWindow({
    width: 800,
    height: 650,
    minWidth: 600,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    title: 'Scale Desktop App',
    show: false,
  });

  const htmlFile = path.join(__dirname, '..', 'renderer', page);
  win.loadFile(htmlFile);

  // Remove menu bar
  win.setMenuBarVisibility(false);

  win.once('ready-to-show', () => {
    win.show();
  });

  // Minimize to tray instead of closing
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  return win;
}

function getMainWindow() {
  return mainWindow;
}

app.whenReady().then(async () => {
  // Initialize config store
  configManager.init();

  // Register IPC handlers
  registerHandlers(getMainWindow);

  // Start on login page
  mainWindow = createWindow('login.html');

  // Create system tray
  createTray(mainWindow, async () => {
    isQuitting = true;

    // Disconnect from server on quit
    const manager = getScaleManager();
    if (manager) {
      manager.stop();
    }

    // Call disconnect API
    try {
      const config = configManager.getAll();
      if (config.serverUrl && config.bearerToken && config.stationKey) {
        const { ApiClient } = require('./scale-service/api-client');
        const client = new ApiClient(config);
        await client.disconnect();
        log('info', 'Desconectado del servidor');
      }
    } catch (err) {
      log('warn', `Error al desconectar: ${err.message}`);
    }

    destroyTray();
    app.quit();
  });

  // Handle auto-launch
  try {
    const AutoLaunch = require('auto-launch');
    const autoLauncher = new AutoLaunch({
      name: 'Scale Desktop App',
      isHidden: true,
    });

    if (configManager.getAll().autoLaunch) {
      autoLauncher.enable();
    } else {
      autoLauncher.disable();
    }
  } catch (err) {
    log('warn', `Auto-launch no disponible: ${err.message}`);
  }
});

// macOS: re-create window on dock click
app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Navigation between login and app
const { ipcMain } = require('electron');

ipcMain.on('navigate-to-app', () => {
  if (mainWindow) {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'app.html'));
  }
});

ipcMain.on('navigate-to-login', () => {
  if (mainWindow) {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'login.html'));
  }
});
