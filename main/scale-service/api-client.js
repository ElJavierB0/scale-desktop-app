const { log } = require('./logger');

class ApiClient {
  constructor(config) {
    this.serverUrl = config.serverUrl;
    this.bearerToken = config.bearerToken;
    this.stationId = config.stationId;
    this.stationKey = config.stationKey;
  }

  get headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.bearerToken}`,
      'X-Station-Key': this.stationKey,
      'Accept': 'application/json',
    };
  }

  url(path) {
    const base = this.serverUrl.replace(/\/+$/, '');
    return `${base}/api/scale${path}`;
  }

  async verifyConnection() {
    try {
      const response = await fetch(this.url('/health'), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.bearerToken}`,
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const msg = body?.error || `Servidor respondio ${response.status}`;
        return { success: false, error: msg };
      }
      const data = await response.json();
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async registerStation(name) {
    try {
      const response = await fetch(this.url('/register'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.bearerToken}`,
          'Accept': 'application/json',
        },
        body: JSON.stringify({ name }),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        const body = await response.text();
        return { success: false, error: `Servidor respondio ${response.status}: ${body}` };
      }

      const data = await response.json();
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async sendWeight(payload) {
    try {
      const response = await fetch(this.url('/weight'), {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(2000),
      });

      if (response.ok) {
        return { success: true };
      } else if (response.status === 429) {
        return { success: false, rateLimited: true };
      } else {
        return { success: false, status: response.status };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async disconnect() {
    try {
      const response = await fetch(this.url('/disconnect'), {
        method: 'POST',
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });
      return { success: response.ok };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async fetchConfig() {
    try {
      const response = await fetch(this.url('/config'), {
        method: 'GET',
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        log('error', `API respondio ${response.status} al obtener config`);
        return null;
      }

      const data = await response.json();

      // Unescape pollCommand strings from DB
      if (data.scales) {
        for (const s of data.scales) {
          s.pollCommand = unescapeString(s.pollCommand);
        }
      }

      return data;
    } catch (err) {
      log('error', `Error obteniendo config desde API: ${err.message}`);
      return null;
    }
  }
}

function unescapeString(str) {
  if (!str) return str;
  return str
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
}

module.exports = { ApiClient, unescapeString };
