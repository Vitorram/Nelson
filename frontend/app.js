const localHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const apiBase = window.API_BASE_URL || (localHost ? `${window.location.protocol}//${window.location.hostname}:8000/api/v1` : `${window.location.origin}/api/v1`);
const state = { csrf: '', user: null, products: [], adminProducts: [], cart: [], cards: [], photos: [] };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

function flash(message, ok = false) {
  const el = $('#message'); el.textContent = message; el.classList.toggle('hidden', !message); el.classList.toggle('ok', ok);
  if (message) setTimeout(() => el.classList.add('hidden'), 6000);
}
function modal(id, visible = true) { $(`#${id}`).classList.toggle('hidden', !visible); }
function formValues(form) { return Object.fromEntries(new FormData(form).entries()); }

async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  if (isWrite && path !== '/csrf' && !state.csrf) await refreshCsrf();
  let response;
  try {
    response = await fetch(`${apiBase}${path}`, { credentials: 'include', ...options, headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.method && options.method !== 'GET' && state.csrf ? { 'X-CSRF-Token': state.csrf } : {}), ...(options.headers || {}),
    } });
  } catch { throw new Error(`Sem conexão com a API em ${apiBase}. Inicie o FastAPI e confira a configuração do frontend.`); }
  const payload = await response.json().catch(() => ({}));
  const detail = Array.isArray(payload.detail) ? payload.detail.map((item) => item.msg).join(', ') : payload.detail;
  if (response.status === 403 && detail === 'Token CSRF inválido' && !options.__csrfRetried) {
    await refreshCsrf();
    return api(path, { ...options, __csrfRetried: true });
  }
  if (!response.ok) {
    throw new Error(detail || `Erro ${response.status} na API.`);
  }
  return payload;
}
async function refreshCsrf() { state.csrf = (await api('/csrf')).csrf_token; }

function accountUi() {
  const isAdmin = state.user?.role === 'admin';
  $('#account-nav').textContent = state.user ? `CONTA / ${state.user.name.split(' ')[0].toUpperCase()}` : 'ENTRAR';
  $('#orders-nav').classList.toggle('hidden', !state.user);
  $('#admin-nav').classList.toggle('hidden', !isAdmin);
  if (!isAdmin) $('#admin-panel').classList.add('hidden');
}
async function loadCards() {
  if (!state.user) return;
  state.cards = (await api('/demo-cards')).cards;
  renderCards();
}
function renderCards() {
  const target = $('#saved-cards');
  target.innerHTML = state.cards.length ? state.cards.map((card) => `<article class="saved-card"><span class="card-chip">▰</span><div><strong>${esc(card.label)}</strong><span>${esc(card.brand.toUpperCase())} ···· ${esc(card.last4)}</span></div><button type="button" data-remove-card="${card.id}" aria-label="Remover cartão demo">×</button></article>`).join('') : '<p class="muted empty-small">Nenhum cartão de demonstração cadastrado.</p>';
  $('#checkout-card').innerHTML = state.cards.map((card) => `<option value="${card.id}">${esc(card.label)} — ${esc(card.brand.toUpperCase())} ···· ${esc(card.last4)}</option>`).join('');
  $('#checkout-card').disabled = !state.cards.length;
}
async function setUser(user, csrfToken = '') {
  state.user = user; accountUi(); modal('auth-dialog', false);
  if (csrfToken) state.csrf = csrfToken;
  if (!state.csrf) await refreshCsrf();
  try {
    if (user.role === 'admin') { $('#admin-panel').classList.remove('hidden'); await loadAdminProducts(); }
    else await loadCards();
    return '';
  } catch (error) {
    return error.message;
  }
}

function categoryOptions() {
  const select = $('#category-filter'); const selected = select.value;
  const cats = [...new Set(state.products.filter((p) => p.active).map((p) => p.category))].sort();
  select.innerHTML = '<option value="">Todas as categorias</option>' + cats.map((cat) => `<option value="${esc(cat)}">${esc(cat)}</option>`).join('');
  select.value = cats.includes(selected) ? selected : '';
}
function shoeCard(product) {
  const sizes = product.sizes.filter((size) => size.stock > 0);
  const image = product.image_url ? `<img src="${esc(product.image_url)}" alt="${esc(product.name)}" loading="lazy" referrerpolicy="no-referrer">` : '<div class="product-placeholder" aria-hidden="true"><span>PC</span><b>RUN / FORM</b></div>';
  const credit = product.photo_credit && product.photo_url ? `<a class="photo-credit" href="${esc(product.photo_url)}" target="_blank" rel="noopener noreferrer">Foto: ${esc(product.photo_credit)} / Unsplash</a>` : '';
  return `<article class="product-card"><div class="product-image">${image}<span class="product-index">PC-${String(product.id).padStart(3, '0')}</span>${credit}</div><div class="product-details"><p class="product-category">${esc(product.brand)} / ${esc(product.category)}</p><h3>${esc(product.name)}</h3><div class="product-bottom"><strong>${money(product.price)}</strong><div class="product-actions"><select aria-label="Tamanho ${esc(product.name)}" data-size-for="${product.id}" ${sizes.length ? '' : 'disabled'}>${sizes.length ? sizes.map((size) => `<option value="${size.size}">${size.size}</option>`).join('') : '<option>ESGOTADO</option>'}</select><button type="button" data-add="${product.id}" ${sizes.length ? '' : 'disabled'} aria-label="Adicionar à sacola">+</button></div></div></div></article>`;
}
function renderProducts() {
  const query = $('#search').value.trim().toLocaleLowerCase('pt-BR'); const category = $('#category-filter').value;
  const products = state.products.filter((p) => p.active && (!category || p.category === category) && `${p.name} ${p.brand} ${p.category}`.toLocaleLowerCase('pt-BR').includes(query));
  $('#products').innerHTML = products.length ? products.map(shoeCard).join('') : '<div class="empty-state"><span>01—</span><h3>Nenhum par por aqui.</h3><p>Limpe a busca ou confira a coleção em breve.</p></div>';
  categoryOptions();
}
async function loadProducts() { state.products = (await api('/products')).products; renderProducts(); }
function cartCount() { return state.cart.reduce((sum, line) => sum + line.quantity, 0); }
function renderCart() {
  $('#cart-count').textContent = cartCount();
  if (!state.cart.length) { $('#cart-lines').innerHTML = '<div class="empty-state cart-empty"><span>—</span><h3>A sacola está vazia.</h3><p>Encontre seu próximo par na coleção.</p></div>'; $('#cart-total').textContent = money(0); $('#checkout-button').classList.add('hidden'); $('#checkout').classList.add('hidden'); return; }
  $('#cart-lines').innerHTML = state.cart.map((line, index) => `<article class="cart-line"><div class="cart-line-image">${line.image ? `<img src="${esc(line.image)}" alt="">` : 'PC'}</div><div class="cart-line-info"><strong>${esc(line.name)}</strong><span>Tamanho ${line.size} / ${money(line.price)}</span><div class="quantity-control"><button type="button" data-qty="${index}" data-delta="-1">−</button><span>${line.quantity}</span><button type="button" data-qty="${index}" data-delta="1">+</button><button type="button" class="remove-line" data-remove="${index}">REMOVER</button></div></div><b>${money(line.price * line.quantity)}</b></article>`).join('');
  $('#cart-total').textContent = money(state.cart.reduce((sum, line) => sum + line.price * line.quantity, 0)); $('#checkout-button').classList.remove('hidden');
}
const statusName = (value) => ({ awaiting_payment: 'PAGAMENTO PENDENTE', paid: 'PAGO / DEMO', processing: 'EM SEPARAÇÃO', shipped: 'ENVIADO', delivered: 'ENTREGUE', cancelled: 'CANCELADO' })[value] || value.toUpperCase();
function orderCard(order) { return `<article class="order-card"><div class="order-row"><div><span class="order-number">PC / #${order.id}</span><time>${new Date(order.created_at).toLocaleDateString('pt-BR')}</time></div><span class="order-status">${statusName(order.status)}</span></div><div class="order-products">${order.items.map((item) => `<p>${item.quantity}× ${esc(item.name)} <small>SIZE ${item.size}</small></p>`).join('')}</div><div class="order-row order-foot"><strong>${money(order.total)}</strong>${order.tracking_code ? `<span>TRACKING / ${esc(order.tracking_code)}</span>` : ''}</div></article>`; }
async function loadOrders() { const orders = (await api('/orders')).orders; $('#orders').innerHTML = orders.length ? orders.map(orderCard).join('') : '<p class="muted">Nenhuma compra registrada.</p>'; }

function openAuth(tab = 'login') { if (state.user) return; document.querySelector(`[data-auth-tab="${tab}"]`).click(); modal('auth-dialog'); }
$('#account-nav').addEventListener('click', async () => {
  if (!state.user) return openAuth();
  $('#profile-name').textContent = state.user.name; $('#profile-email').textContent = state.user.email;
  try { if (state.user.role !== 'admin') await loadCards(); modal('profile-dialog'); } catch (error) { flash(error.message); }
});
$('#logout-button').addEventListener('click', async () => { try { await api('/auth/logout', { method: 'POST', body: '{}' }); state.user = null; state.cards = []; accountUi(); modal('profile-dialog', false); $('#orders-panel').classList.add('hidden'); flash('Você saiu da conta.', true); await refreshCsrf(); } catch (error) { flash(error.message); } });
$('#cart-nav').addEventListener('click', () => { renderCart(); modal('cart-dialog'); });
$('#orders-nav').addEventListener('click', async () => { try { await loadOrders(); $('#orders-panel').classList.remove('hidden'); $('#orders-panel').scrollIntoView({ behavior: 'smooth' }); } catch (error) { flash(error.message); } });
$('#admin-nav').addEventListener('click', async () => { $('#admin-panel').classList.remove('hidden'); $('#admin-panel').scrollIntoView({ behavior: 'smooth' }); await loadAdminProducts(); });
$$('[data-close]').forEach((button) => button.addEventListener('click', () => modal(button.dataset.close, false)));
$$('.modal').forEach((el) => el.addEventListener('click', (event) => { if (event.target === el) modal(el.id, false); }));
$$('[data-auth-tab]').forEach((button) => button.addEventListener('click', () => {
  const register = button.dataset.authTab === 'register'; $$('[data-auth-tab]').forEach((tab) => tab.classList.toggle('active', tab === button));
  $('#login-form').classList.toggle('hidden', register); $('#register-form').classList.toggle('hidden', !register); $('#auth-title').textContent = register ? 'Crie seu acesso.' : 'Acesse sua conta.';
}));
$('#login-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('[type="submit"]'); button.disabled = true; try { const result = await api('/auth/login', { method: 'POST', body: JSON.stringify(formValues(form)) }); form.reset(); const warning = await setUser(result.user, result.csrf_token); flash(warning ? `Login realizado, mas houve erro ao carregar os dados da conta: ${warning}` : 'Sessão iniciada.', !warning); } catch (error) { flash(error.message); } finally { button.disabled = false; } });
$('#register-form').addEventListener('submit', async (event) => { event.preventDefault(); try { await api('/auth/register', { method: 'POST', body: JSON.stringify(formValues(event.currentTarget)) }); event.currentTarget.reset(); $('[data-auth-tab="login"]').click(); flash('Conta criada. Faça login para continuar.', true); } catch (error) { flash(error.message); } });

$('#products').addEventListener('click', (event) => {
  const button = event.target.closest('[data-add]'); if (!button) return;
  const product = state.products.find((p) => p.id === Number(button.dataset.add)); const size = Number(document.querySelector(`[data-size-for="${product.id}"]`).value);
  const stock = product.sizes.find((s) => s.size === size)?.stock || 0; const existing = state.cart.find((line) => line.productId === product.id && line.size === size);
  if (existing && existing.quantity >= stock) return flash('Estoque insuficiente para esse tamanho.');
  if (existing) existing.quantity += 1; else state.cart.push({ productId: product.id, name: product.name, image: product.image_url, size, price: Number(product.price), quantity: 1, stock });
  renderCart(); flash('Adicionado à sacola.', true);
});
$('#cart-lines').addEventListener('click', (event) => {
  const remove = event.target.closest('[data-remove]'); if (remove) state.cart.splice(Number(remove.dataset.remove), 1);
  const qty = event.target.closest('[data-qty]');
  if (qty) { const i = Number(qty.dataset.qty); state.cart[i].quantity += Number(qty.dataset.delta); if (state.cart[i].quantity < 1) state.cart.splice(i, 1); else if (state.cart[i].quantity > state.cart[i].stock) state.cart[i].quantity = state.cart[i].stock; }
  renderCart();
});
$('#checkout-button').addEventListener('click', async () => {
  if (!state.user) { modal('cart-dialog', false); return openAuth(); }
  try { await loadCards(); if (!state.cards.length) { modal('cart-dialog', false); $('#profile-name').textContent = state.user.name; $('#profile-email').textContent = state.user.email; modal('profile-dialog'); flash('Cadastre um cartão demo na sua conta antes do checkout.'); return; }
    $('#checkout').classList.remove('hidden'); $('#checkout-button').classList.add('hidden');
  } catch (error) { flash(error.message); }
});
$('#checkout-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget;
  try {
    const fields = formValues(form); const cardId = Number(fields.card_id); delete fields.card_id;
    const address = await api('/addresses', { method: 'POST', body: JSON.stringify(fields) });
    const created = await api('/orders', { method: 'POST', body: JSON.stringify({ address_id: address.address.id, items: state.cart.map((line) => ({ product_id: line.productId, size: line.size, quantity: line.quantity })) }) });
    const paid = await api(`/orders/${created.order.id}/demo-payment`, { method: 'POST', body: JSON.stringify({ card_id: cardId }) });
    state.cart = []; renderCart(); form.reset(); modal('cart-dialog', false); await loadProducts(); await loadOrders(); $('#orders-panel').classList.remove('hidden'); $('#orders-panel').scrollIntoView({ behavior: 'smooth' });
    flash(`Pedido #${paid.order.id} aprovado em modo de demonstração. Nenhuma cobrança real foi feita.`, true);
  } catch (error) { flash(error.message); }
});
$('#demo-card-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; const values = formValues(form); try { await api('/demo-cards', { method: 'POST', body: JSON.stringify({ label: values.label, brand: values.brand }) }); form.reset(); await loadCards(); flash('Cartão demo adicionado. Os dados digitados foram descartados e não foram enviados ao servidor.', true); } catch (error) { flash(error.message); } });
$('#saved-cards').addEventListener('click', async (event) => { const button = event.target.closest('[data-remove-card]'); if (!button) return; try { await api(`/demo-cards/${button.dataset.removeCard}`, { method: 'DELETE' }); await loadCards(); } catch (error) { flash(error.message); } });
$('#search').addEventListener('input', renderProducts); $('#category-filter').addEventListener('change', renderProducts);

function sizesObject(value) { const pairs = value.split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => entry.split(':').map((part) => Number(part.trim()))); if (!pairs.length || pairs.some(([size, qty]) => !Number.isInteger(size) || !Number.isInteger(qty))) throw new Error('Estoque inválido. Use tamanho:quantidade.'); return Object.fromEntries(pairs); }
function clearProductForm() { $('#product-form').reset(); $('[name="product_id"]').value = ''; $('#product-form-title').textContent = 'Novo produto'; $('#cancel-edit').classList.add('hidden'); $('#product-form button[type="submit"]').textContent = 'SALVAR PRODUTO'; }
function fillProductForm(product) { const form = $('#product-form'); form.elements.product_id.value = product.id; form.elements.name.value = product.name; form.elements.brand.value = product.brand; form.elements.category.value = product.category; form.elements.price.value = product.price; form.elements.description.value = product.description; form.elements.sizes.value = product.sizes.map((size) => `${size.size}:${size.stock}`).join(', '); form.elements.image_url.value = product.image_url || ''; form.elements.photo_credit.value = product.photo_credit || ''; form.elements.photo_url.value = product.photo_url || ''; $('#product-form-title').textContent = `Editar / ${product.name}`; $('#cancel-edit').classList.remove('hidden'); $('#product-form button[type="submit"]').textContent = 'ATUALIZAR PRODUTO'; form.scrollIntoView({ behavior: 'smooth' }); }
$('#cancel-edit').addEventListener('click', clearProductForm);
$('#product-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; const fields = formValues(form); const id = fields.product_id; try {
  const payload = { name: fields.name, brand: fields.brand, category: fields.category, price: fields.price, description: fields.description, sizes: sizesObject(fields.sizes), image_url: fields.image_url, photo_credit: fields.photo_credit, photo_url: fields.photo_url };
  await api(id ? `/admin/products/${id}` : '/products', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) }); clearProductForm(); await Promise.all([loadProducts(), loadAdminProducts()]); flash(id ? 'Produto atualizado.' : 'Produto cadastrado.', true);
} catch (error) { flash(error.message); } });
$('#photo-search-button').addEventListener('click', async (event) => { const button = event.currentTarget; button.disabled = true; try { const photos = (await api(`/admin/images/search?q=${encodeURIComponent($('#photo-query').value.trim() || 'sneaker shoe')}`)).photos; state.photos = photos; $('#photo-results').innerHTML = photos.map((photo, index) => `<button type="button" class="photo-option" data-photo="${index}" title="Selecionar foto por ${esc(photo.photographer)}"><img src="${esc(photo.thumb_url)}" alt="${esc(photo.alt)}" loading="lazy"><span>${esc(photo.photographer)}</span></button>`).join('') || '<p class="muted">Nenhuma foto encontrada.</p>'; } catch (error) { flash(error.message); } finally { button.disabled = false; } });
$('#photo-results').addEventListener('click', (event) => { const button = event.target.closest('[data-photo]'); if (!button) return; const photo = state.photos[Number(button.dataset.photo)]; const form = $('#product-form'); form.elements.image_url.value = photo.image_url; form.elements.photo_credit.value = photo.photographer; form.elements.photo_url.value = photo.photo_url; $$('.photo-option').forEach((item) => item.classList.toggle('selected', item === button)); });

async function loadAdminProducts() { const result = await api('/admin/products'); state.adminProducts = result.products; const target = $('#admin-product-list'); target.innerHTML = result.products.length ? `<table><thead><tr><th>Produto</th><th>Preço</th><th>Estoque</th><th>Status</th><th></th></tr></thead><tbody>${result.products.map((product) => `<tr><td>${esc(product.name)}</td><td>${money(product.price)}</td><td>${product.sizes.reduce((sum, size) => sum + size.stock, 0)} pares</td><td>${product.active ? 'ATIVO' : 'ARQUIVADO'}</td><td class="table-actions"><button type="button" data-edit-product="${product.id}">EDITAR</button>${product.active ? `<button type="button" data-delete-product="${product.id}">ARQUIVAR</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nenhum produto cadastrado.</p>'; }
$('#admin-product-list').addEventListener('click', async (event) => { const edit = event.target.closest('[data-edit-product]'); const remove = event.target.closest('[data-delete-product]'); try { if (edit) fillProductForm(state.adminProducts.find((product) => product.id === Number(edit.dataset.editProduct))); if (remove && confirm('Arquivar este produto? Ele deixa de aparecer na loja e os pedidos antigos serão preservados.')) { await api(`/admin/products/${remove.dataset.deleteProduct}`, { method: 'DELETE' }); await Promise.all([loadProducts(), loadAdminProducts()]); flash('Produto arquivado.', true); } } catch (error) { flash(error.message); } });

async function loadAdminUsers() { const users = (await api('/admin/users')).users; $('#admin-user-list').innerHTML = users.length ? `<table><thead><tr><th>Conta</th><th>Compras</th><th>Criada em</th><th>Status</th><th></th></tr></thead><tbody>${users.map((user) => `<tr><td><strong>${esc(user.name)}</strong><small>${esc(user.email)}${user.role === 'admin' ? ' · ADMIN' : ''}</small></td><td>${user.orders_count}</td><td>${new Date(user.created_at).toLocaleDateString('pt-BR')}</td><td>${user.active ? 'ATIVA' : 'PAUSADA'}</td><td>${user.id === state.user.id ? '' : `<button type="button" data-user-active="${user.id}" data-active="${!user.active}">${user.active ? 'PAUSAR' : 'REATIVAR'}</button>`}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nenhuma conta cadastrada.</p>'; }
async function loadAdminOrders() { const orders = (await api('/admin/orders')).orders; $('#admin-order-list').innerHTML = orders.length ? orders.map((order) => `<article class="admin-order"><div class="admin-order-head"><div><p class="kicker">PEDIDO / #${order.id}</p><h3>${esc(order.customer.name)} <small>${esc(order.customer.email)}</small></h3></div><span class="order-status">${statusName(order.status)}</span></div><div class="admin-order-grid"><div><strong>ITENS</strong>${order.items.map((item) => `<p>${item.quantity}× ${esc(item.name)} / ${item.size}</p>`).join('')}<b>${money(order.total)}</b></div><div><strong>ENTREGA</strong><p>${esc(order.shipping_address.recipient)} · ${esc(order.shipping_address.phone)}</p><p>${esc(order.shipping_address.street)}, ${esc(order.shipping_address.number)} · ${esc(order.shipping_address.city)} / ${esc(order.shipping_address.state)} · ${esc(order.shipping_address.postal_code)}</p>${order.tracking_code ? `<p>Rastreio: ${esc(order.tracking_code)}</p>` : ''}</div></div><div class="admin-order-actions">${order.status === 'paid' ? `<button class="outline-button" data-status-order="${order.id}" data-status="processing">MARCAR EM SEPARAÇÃO</button>` : ''}${['paid', 'processing'].includes(order.status) ? `<button class="outline-button" data-ship-order="${order.id}">GERAR RASTREIO E MARCAR ENVIADO</button>` : ''}${order.status === 'shipped' ? `<button class="outline-button" data-status-order="${order.id}" data-status="delivered">MARCAR ENTREGUE</button>` : ''}</div></article>`).join('') : '<p class="muted">Nenhuma compra registrada.</p>'; }
$$('[data-admin-tab]').forEach((button) => button.addEventListener('click', async () => { const key = button.dataset.adminTab; $$('.admin-tab').forEach((tab) => tab.classList.toggle('active', tab === button)); $$('.admin-view').forEach((section) => section.classList.toggle('hidden', section.id !== `admin-${key}`)); try { if (key === 'orders') await loadAdminOrders(); if (key === 'users') await loadAdminUsers(); if (key === 'products') await loadAdminProducts(); } catch (error) { flash(error.message); } }));
$('#admin-order-list').addEventListener('click', async (event) => {
  const status = event.target.closest('[data-status-order]');
  const ship = event.target.closest('[data-ship-order]');
  try {
    if (status) await api(`/admin/orders/${status.dataset.statusOrder}/status`, { method: 'PATCH', body: JSON.stringify({ status: status.dataset.status }) });
    if (ship) await api(`/admin/orders/${ship.dataset.shipOrder}/shipping`, { method: 'PATCH', body: JSON.stringify({}) });
    await loadAdminOrders();
    flash(ship ? 'Rastreio gerado e pedido marcado como enviado.' : 'Pedido atualizado.', true);
  } catch (error) { flash(error.message); }
});
$('#admin-user-list').addEventListener('click', async (event) => { const button = event.target.closest('[data-user-active]'); if (!button) return; try { await api(`/admin/users/${button.dataset.userActive}/status`, { method: 'PATCH', body: JSON.stringify({ active: button.dataset.active === 'true' }) }); await loadAdminUsers(); flash('Conta atualizada.', true); } catch (error) { flash(error.message); } });

async function boot() {
  try { await refreshCsrf(); try { const { user } = await api('/auth/me'); const warning = await setUser(user); if (warning) flash(`Conta conectada; erro ao carregar os dados: ${warning}`); } catch { /* Visitantes podem navegar pelo catálogo sem login. */ }
    await loadProducts(); accountUi();
  } catch (error) { $('#products').innerHTML = `<div class="empty-state"><h3>Catálogo indisponível.</h3><p>${esc(error.message)}</p></div>`; }
  renderCart();
}
boot();
