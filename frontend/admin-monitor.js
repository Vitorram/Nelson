(() => {
  const localHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const apiBase = window.API_BASE_URL || (localHost
    ? `${window.location.protocol}//${window.location.hostname}:8000/api/v1`
    : `${window.location.origin}/api/v1`);

  async function addMonitorLinkForAdmin() {
    const nav = document.querySelector('.site-header nav');
    if (!nav || document.querySelector('#database-monitor-nav')) return;

    try {
      const response = await fetch(`${apiBase}/auth/me`, {
        credentials: 'include',
        cache: 'no-store'
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data.user?.role !== 'admin') return;

      const link = document.createElement('a');
      link.id = 'database-monitor-nav';
      link.href = 'monitor.html';
      link.textContent = 'Monitor do Banco';
      link.setAttribute('aria-label', 'Abrir monitor do banco de dados');
      nav.insertBefore(link, nav.firstChild);
    } catch {
      // A navegação da loja continua disponível mesmo se a API estiver offline.
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addMonitorLinkForAdmin, { once: true });
  } else {
    addMonitorLinkForAdmin();
  }
})();
