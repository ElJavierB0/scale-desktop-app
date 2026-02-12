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

  // Determine which page to show
  const configured = configManager.isConfigured();

  if (configured) {
    // Already configured: show status page and start service
    mainWindow = createWindow('status.html');

    // Auto-start the scale service
    try {
      const { ScaleManager } = require('./scale-service/scale-manager');
      const config = configManager.getAll();
      const manager = new ScaleManager(config);

      manager.onScaleUpdate = (state) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('scale-update', state);
        }
      };

      const { setScaleManager } = require('./ipc-handlers');
      setScaleManager(manager);

      await manager.start();
      log('info', 'Servicio iniciado automaticamente');
    } catch (err) {
      log('error', `Error auto-iniciando servicio: ${err.message}`);
    }
  } else {
    // First run: show wizard
    mainWindow = createWindow('wizard.html');
  }

  // Create system tray
  createTray(mainWindow, () => {
    isQuitting = true;
    const manager = getScaleManager();
    if (manager) manager.stop();
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

// Navigation between wizard and status
const { ipcMain } = require('electron');

ipcMain.on('navigate-to-status', () => {
  if (mainWindow) {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'status.html'));
  }
});

ipcMain.on('navigate-to-wizard', () => {
  if (mainWindow) {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'wizard.html'));
  }
});
