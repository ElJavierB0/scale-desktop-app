const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const { log } = require('./logger');
const { getAllProfiles } = require('../scale-profiles');

async function listPorts() {
  try {
    const ports = await SerialPort.list();
    log('info', `Puertos serial detectados: ${ports.length}`);
    for (const p of ports) {
      log('info', `  - ${p.path} ${p.manufacturer || ''} ${p.serialNumber || ''}`);
    }
    return ports;
  } catch (err) {
    log('error', `Error listando puertos: ${err.message}`);
    return [];
  }
}

function parseWeight(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const cleaned = raw
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/[a-zA-Z]/g, '')
    .replace(/,/g, '.')
    .trim();

  if (cleaned.length === 0) return null;

  const match = cleaned.match(/-?\d+\.?\d*/);
  if (!match) return null;

  const weight = parseFloat(match[0]);
  return isNaN(weight) ? null : weight;
}

/**
 * Test reading from a scale on a given port with given serial config.
 * Returns { success, weight, raw, profileId } or { success: false, error }
 */
function testScaleReading(portPath, config) {
  return new Promise((resolve) => {
    const timeout = config.timeout || 3000;
    let resolved = false;
    let port = null;

    const done = (result) => {
      if (resolved) return;
      resolved = true;
      try {
        if (port && port.isOpen) port.close();
      } catch (e) { /* ignore */ }
      resolve(result);
    };

    const timer = setTimeout(() => {
      done({ success: false, error: 'Timeout: no se recibio respuesta' });
    }, timeout);

    try {
      port = new SerialPort({
        path: portPath,
        baudRate: config.baudRate || 9600,
        dataBits: config.dataBits || 8,
        parity: config.parity || 'none',
        stopBits: config.stopBits || 1,
        autoOpen: false,
      });
    } catch (err) {
      clearTimeout(timer);
      done({ success: false, error: `Error creando puerto: ${err.message}` });
      return;
    }

    const delimiter = config.delimiter || '\r';
    const parser = port.pipe(new ReadlineParser({ delimiter }));

    parser.on('data', (data) => {
      const weight = parseWeight(data);
      clearTimeout(timer);
      if (weight !== null) {
        done({ success: true, weight, raw: data.trim() });
      } else {
        done({ success: false, error: `Datos recibidos pero no se pudo parsear peso: "${data.trim()}"`, raw: data.trim() });
      }
    });

    port.on('error', (err) => {
      clearTimeout(timer);
      done({ success: false, error: `Error puerto: ${err.message}` });
    });

    port.open((err) => {
      if (err) {
        clearTimeout(timer);
        done({ success: false, error: `No se pudo abrir puerto: ${err.message}` });
        return;
      }

      // If profile has a pollCommand, send it
      if (config.pollCommand) {
        port.write(config.pollCommand, (writeErr) => {
          if (writeErr) {
            clearTimeout(timer);
            done({ success: false, error: `Error enviando comando: ${writeErr.message}` });
          }
        });
      }
      // Otherwise wait for continuous transmission
    });
  });
}

/**
 * Auto-detect scales on all available USB serial ports.
 * Tries each profile on each port. Returns array of detected scales.
 */
async function autoDetect() {
  const ports = await listPorts();
  const profiles = getAllProfiles().filter(p => p.id !== 'custom');
  const detected = [];

  for (const portInfo of ports) {
    for (const profile of profiles) {
      log('info', `Probando ${portInfo.path} con perfil ${profile.id}...`);

      const result = await testScaleReading(portInfo.path, {
        baudRate: profile.baudRate,
        dataBits: profile.dataBits,
        parity: profile.parity,
        stopBits: profile.stopBits,
        pollCommand: profile.pollCommand,
        delimiter: profile.delimiter,
        timeout: 3000,
      });

      if (result.success) {
        log('info', `Detectada bascula en ${portInfo.path}: perfil=${profile.id}, peso=${result.weight}`);
        detected.push({
          port: portInfo.path,
          portInfo,
          profile,
          weight: result.weight,
          raw: result.raw,
        });
        break; // Found a matching profile for this port, move to next port
      }
    }
  }

  return detected;
}

module.exports = { listPorts, parseWeight, testScaleReading, autoDetect };
