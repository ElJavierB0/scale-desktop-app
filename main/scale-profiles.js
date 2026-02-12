const PROFILES = [
  {
    id: 'torrey-fs250',
    brand: 'Torrey',
    model: 'FS-250',
    baudRate: 9600,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    pollCommand: 'W\r\n',
    delimiter: '\r',
    description: 'Torrey FS-250 (bascula de piso)',
  },
  {
    id: 'torrey-l-eq',
    brand: 'Torrey',
    model: 'L-EQ',
    baudRate: 9600,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    pollCommand: 'W\r\n',
    delimiter: '\r',
    description: 'Torrey L-EQ (bascula de mesa)',
  },
  {
    id: 'generic-continuous',
    brand: 'Generica',
    model: 'Transmision continua',
    baudRate: 9600,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    pollCommand: null,
    delimiter: '\r\n',
    description: 'Bascula generica que transmite peso continuamente',
  },
  {
    id: 'custom',
    brand: 'Personalizada',
    model: 'Configuracion manual',
    baudRate: 9600,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    pollCommand: 'W\r\n',
    delimiter: '\r',
    description: 'Configurar todos los parametros manualmente',
  },
];

function getProfileById(id) {
  return PROFILES.find(p => p.id === id) || null;
}

function getAllProfiles() {
  return PROFILES;
}

module.exports = { PROFILES, getProfileById, getAllProfiles };
