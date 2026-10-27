(() => {
  const apiBase = window.API_BASE_URL || `${window.location.protocol}//${window.location.hostname}:8000/api/v1`;
  let currentFilter = 'ALL';
  let lastActivityId = 0;
  let busy = false;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));
  const fmtTime = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString('pt-BR');
  };

  async function load() {
    if (busy) return;
    busy = true;
    try {
      const response = await fetch(`${apiBase}/monitor?limit=100`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
      render(data);
      setConnection(true);
    } catch (error) {
      setConnection(false, error.message);
    } finally {
      busy = false;
    }
  }

  function setConnection(ok, message = '') {
    const el = document.querySelector('#connection');
    el.className = `status ${ok ? 'online' : 'offline'}`;
    el.innerHTML = `<i></i> ${ok ? 'AO VIVO' : `SEM CONEXÃO · ${esc(message)}`}`;
  }

  function render(data) {
    const tables = data.tables || [];
    const activity = data.activity || [];
    const totalRows = tables.reduce((sum, item) => sum + Number(item.count || 0), 0);
    const inserts = activity.filter((item) => item.operation === 'INSERT').length;
    const updates = activity.filter((item) => item.operation === 'UPDATE').length;
    const deletes = activity.filter((item) => item.operation === 'DELETE').length;

    document.querySelector('#metrics').innerHTML = [
      ['Tabelas monitoradas', tables.length, 'SCHEMA'],
      ['Registros no banco', totalRows, 'TOTAL'],
      ['INSERTS recentes', inserts, 'ÚLTIMOS 100'],
      ['UPDATES recentes', updates, 'ÚLTIMOS 100'],
      ['DELETES recentes', deletes, 'ÚLTIMOS 100']
    ].map(([label, value, meta]) => `<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${meta}</small></div>`).join('');

    document.querySelector('#tables').innerHTML = tables.length ? tables.map((item) => `
      <div class="table-row"><span>${esc(item.table)}</span><b>${Number(item.count).toLocaleString('pt-BR')}</b></div>
    `).join('') : '<div class="empty">Nenhuma tabela encontrada.</div>';

    document.querySelector('#updated').textContent = `ATUALIZADO ${fmtTime(data.updated_at)}`;
    renderActivity(activity);
  }

  function renderActivity(activity) {
    const filtered = currentFilter === 'ALL' ? activity : activity.filter((item) => item.operation === currentFilter);
    if (!filtered.length) {
      document.querySelector('#activity').innerHTML = '<div class="empty">Nenhuma movimentação para este filtro.</div>';
      return;
    }
    document.querySelector('#activity').innerHTML = filtered.map((item) => `
      <div class="activity-row ${item.operation.toLowerCase()} ${item.id > lastActivityId ? 'new' : ''}">
        <div class="op">${esc(item.operation)}</div>
        <div class="event"><strong>${esc(item.table)}</strong><span>${esc(item.summary)}</span></div>
        <time>${esc(fmtTime(item.created_at))}</time>
      </div>
    `).join('');
    if (activity.length) lastActivityId = Math.max(lastActivityId, ...activity.map((item) => Number(item.id)));
  }

  document.querySelectorAll('.filter').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.filter').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      currentFilter = button.dataset.filter;
      load();
    });
  });

  load();
  setInterval(load, 2000);
})();
