(() => {
  function addMonitorLink() {
    const nav = document.querySelector('.site-header nav');
    if (!nav || document.querySelector('#database-monitor-nav')) return;

    const link = document.createElement('a');
    link.id = 'database-monitor-nav';
    link.href = 'monitor.html';
    link.textContent = 'Monitor do Banco';
    link.setAttribute('aria-label', 'Abrir monitor do banco de dados');
    nav.insertBefore(link, nav.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addMonitorLink, { once: true });
  } else {
    addMonitorLink();
  }
})();
