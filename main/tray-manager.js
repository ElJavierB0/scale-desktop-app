const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let tray = null;

function createTray(mainWindow, onQuit) {
  // Create a simple 16x16 tray icon (scale emoji as text)
  // In production, replace with actual icon files
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      // Fallback: create a small colored icon
      icon = createFallbackIcon();
    }
  } catch (e) {
    icon = createFallbackIcon();
  }

  // Resize for tray
  const trayIcon = icon.resize({ width: 16, height: 16 });

  tray = new Tray(trayIcon);
  tray.setToolTip('Scale Desktop App');

  updateMenu(mainWindow, onQuit);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });

  return tray;
}

function createFallbackIcon() {
  // Create a simple 16x16 green square as fallback
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    canvas[i * 4] = 76;      // R
    canvas[i * 4 + 1] = 175;  // G
    canvas[i * 4 + 2] = 80;   // B
    canvas[i * 4 + 3] = 255;  // A
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function updateMenu(mainWindow, onQuit) {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Mostrar',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        if (onQuit) onQuit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { createTray, updateMenu, destroyTray };
