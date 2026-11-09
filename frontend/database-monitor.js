(() => {
  const localHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const localFrontend = localHost || window.location.port === '5500';
  const apiBase = window.API_BASE_URL || (localFrontend
    ? `${window.location.protocol}//${window.location.hostname}:8000/api/v1`
    : `${window.location.origin}/api/v1`);
  const metrics = document.querySelector('#metrics');
  const connection = document.querySelector('#connection');
  const fmt = (value) => Number(value || 0).toLocaleString('pt-BR');
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function setConnection(online, message = '') {
    connection.className = `status ${online ? 'online' : 'offline'}`;
    connection.innerHTML = `<i></i> ${online ? 'SISTEMA CONECTADO' : message || 'SEM CONEXÃO'}`;
  }

  async function loadOverview() {
    try {
      const response = await fetch(`${apiBase}/monitor`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);

      const countFor = (names) => {
        const table = (data.tables || []).find(item => names.includes(normalize(item.table)));
        return table ? table.count : 0;
      };
      const cards = [
        { label: 'Usuários', value: countFor(['users', 'user', 'usuarios', 'usuario']), detail: 'contas cadastradas', icon: '♙', tone: 'users' },
        { label: 'Produtos', value: countFor(['products', 'product', 'produtos', 'produto']), detail: 'produtos cadastrados', icon: '▦', tone: 'products' },
        { label: 'Ordens', value: countFor(['orders', 'order', 'ordens', 'ordem', 'pedidos', 'pedido', 'purchases', 'purchase', 'compras', 'compra']), detail: 'ordens de compra registradas', icon: '🛒', tone: 'orders' }
      ];

      metrics.innerHTML = cards.map(card => `
        <article class="metric metric-${card.tone}">
          <div class="metric-top">
            <span class="metric-icon" aria-hidden="true">${card.icon}</span>
            <span class="metric-label">${card.label}</span>
          </div>
          <strong>${fmt(card.value)}</strong>
          <small>${card.detail}</small>
        </article>`).join('');
      setConnection(true);
    } catch (error) {
      console.error('[Database Monitor] Falha ao carregar indicadores:', error);
      setConnection(false, 'ERRO AO CONECTAR');
      metrics.innerHTML = '<p class="error">Não foi possível carregar os indicadores. Verifique se a API está disponível.</p>';
    }
  }

  window.addEventListener('error', event => {
    console.error('[Database Monitor] Erro no navegador:', event.error || event.message);
  });
  loadOverview();
  window.setInterval(() => {
    if (!document.hidden) loadOverview();
  }, 5000);
})();