(() => {
  const apiBase = window.API_BASE_URL || \`${window.location.protocol}//${window.location.hostname}:8000/api/v1\`;
  const $ = (selector) => document.querySelector(selector);
  const state = { table: null, offset: 0, limit: 50, total: 0, q: '', tab: 'data', sort: null, direction: 'asc' };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const fmt = (value) => Number(value || 0).toLocaleString('pt-BR');

  async function api(path) {
    const response = await fetch(apiBase + path, { credentials: 'include', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || \`HTTP \${response.status}\`);
    return data;
  }

  function connection(ok, message = '') {
    $('#connection').className = \`status \${ok ? 'online' : 'offline'}\`;
    $('#connection').innerHTML = \`<i></i> \${ok ? 'ADMINISTRADOR · CONECTADO' : esc(message || 'SEM CONEXÃO')}\`;
  }

  async function loadOverview() {
    try {
      const data = await api('/monitor');
      connection(true);
      $('#metrics').innerHTML = [
        ['Banco de dados', data.database, 'MYSQL SCHEMA'],
        ['Versão MySQL', data.mysql_version, 'ENGINE'],
        ['Tabelas', data.tables.length, 'SCHEMA'],
        ['Registros', fmt(data.total_rows), 'TOTAL']
      ].map(([label, value, meta]) => \`<article class="metric"><span>\${esc(label)}</span><strong>\${esc(value)}</strong><small>\${meta}</small></article>\`).join('');
      $('#tables').innerHTML = data.tables.map(item => \`
        <button class="table-item \${state.table === item.table ? 'active' : ''}" data-table="\${esc(item.table)}" type="button">
          <span><i>▦</i>\${esc(item.table)}</span><b>\${fmt(item.count)}</b>
        </button>\`).join('') || '<p class="muted">Nenhuma tabela disponível.</p>';
      $('#activity').innerHTML = data.activity.length ? data.activity.map(item => \`
        <div class="activity-row"><b class="\${esc(item.operation.toLowerCase())}">\${esc(item.operation)}</b><strong>\${esc(item.table)}</strong><span>\${esc(item.summary)}</span><time>\${esc(new Date(item.created_at).toLocaleString('pt-BR'))}</time></div>\`).join('') : '<p class="muted">Ainda não há auditoria registrada no banco.</p>';
      document.querySelectorAll('.table-item').forEach(button => button.addEventListener('click', () => selectTable(button.dataset.table)));
    } catch (error) {
      connection(false, error.message);
      $('#metrics').innerHTML = '<p class="error">Não foi possível carregar. Entre com uma conta administradora na loja e tente novamente.</p>';
    }
  }

  async function selectTable(table) {
    state.table = table; state.offset = 0; state.sort = null; state.q = ''; $('#search').value = '';
    $('#selected-table').textContent = table;
    await loadOverview();
    await loadCurrentTab();
  }

  async function loadRows() {
    const params = new URLSearchParams({limit: state.limit, offset: state.offset});
    if (state.q) params.set('q', state.q);
    if (state.sort) { params.set('sort', state.sort); params.set('direction', state.direction); }
    const data = await api(\`/monitor/tables/\${encodeURIComponent(state.table)}/rows?\${params}\`);
    state.total = data.total;
    $('#table-count').textContent = \`\${fmt(data.total)} REGISTROS\`;
    if (!data.rows.length) { $('#data-grid').innerHTML = '<p class="muted">Nenhum registro encontrado.</p>'; }
    else {
      $('#data-grid').innerHTML = \`<table><thead><tr>\${data.columns.map(col => \`<th><button class="sort" data-sort="\${esc(col)}" type="button">\${esc(col)} \${state.sort === col ? (state.direction === 'asc' ? '↑' : '↓') : '↕'}</button></th>\`).join('')}</tr></thead><tbody>\${data.rows.map(row => \`<tr>\${data.columns.map(col => \`<td title="\${esc(row[col])}">\${esc(row[col])}</td>\`).join('')}</tr>\`).join('')}</tbody></table>\`;
      document.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => {
        const col = button.dataset.sort;
        state.direction = state.sort === col && state.direction === 'asc' ? 'desc' : 'asc';
        state.sort = col; loadRows().catch(showError);
      }));
    }
    const start = data.total ? state.offset + 1 : 0;
    $('#page-info').textContent = \`\${fmt(start)}–\${fmt(Math.min(state.offset + data.rows.length, data.total))} de \${fmt(data.total)}\`;
    $('#prev').disabled = state.offset === 0;
    $('#next').disabled = state.offset + state.limit >= data.total;
  }

  async function loadStructure() {
    const data = await api(\`/monitor/tables/\${encodeURIComponent(state.table)}/structure\`);
    $('#structure-grid').innerHTML = \`<h3>Colunas</h3><div class="table-scroll"><table><thead><tr><th>Nome</th><th>Tipo</th><th>Nulo</th><th>Chave</th><th>Default</th></tr></thead><tbody>\${data.columns.map(col => \`<tr><td>\${esc(col.name)}</td><td><code>\${esc(col.type)}</code></td><td>\${col.nullable ? 'SIM' : 'NÃO'}</td><td>\${col.primary_key ? 'PRIMARY KEY' : col.foreign_key ? 'FOREIGN KEY' : '—'}</td><td>\${esc(col.default ?? '—')}</td></tr>\`).join('')}</tbody></table></div><h3>Índices</h3>\${data.indexes.length ? \`<div class="table-scroll"><table><thead><tr><th>Índice</th><th>Colunas</th><th>Único</th></tr></thead><tbody>\${data.indexes.map(i => \`<tr><td>\${esc(i.name)}</td><td>\${esc(i.columns.join(', '))}</td><td>\${i.unique ? 'SIM' : 'NÃO'}</td></tr>\`).join('')}</tbody></table></div>\` : '<p class="muted">Nenhum índice adicional.</p>'}\`;
  }

  async function loadRelations() {
    const data = await api(\`/monitor/tables/\${encodeURIComponent(state.table)}/structure\`);
    $('#relations-grid').innerHTML = data.foreign_keys.length ? data.foreign_keys.map(fk => \`
      <div class="relation"><strong>\${esc(state.table)}.\${esc(fk.columns.join(', '))}</strong><span>→</span><strong>\${esc(fk.references_table)}.\${esc(fk.references_columns.join(', '))}</strong></div>\`).join('') : '<p class="muted">Esta tabela não possui chaves estrangeiras declaradas.</p>';
  }

  async function loadCurrentTab() {
    if (!state.table) return;
    try {
      $('.tabs').classList.remove('hidden');
      document.querySelectorAll('.view').forEach(view => view.classList.add('hidden'));
      $(\`#\${state.tab}-view\`).classList.remove('hidden');
      if (state.tab === 'data') await loadRows();
      if (state.tab === 'structure') await loadStructure();
      if (state.tab === 'relations') await loadRelations();
    } catch (error) { showError(error); }
  }

  function showError(error) { $('#data-grid').innerHTML = \`<p class="error">\${esc(error.message)}</p>\`; }
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
    state.tab = button.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach(item => item.classList.toggle('active', item === button));
    loadCurrentTab();
  }));
  $('#refresh').addEventListener('click', () => loadOverview().then(loadCurrentTab));
  $('#search-button').addEventListener('click', () => { state.q = $('#search').value.trim(); state.offset = 0; loadRows().catch(showError); });
  $('#search').addEventListener('keydown', event => { if (event.key === 'Enter') $('#search-button').click(); });
  $('#prev').addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); loadRows().catch(showError); });
  $('#next').addEventListener('click', () => { if (state.offset + state.limit < state.total) state.offset += state.limit; loadRows().catch(showError); });
  loadOverview();
})();