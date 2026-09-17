const api = (url, options = {}) => fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options }).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed.'); return data; });
const money = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);
const dollars = (cents) => ((Number(cents) || 0) / 100).toFixed(2);
const cents = (value) => Math.max(0, Math.round((Number(value) || 0) * 100));
let projects = [];
let clients = [];

async function loadSession(requiredRole) {
    const { user } = await api('/api/auth/me');
    if (!user || (requiredRole && user.role !== requiredRole)) { window.location.href = '/basic.html'; return null; }
    document.querySelector('[data-user-name]').textContent = user.name;
    return user;
}

function renderSummary(summary) {
    document.querySelector('[data-paid-total]').textContent = money(summary.paidCents);
    document.querySelector('[data-due-total]').textContent = money(summary.dueCents);
    document.querySelector('[data-cost-total]').textContent = money(summary.costCents);
}

function projectCard(project) {
    return `<article class="project-card" data-project-card data-category="${project.category}" data-search-value="${project.title.toLowerCase()} ${project.service.toLowerCase()}"><span class="eyebrow">${project.service}</span><h2>${project.title}</h2><div class="project-meta">${project.due_date ? `Target date: ${project.due_date}` : 'No target date set'}${project.payment_due_date ? ` · Payment due: ${project.payment_due_date}` : ''}</div><div class="progress-track"><div class="progress-bar" style="width: ${project.progress}%"></div></div><div class="progress-row"><span>${project.progress}% complete</span><span class="status">${project.status}</span></div><div class="project-finance"><span>Paid <strong>${money(project.paid_cents)}</strong></span><span>Due <strong>${money(project.cost_cents - project.paid_cents)}</strong></span></div><div class="update-list" data-updates="${project.id}">Loading updates...</div></article>`;
}

function applyProjectFilter() {
    const category = document.querySelector('[data-project-filter]').value;
    const search = document.querySelector('[data-project-search]').value.toLowerCase().trim();
    document.querySelectorAll('[data-project-card], [data-project-row]').forEach((item) => { item.hidden = (category !== 'all' && item.dataset.category !== category) || (search && !item.dataset.searchValue.includes(search)); });
}

function renderAdminProjects() {
    document.querySelector('[data-admin-projects]').innerHTML = projects.length ? projects.map((project) => `<tr data-project-row data-category="${project.category}" data-search-value="${project.title.toLowerCase()} ${project.client_name.toLowerCase()} ${project.service.toLowerCase()}"><td><strong>${project.title}</strong><br>${project.client_name}</td><td>${project.service}</td><td><label class="money-input">Cost <input type="number" min="0" step="0.01" value="${dollars(project.cost_cents)}" data-cost="${project.id}"></label><label class="money-input">Paid <input type="number" min="0" step="0.01" value="${dollars(project.paid_cents)}" data-paid="${project.id}"></label></td><td><select data-status="${project.id}"><option ${project.status === 'Planning' ? 'selected' : ''}>Planning</option><option ${project.status === 'In progress' ? 'selected' : ''}>In progress</option><option ${project.status === 'Waiting for client' ? 'selected' : ''}>Waiting for client</option><option ${project.status === 'Review' ? 'selected' : ''}>Review</option><option ${project.status === 'Completed' ? 'selected' : ''}>Completed</option></select></td><td><input type="number" min="0" max="100" value="${project.progress}" data-progress="${project.id}"></td><td><textarea rows="2" placeholder="Add an update" data-update="${project.id}"></textarea><button class="save-button" data-save="${project.id}">Save</button> <button class="danger-button" data-delete-project="${project.id}">Delete</button></td></tr>`).join('') : '<tr><td colspan="6">No projects yet.</td></tr>';
    document.querySelectorAll('[data-save]').forEach((button) => button.addEventListener('click', async () => { const id = button.dataset.save; await api(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ status: document.querySelector(`[data-status="${id}"]`).value, progress: document.querySelector(`[data-progress="${id}"]`).value, costCents: cents(document.querySelector(`[data-cost="${id}"]`).value), paidCents: cents(document.querySelector(`[data-paid="${id}"]`).value) }) }); const message = document.querySelector(`[data-update="${id}"]`).value.trim(); if (message) await api(`/api/projects/${id}/updates`, { method: 'POST', body: JSON.stringify({ message }) }); window.location.reload(); }));
    document.querySelectorAll('[data-delete-project]').forEach((button) => button.addEventListener('click', async () => { if (!window.confirm('Delete this project and its updates?')) return; await api(`/api/projects/${button.dataset.deleteProject}`, { method: 'DELETE' }); window.location.reload(); }));
    applyProjectFilter();
}

function renderAdminClients() {
    document.querySelector('[data-admin-clients]').innerHTML = clients.length ? clients.map((client) => `<tr data-client-row data-client-service="${client.service || ''}" data-search-value="${client.name.toLowerCase()} ${client.email.toLowerCase()} ${(client.business_name || '').toLowerCase()}"><td>${client.name}</td><td>${client.email}</td><td>${client.business_name || '-'}</td><td>${client.service || '-'}</td><td><button class="danger-button" data-delete-client="${client.id}">Delete</button></td></tr>`).join('') : '<tr><td colspan="5">No clients yet.</td></tr>';
    document.querySelectorAll('[data-delete-client]').forEach((button) => button.addEventListener('click', async () => { if (!window.confirm('Delete this client and all of their projects?')) return; await api(`/api/admin/clients/${button.dataset.deleteClient}`, { method: 'DELETE' }); window.location.reload(); }));
}

async function loadClientDashboard() {
    try { const user = await loadSession('client'); if (!user) return; const result = await api('/api/projects'); projects = result.projects; renderSummary(result.summary); document.querySelector('[data-project-count]').textContent = projects.length; document.querySelector('[data-projects]').innerHTML = projects.length ? projects.map(projectCard).join('') : '<div class="empty-state">Your first project will appear here after we agree the scope.</div>'; await Promise.all(projects.map(async (project) => { const { updates } = await api(`/api/projects/${project.id}/updates`); const target = document.querySelector(`[data-updates="${project.id}"]`); target.innerHTML = updates.length ? `<strong>Latest updates</strong>${updates.map((update) => `<p><time>${new Date(update.created_at).toLocaleDateString()}</time> ${update.message}</p>`).join('')}` : '<p>No updates yet.</p>'; })); applyProjectFilter(); } catch (error) { document.querySelector('[data-projects]').innerHTML = `<p class="error">${error.message}</p>`; }
}

async function loadAdminDashboard() {
    try { const user = await loadSession('admin'); if (!user) return; const result = await api('/api/projects'); projects = result.projects; const clientResult = await api('/api/admin/clients'); clients = clientResult.clients; renderSummary(result.summary); document.querySelector('[data-client-count]').textContent = clients.length; document.querySelector('[data-project-count]').textContent = projects.length; document.querySelector('[data-client-options]').innerHTML = clients.map((client) => `<option value="${client.id}">${client.name} (${client.email})</option>`).join(''); renderAdminProjects(); renderAdminClients(); } catch (error) { document.querySelector('[data-admin-projects]').innerHTML = `<tr><td colspan="6" class="error">${error.message}</td></tr>`; }
}

document.querySelector('[data-logout]').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); window.location.href = '/basic.html'; });
document.querySelector('[data-project-filter]')?.addEventListener('change', applyProjectFilter);
document.querySelector('[data-project-search]')?.addEventListener('input', applyProjectFilter);
document.querySelector('[data-client-search]')?.addEventListener('input', () => { const search = document.querySelector('[data-client-search]').value.toLowerCase().trim(); const service = document.querySelector('[data-client-service]').value; document.querySelectorAll('[data-client-row]').forEach((row) => { row.hidden = (search && !row.dataset.searchValue.includes(search)) || (service !== 'all' && row.dataset.clientService !== service); }); });
document.querySelector('[data-client-service]')?.addEventListener('change', () => document.querySelector('[data-client-search]').dispatchEvent(new Event('input')));
document.querySelector('[data-create-project]')?.addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); values.costCents = cents(values.costCents); values.paidCents = cents(values.paidCents); await api('/api/projects', { method: 'POST', body: JSON.stringify(values) }); window.location.reload(); });
document.querySelector('[data-create-client]')?.addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; await api('/api/admin/clients', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); window.location.reload(); });
if (document.body.dataset.page === 'client') loadClientDashboard();
if (document.body.dataset.page === 'admin') loadAdminDashboard();
