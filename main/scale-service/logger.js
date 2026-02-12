const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let logDir = null;

function getLogDir() {
  if (!logDir) {
    logDir = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  }
  return logDir;
}

function getLogFilePath() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(getLogDir(), `scale-service-${date}.log`);
}

function log(level, msg, scaleId = null) {
  const ts = new Date().toISOString();
  const prefix = { info: 'INFO', warn: 'WARN', error: 'ERROR', debug: 'DEBUG' }[level] || 'LOG';
  const tag = scaleId ? `[${scaleId}]` : '[MAIN]';
  const line = `[${ts}] [${prefix}] ${tag} ${msg}`;

  console.log(line);

  try {
    fs.appendFileSync(getLogFilePath(), line + '\n');
  } catch (err) {
    // Don't break if log write fails
  }
}

function cleanOldLogs() {
  try {
    const dir = getLogDir();
    const files = fs.readdirSync(dir);
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
    for (const file of files) {
      if (!file.startsWith('scale-service-')) continue;
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        log('info', `Log antiguo eliminado: ${file}`);
      }
    }
  } catch (err) {
    // Ignore cleanup errors
  }
}

module.exports = { log, cleanOldLogs };
