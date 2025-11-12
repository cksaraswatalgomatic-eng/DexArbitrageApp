/* eslint-disable no-unused-vars */
const tableBody = document.querySelector('#notificationsTable tbody');
const statusEl = document.getElementById('notificationsStatus');
const limitEl = document.getElementById('notificationsLimit');
const refreshBtn = document.getElementById('refreshNotifications');
const selectAllCheckbox = document.getElementById('selectAllNotifications');
const markAsReadBtn = document.getElementById('markAsReadBtn');
const markAsUnreadBtn = document.getElementById('markAsUnreadBtn');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');

function truncate(value, max = 400) {
  if (value == null) return '';
  const str = String(value);
  return str.length > max ? `${str.slice(0, max - 3)}...` : str;
}


function fmtTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function normalizeDetails(details) {
  if (!details) return '';
  if (typeof details === 'string') return details;
  try {
    return Object.entries(details).map(([key, val]) => {
      if (val == null) return `${key}:`;
      if (typeof val === 'object') {
        try {
          return `${key}: ${JSON.stringify(val)}`;
} catch (err) {
          return `${key}: [object]`;
        }
      }
      return `${key}: ${val}`;
    }).join('; ');
  } catch (err) {
    try {
      return JSON.stringify(details);
    } catch {
      return String(details);
    }
  }
}

function applyStatusClass(cell, status) {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'sent' || normalized === 'success') {
    cell.classList.add('text-pos');
  } else if (normalized === 'failed' || normalized === 'error') {
    cell.classList.add('text-neg');
  }
}

async function fetchNotifications(limit) {
  const url = new URL('/notifications/recent', window.location.origin);
  url.searchParams.set('limit', limit);
  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

function clearTable() {
  while (tableBody.firstChild) tableBody.removeChild(tableBody.firstChild);
}

function renderNotifications(items) {
  clearTable();
  if (!items || !items.length) {
    statusEl.textContent = 'No notifications yet.';
    return;
  }
  statusEl.textContent = `Showing ${items.length} notification${items.length === 1 ? '' : 's'}.`;
  for (const item of items) {
    const tr = document.createElement('tr');
    tr.dataset.id = item.id; // Store ID on the row
    if (!item.read) {
      tr.classList.add('notification-unread');
    }

    const checkboxTd = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'notification-checkbox';
    checkbox.dataset.id = item.id;
    checkboxTd.appendChild(checkbox);
    tr.appendChild(checkboxTd);

    const cells = [
      fmtTime(item.createdAt),
      item.rule || '',
      item.channel || '',
      (item.status || '').toUpperCase(),
      truncate(item.title || ''),
      truncate(item.message || ''),
      truncate(normalizeDetails(item.details)),
    ];

    cells.forEach((text, idx) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (idx === 3) applyStatusClass(td, item.status);
      tr.appendChild(td);
    });

    tableBody.appendChild(tr);
  }
  updateActionButtons();
}

function getSelectedNotificationIds() {
  const checkboxes = document.querySelectorAll('.notification-checkbox:checked');
  return Array.from(checkboxes).map(cb => cb.dataset.id);
}

function updateActionButtons() {
  const selectedIds = getSelectedNotificationIds();
  const hasSelection = selectedIds.length > 0;
  markAsReadBtn.disabled = !hasSelection;
  markAsUnreadBtn.disabled = !hasSelection;
  deleteSelectedBtn.disabled = !hasSelection;
}

async function sendNotificationAction(urlPath, ids) {
  if (!ids.length) return;
  try {
    const resp = await fetch(urlPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    loadNotifications(); // Reload notifications after action
  } catch (err) {
    console.error(`Failed to perform action on notifications: ${urlPath}`, err);
    alert(`Error: ${err.message}`);
  }
}

selectAllCheckbox?.addEventListener('change', (e) => {
  const isChecked = e.target.checked;
  document.querySelectorAll('.notification-checkbox').forEach(cb => {
    cb.checked = isChecked;
  });
  updateActionButtons();
});

tableBody?.addEventListener('change', (e) => {
  if (e.target.classList.contains('notification-checkbox')) {
    updateActionButtons();
    const allCheckboxes = document.querySelectorAll('.notification-checkbox');
    const checkedCheckboxes = document.querySelectorAll('.notification-checkbox:checked');
    selectAllCheckbox.checked = allCheckboxes.length > 0 && allCheckboxes.length === checkedCheckboxes.length;
  }
});

markAsReadBtn?.addEventListener('click', () => {
  const selectedIds = getSelectedNotificationIds();
  sendNotificationAction('/notifications/mark-read', selectedIds);
});

markAsUnreadBtn?.addEventListener('click', () => {
  const selectedIds = getSelectedNotificationIds();
  sendNotificationAction('/notifications/mark-unread', selectedIds);
});

deleteSelectedBtn?.addEventListener('click', () => {
  if (confirm('Are you sure you want to delete the selected notifications?')) {
    const selectedIds = getSelectedNotificationIds();
    sendNotificationAction('/notifications/delete', selectedIds);
  }
});

async function loadNotifications() {
  const limit = parseInt(limitEl.value, 10) || 50;
  statusEl.textContent = 'Loading...';
  try {
    const data = await fetchNotifications(limit);
    renderNotifications(data.items || []);
  } catch (err) {
    console.error('Failed to load notifications', err);
    statusEl.textContent = `Error: ${err.message}`;
    clearTable();
  }
}

refreshBtn?.addEventListener('click', () => {
  loadNotifications();
});

limitEl?.addEventListener('change', () => {
  loadNotifications();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    loadNotifications();

    // Dropdown menu logic
    const navDropdownButton = document.getElementById('nav-dropdown-button');
    const navDropdown = document.getElementById('nav-dropdown');

    if (navDropdownButton && navDropdown) {
      navDropdownButton.addEventListener('click', (event) => {
        event.stopPropagation(); // Prevent document click from closing immediately
        navDropdown.classList.toggle('open');
      });

      document.addEventListener('click', (event) => {
        if (!navDropdown.contains(event.target) && !navDropdownButton.contains(event.target)) {
          navDropdown.classList.remove('open');
        }
      });
    }
  });
} else {
  loadNotifications();
}
