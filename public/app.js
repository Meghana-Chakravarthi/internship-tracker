const form = document.getElementById('app-form');
const companyInput = document.getElementById('company');
const roleInput = document.getElementById('role');
const list = document.getElementById('app-list');
const countEl = document.getElementById('count');
const emptyMsg = document.getElementById('empty-msg');
const flash = document.getElementById('flash');
const statTotal = document.getElementById('stat-total');
const statApplied = document.getElementById('stat-applied');
const statInterview = document.getElementById('stat-interview');
const statOffer = document.getElementById('stat-offer');
const accountName = document.getElementById('account-name');
const logoutButton = document.getElementById('logout-button');

const STATUSES = ['Applied', 'Interview', 'Offer'];

function showMessage(message, type = 'success') {
  flash.textContent = message;
  flash.className = `flash ${type}`;
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    window.location.assign('/login');
    throw new Error('Your session has expired. Please sign in again.');
  }
  const payload = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error || 'Something went wrong. Please try again.');
  }

  return payload;
}

async function loadApplications() {
  try {
    const apps = await apiRequest('/api/applications');
    render(apps);
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

function render(apps) {
  list.innerHTML = '';
  countEl.textContent = apps.length;
  statTotal.textContent = apps.length;
  statApplied.textContent = apps.filter((app) => app.status === 'Applied').length;
  statInterview.textContent = apps.filter((app) => app.status === 'Interview').length;
  statOffer.textContent = apps.filter((app) => app.status === 'Offer').length;
  emptyMsg.style.display = apps.length === 0 ? 'block' : 'none';

  apps.forEach((app) => {
    const li = document.createElement('li');
    li.className = 'application-item';

    const info = document.createElement('div');
    info.className = 'info';

    const company = document.createElement('strong');
    company.textContent = app.company;

    const role = document.createElement('span');
    role.textContent = app.role;

    const statusBadge = document.createElement('span');
    statusBadge.className = `status-badge ${app.status.toLowerCase()}`;
    statusBadge.textContent = app.status;

    info.appendChild(company);
    info.appendChild(role);

    const actions = document.createElement('div');
    actions.className = 'actions';

    const select = document.createElement('select');
    select.setAttribute('aria-label', `Update status for ${app.company}`);
    STATUSES.forEach((s) => {
      const option = document.createElement('option');
      option.value = s;
      option.textContent = s;
      if (s === app.status) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener('change', async () => {
      try {
        await updateStatus(app.id, select.value);
      } catch (error) {
        showMessage(error.message, 'error');
      }
    });

    const del = document.createElement('button');
    del.className = 'delete-btn';
    del.type = 'button';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      try {
        await deleteApplication(app.id);
      } catch (error) {
        showMessage(error.message, 'error');
      }
    });

    actions.appendChild(statusBadge);
    actions.appendChild(select);
    actions.appendChild(del);
    li.appendChild(info);
    li.appendChild(actions);
    list.appendChild(li);
  });
}

async function addApplication(event) {
  event.preventDefault();
  const company = companyInput.value.trim();
  const role = roleInput.value.trim();

  if (!company || !role) {
    showMessage('Please enter both a company name and a role.', 'error');
    return;
  }

  try {
    await apiRequest('/api/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company, role })
    });

    form.reset();
    showMessage('Application added successfully.', 'success');
    loadApplications();
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function updateStatus(id, status) {
  const app = await apiRequest('/api/applications/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });

  showMessage(`${app.company} status updated to ${app.status}.`, 'success');
  loadApplications();
}

async function deleteApplication(id) {
  await apiRequest('/api/applications/' + id, { method: 'DELETE' });
  showMessage('Application deleted successfully.', 'success');
  loadApplications();
}

form.addEventListener('submit', addApplication);
logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    window.location.assign('/login');
  } catch (error) {
    showMessage(error.message, 'error');
    logoutButton.disabled = false;
  }
});

async function initialize() {
  try {
    const { user } = await apiRequest('/api/auth/me');
    accountName.textContent = user.username;
    await loadApplications();
  } catch (error) {
    if (error.message !== 'Your session has expired. Please sign in again.') {
      showMessage(error.message, 'error');
    }
  }
}

initialize();
