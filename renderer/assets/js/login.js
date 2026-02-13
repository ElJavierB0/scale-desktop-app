const $ = (sel) => document.querySelector(sel);

function showAlert(type, msg) {
  const el = $('#alert-login');
  el.className = `alert alert-${type} show`;
  el.textContent = msg;
}

function hideAlert() {
  const el = $('#alert-login');
  el.className = 'alert';
  el.textContent = '';
}

function setLoading(btn, loading) {
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span> Conectando...';
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.originalText || btn.textContent;
    btn.disabled = false;
  }
}

// Pre-fill from saved config
async function initLogin() {
  const config = await window.electronAPI.getConfig();
  if (config.serverUrl) $('#serverUrl').value = config.serverUrl;
  if (config.bearerToken) $('#bearerToken').value = config.bearerToken;
}

initLogin();

// Connect button
$('#btn-connect').addEventListener('click', async () => {
  const url = $('#serverUrl').value.trim();
  const token = $('#bearerToken').value.trim();

  if (!url) return showAlert('danger', 'Ingresa la URL del servidor');
  if (!token) return showAlert('danger', 'Ingresa el codigo de conexion');

  hideAlert();
  const btn = $('#btn-connect');
  setLoading(btn, true);

  const result = await window.electronAPI.verifyServer(url, token);

  if (result.success) {
    // Save server credentials
    await window.electronAPI.saveConfig({ serverUrl: url, bearerToken: token });
    // Navigate to main app
    window.electronAPI.navigateToApp();
  } else {
    setLoading(btn, false);
    showAlert('danger', `Error: ${result.error}`);
  }
});

// Allow Enter key to submit
$('#bearerToken').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btn-connect').click();
});
$('#serverUrl').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#bearerToken').focus();
});
