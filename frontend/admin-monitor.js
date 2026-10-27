(() => {
  const localHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const apiBase = window.API_BASE_URL || (
    localHost && ['5500', ''].includes(window.location.port)
      ? `${window.location.protocol}//${window.location.hostname}:8080/api/v1`
      : `${window.location.origin}/api/v1`
  );

  const money = (value) => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL'
  }).format(Number(value || 0));

  const esc = (value) => String(value ?? '').replace(/[&<>\"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#039;'
  }[char]));

  const statusLabel = {
    awaiting_payment: 'Pagamento pendente',
    paid: 'Pago',
    processing: 'Em separação',
    shipped: 'Enviado',
    delivered: 'Entregue',
    cancelled: 'Cancelado'
  };

  let timer = null;
  let previousSnapshot = '';
  let busy = false;

  function ensurePanel() {
    const adminPanel = document.querySelector('#admin-panel');
    const tabs = adminPanel?.querySelector('.admin-tabs');
    if (!adminPanel || !tabs || document.querySelector('#live-db-monitor')) return !!adminPanel;

    const section = document.createElement('section');
    section.id = 'live-db-monitor';
    section.className = 'live-monitor';
    section.innerHTML = `
      <div class="live-monitor-head">
        <div>
          <p class="kicker">DATABASE / LIVE MONITOR</p>
          <h3>Banco de dados em tempo real</h3>
          <p class="live-monitor-subtitle">A tela atualiza automaticamente para mostrar as alterações feitas no MySQL.</p>
        </div>
        <div class="live-monitor-actions">
          <span id="live-db-status" class="live-status is-loading"><i></i> CONECTANDO</span>
          <button id="live-db-refresh" class="outline-button" type="button">ATUALIZAR AGORA</button>
        </div>
      </div>
      <div id="live-db-alert" class="live-change hidden"></div>
      <div id="live-db-metrics" class="live-metrics"></div>
      <div class="live-monitor-grid">
        <article class="live-card">
          <div class="live-card-title"><span>Pedidos por status</span><small>AGORA</small></div>
          <div id="live-order-statuses" class="live-status-list"></div>
        </article>
        <article class="live-card">
          <div class="live-card-title"><span>Estoque crítico</span><small>≤ 2 UN.</small></div>
          <div id="live-low-stock" class="live-record-list"></div>
        </article>
        <article class="live-card live-card-wide">
          <div class="live-card-title"><span>Últimas alterações</span><small>ATUALIZAÇÃO CONTÍNUA</small></div>
          <div id="live-recent-records" class="live-recent-table"></div>
        </article>
      </div>
      <div class="live-monitor-footer"><span id="live-db-sync">Aguardando primeira leitura...</span><span>Intervalo: 2s</span></div>
    `;
    tabs.insertAdjacentElement('beforebegin', section);
    document.querySelector('#live-db-refresh').addEventListener('click', () => refresh(true));
    return true;
  }

  async function get(path) {
    const response = await fetch(`${apiBase}${path}`, { credentials: 'include' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
    return payload;
  }

  function setStatus(kind, text) {
    const status = document.querySelector('#live-db-status');
    if (!status) return;
    status.className = `live-status ${kind}`;
    status.innerHTML = `<i></i> ${text}`;
  }

  function renderMetrics(products, orders, users) {
    const activeProducts = products.filter((p) => p.active).length;
    const lowStock = products.flatMap((p) => p.sizes.map((s) => ({ ...s, product: p })))
      .filter((s) => s.stock <= 2 && s.product.active).length;
    const activeUsers = users.filter((u) => u.active).length;
    const validOrders = orders.filter((o) => !['cancelled', 'awaiting_payment'].includes(o.status));
    const revenue = validOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const cards = [
      ['Produtos ativos', activeProducts, 'CATÁLOGO'],
      ['Usuários', users.length, `${activeUsers} ativos`],
      ['Pedidos', orders.length, `${validOrders.length} confirmados`],
      ['Faturamento demo', money(revenue), 'PEDIDOS CONFIRMADOS'],
      ['Estoque crítico', lowStock, 'TAMANHO / ≤ 2 UN.']
    ];
    document.querySelector('#live-db-metrics').innerHTML = cards.map(([label, value, meta]) => `
      <div class="live-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></div>
    `).join('');
  }

  function renderStatuses(orders) {
    const counts = orders.reduce((acc, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1;
      return acc;
    }, {});
    const total = Math.max(orders.length, 1);
    const statuses = ['paid', 'processing', 'shipped', 'delivered', 'awaiting_payment', 'cancelled'];
    document.querySelector('#live-order-statuses').innerHTML = statuses.map((status) => {
      const count = counts[status] || 0;
      const width = Math.max((count / total) * 100, count ? 6 : 0);
      return `<div class="live-status-row"><span>${esc(statusLabel[status])}</span><b>${count}</b><i><em style="width:${width}%"></em></i></div>`;
    }).join('');
  }

  function renderLowStock(products) {
    const rows = products.flatMap((product) => product.sizes
      .filter((size) => size.stock <= 2 && product.active)
      .map((size) => ({ product, size })))
      .sort((a, b) => a.size.stock - b.size.stock)
      .slice(0, 8);
    document.querySelector('#live-low-stock').innerHTML = rows.length ? rows.map(({ product, size }) => `
      <div class="live-record"><span><strong>${esc(product.name)}</strong><small>Tamanho ${size.size}</small></span><b class="stock-${size.stock === 0 ? 'zero' : 'low'}">${size.stock} un.</b></div>
    `).join('') : '<div class="live-empty">Nenhum estoque crítico. Tudo certo.</div>';
  }

  function renderRecent(orders, products, users) {
    const orderRows = orders.slice(0, 4).map((order) => ({
      date: order.created_at, type: 'PEDIDO', id: `#${order.id}`,
      title: order.customer?.name || 'Cliente',
      detail: statusLabel[order.status] || order.status,
      value: money(order.total)
    }));
    const productRows = products.slice(0, 3).map((product) => ({
      date: product.created_at || '', type: 'PRODUTO', id: `#${product.id}`,
      title: product.name, detail: `${product.brand} / ${product.category}`,
      value: money(product.price)
    }));
    const userRows = users.slice(0, 3).map((user) => ({
      date: user.created_at, type: 'USUÁRIO', id: `#${user.id}`,
      title: user.name, detail: user.role === 'admin' ? 'Administrador' : 'Cliente', value: `${user.orders_count} pedidos`
    }));
    const rows = [...orderRows, ...productRows, ...userRows].slice(0, 10);
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    document.querySelector('#live-recent-records').innerHTML = rows.length ? `
      <div class="live-table-head"><span>TIPO</span><span>REGISTRO</span><span>DETALHE</span><span>VALOR</span></div>
      ${rows.map((row) => `<div class="live-table-row"><span class="live-type">${esc(row.type)}</span><span><strong>${esc(row.id)} · ${esc(row.title)}</strong></span><span>${esc(row.detail)}</span><b>${esc(row.value)}</b></div>`).join('')}
    ` : '<div class="live-empty">Nenhum registro encontrado.</div>';
  }

  async function refresh(manual = false) {
    if (busy || !ensurePanel()) return;
    busy = true;
    try {
      const [productsPayload, ordersPayload, usersPayload] = await Promise.all([
        get('/admin/products'), get('/admin/orders'), get('/admin/users')
      ]);
      const products = productsPayload.products || [];
      const orders = ordersPayload.orders || [];
      const users = usersPayload.users || [];
      const snapshot = JSON.stringify({
        products: products.map((p) => [p.id, p.name, p.price, p.active, p.sizes]),
        orders: orders.map((o) => [o.id, o.status, o.total, o.tracking_code]),
        users: users.map((u) => [u.id, u.active, u.role, u.orders_count])
      });
      const changed = previousSnapshot && previousSnapshot !== snapshot;
      previousSnapshot = snapshot;
      renderMetrics(products, orders, users);
      renderStatuses(orders);
      renderLowStock(products);
      renderRecent(orders, products, users);
      setStatus('is-live', ' AO VIVO');
      const now = new Date().toLocaleTimeString('pt-BR');
      document.querySelector('#live-db-sync').textContent = `Última sincronização: ${now} · ${products.length + orders.length + users.length} registros monitorados`;
      const alert = document.querySelector('#live-db-alert');
      if (changed || manual) {
        alert.textContent = changed ? `● Alteração detectada no banco às ${now}` : `● Banco sincronizado às ${now}`;
        alert.classList.remove('hidden');
        clearTimeout(alert._hideTimer);
        alert._hideTimer = setTimeout(() => alert.classList.add('hidden'), 2800);
      }
    } catch (error) {
      setStatus('is-error', ' SEM CONEXÃO');
      document.querySelector('#live-db-sync').textContent = `Falha na leitura: ${error.message}`;
    } finally {
      busy = false;
    }
  }

  function start() {
    if (!ensurePanel()) return;
    refresh();
    clearInterval(timer);
    timer = setInterval(refresh, 2000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
