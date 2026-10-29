
const $ = (id) => document.getElementById(id);

const dateToday = new Date();
const localToday = `${dateToday.getFullYear()}-${String(dateToday.getMonth() + 1).padStart(2, '0')}-${String(dateToday.getDate()).padStart(2, '0')}`;

let selectedRole = 'student';
let currentUser = null;
let currentBookings = [];

function showMessage(text, type = '') {
  const el = $('message');
  if (!el) return;
  el.textContent = text;
  el.className = `message ${type}`.trim();
}

function showAuthMessage(text, type = '') {
  $('authMessage').textContent = text;
  $('authMessage').className = `message ${type}`.trim();
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const details = Array.isArray(data.details)
      ? ` ${data.details.join(' ')}`
      : '';

    throw new Error(
      (data.error || `Request failed (${response.status}).`) + details
    );
  }

  return data;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function displayDate(date) {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function setRole(role) {
  selectedRole = role;

  document.querySelectorAll('.role-choice').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.role === role);
  });
}

document.querySelectorAll('.role-choice').forEach(btn => {
  btn.addEventListener('click', () => setRole(btn.dataset.role));
});

$('togglePassword').addEventListener('click', () => {
  const input = $('loginPassword');

  input.type = input.type === 'password' ? 'text' : 'password';
  $('togglePassword').textContent =
    input.type === 'password' ? '◉' : '◎';
});

function showDashboard(user) {
  currentUser = user;

  $('authView').classList.add('hidden');
  $('appView').classList.remove('hidden');

  $('currentUserName').textContent = user.display_name;
  $('currentUserRole').textContent =
    user.role[0].toUpperCase() + user.role.slice(1);

  $('principalBookingPanel').classList.toggle(
    'hidden', user.role !== 'principal'
  );
  $('requestsPanel').classList.toggle(
    'hidden', user.role !== 'principal'
  );
  $('usersPanel').classList.toggle(
    'hidden', user.role !== 'principal'
  );
  $('requestPanel').classList.toggle(
    'hidden', user.role !== 'faculty'
  );

  $('availabilityDate').value = localToday;
  $('requestDate').value = localToday;
  $('eventDate').value = localToday;

  loadBookings();

  if (user.role === 'principal') {
    loadAllRequests();
    loadUsers();
  }

  if (user.role === 'faculty') {
    loadMyRequests();
  }
}

function showLogin() {
  currentUser = null;
  $('appView').classList.add('hidden');
  $('authView').classList.remove('hidden');
  $('loginPassword').value = '';
}

async function checkInitialSetup() {
  try {
    const status = await api('/api/setup-status');

    if (status.needsSetup) {
      $('authTitle').textContent = 'Create principal account';
      $('authSubtitle').textContent =
        'Complete one-time setup to secure your campus workspace.';

      $('roleChoices').classList.add('hidden');
      $('loginForm').classList.add('hidden');
      $('setupFormWrap').classList.remove('hidden');
      document.querySelector('.new-user').classList.add('hidden');
    }
  } catch (_) {
    showAuthMessage(
      'Could not connect to the application server. Refresh the page or restart the server.',
      'error'
    );
  }
}

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  showAuthMessage('Signing in…');

  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('loginUsername').value.trim(),
        password: $('loginPassword').value,
        role: selectedRole
      })
    });

    showAuthMessage('');
    showDashboard(data.user);
  } catch (error) {
    showAuthMessage(error.message, 'error');
  }
});

$('setupForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  showAuthMessage('Creating the principal account…');

  try {
    const data = await api('/api/setup', {
      method: 'POST',
      body: JSON.stringify({
        setup_key: $('setupKey').value,
        display_name: $('setupDisplayName').value.trim(),
        username: $('setupUsername').value.trim(),
        password: $('setupPassword').value,
        role: 'principal'
      })
    });

    $('setupFormWrap').classList.add('hidden');
    $('roleChoices').classList.remove('hidden');
    $('loginForm').classList.remove('hidden');
    document.querySelector('.new-user').classList.remove('hidden');

    showAuthMessage(data.message, 'success');
    showDashboard(data.user);
  } catch (error) {
    showAuthMessage(error.message, 'error');
  }
});

$('logoutButton').addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch (_) {}

  showLogin();
  checkInitialSetup();
});

async function loadBookings() {
  const params = new URLSearchParams();

  if ($('filterDate').value) {
    params.set('date', $('filterDate').value);
  }

  if ($('filterDepartment').value.trim()) {
    params.set('department', $('filterDepartment').value.trim());
  }

  try {
    const data = await api(`/api/bookings?${params}`);

    currentBookings = data.bookings;
    renderBookings(currentBookings);

    showMessage(
      `${currentBookings.length} approved booking${currentBookings.length === 1 ? '' : 's'} shown.`,
      'success'
    );
  } catch (error) {
    $('bookings').innerHTML =
      '<div class="empty-state">Could not load bookings. Please refresh.</div>';

    showMessage(error.message, 'error');
  }
}

function renderBookings(bookings) {
  const root = $('bookings');

  if (!bookings.length) {
    root.innerHTML =
      '<div class="empty-state">No approved bookings match these filters. This does not replace confirmation from authorized staff.</div>';
    return;
  }

  root.innerHTML = bookings.map(b => `
    <article class="booking-card">
      <div class="booking-stripe"></div>
      <div>
        <h3>${escapeHtml(b.event_name)}</h3>
        <div class="booking-meta">
          <strong>${escapeHtml(b.department)}</strong><br>
          ${escapeHtml(displayDate(b.event_date))}<br>
          Coordinator: ${escapeHtml(b.contact_person)}
          ${b.notes ? `<br>Notes: ${escapeHtml(b.notes)}` : ''}
        </div>

        ${currentUser?.role === 'principal' ? `
          <div class="card-actions">
            <button class="mini-button" data-edit="${b.id}" type="button">
              Edit
            </button>
            <button class="mini-button danger" data-cancel="${b.id}" type="button">
              Cancel booking
            </button>
          </div>
        ` : ''}
      </div>

      <div class="booking-time">
        ${escapeHtml(b.start_time)}–${escapeHtml(b.end_time)}
      </div>
    </article>
  `).join('');

  root.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => editBooking(Number(btn.dataset.edit)));
  });

  root.querySelectorAll('[data-cancel]').forEach(btn => {
    btn.addEventListener('click', () => cancelBooking(Number(btn.dataset.cancel)));
  });
}

$('refreshButton').addEventListener('click', loadBookings);
$('applyFilters').addEventListener('click', loadBookings);

$('clearFilters').addEventListener('click', () => {
  $('filterDate').value = '';
  $('filterDepartment').value = '';
  loadBookings();
});

$('availabilityForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const result = $('availabilityResult');
  result.className = 'availability-result';
  result.textContent = 'Checking recorded bookings…';

  const params = new URLSearchParams({
    date: $('availabilityDate').value,
    start_time: $('availabilityStart').value,
    end_time: $('availabilityEnd').value
  });

  try {
    const data = await api(`/api/availability?${params}`);

    result.className =
      `availability-result ${data.available ? 'good' : 'bad'}`;

    result.textContent =
      `${data.available ? 'No conflict found. ' : 'Conflict found. '}${data.message}`;
  } catch (error) {
    result.className = 'availability-result warning';
    result.textContent = error.message;
  }
});

function formPayload(prefix = '') {
  return {
    event_name: $(`${prefix}eventName`).value.trim(),
    department: $(`${prefix}department`).value.trim(),
    event_date: $(`${prefix}Date`).value,
    start_time: $(`${prefix}Start`).value,
    end_time: $(`${prefix}End`).value,
    contact_person: $(`${prefix}Contact`).value.trim(),
    notes: $(`${prefix}Notes`).value.trim()
  };
}

function bookingPayload() {
  return {
    event_name: $('eventName').value.trim(),
    department: $('department').value.trim(),
    event_date: $('eventDate').value,
    start_time: $('startTime').value,
    end_time: $('endTime').value,
    contact_person: $('contactPerson').value.trim(),
    notes: $('notes').value.trim()
  };
}

function resetBookingForm() {
  $('bookingForm').reset();
  $('bookingId').value = '';
  $('eventDate').value = localToday;
  $('saveBooking').textContent = 'Add approved booking';
  $('cancelEdit').classList.add('hidden');
}

$('bookingForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const id = $('bookingId').value;

  try {
    const data = await api(
      id ? `/api/bookings/${id}` : '/api/bookings',
      {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(bookingPayload())
      }
    );

    showMessage(data.message, 'success');
    resetBookingForm();
    await loadBookings();
  } catch (error) {
    showMessage(error.message, 'error');
  }
});

function editBooking(id) {
  const b = currentBookings.find(item => item.id === id);
  if (!b) return;

  $('bookingId').value = b.id;
  $('eventName').value = b.event_name;
  $('department').value = b.department;
  $('eventDate').value = b.event_date;
  $('startTime').value = b.start_time;
  $('endTime').value = b.end_time;
  $('contactPerson').value = b.contact_person;
  $('notes').value = b.notes || '';

  $('saveBooking').textContent = 'Save changes';
  $('cancelEdit').classList.remove('hidden');

  $('bookingForm').scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

async function cancelBooking(id) {
  if (!confirm(
    'Cancel this approved booking? It will no longer appear in the public schedule.'
  )) {
    return;
  }

  try {
    const data = await api(`/api/bookings/${id}`, {
      method: 'DELETE'
    });

    showMessage(data.message, 'success');
    await loadBookings();
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

$('cancelEdit').addEventListener('click', resetBookingForm);

$('requestForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const data = await api('/api/booking-requests', {
      method: 'POST',
      body: JSON.stringify({
        event_name: $('requestEventName').value.trim(),
        department: $('requestDepartment').value.trim(),
        event_date: $('requestDate').value,
        start_time: $('requestStart').value,
        end_time: $('requestEnd').value,
        contact_person: $('requestContact').value.trim(),
        notes: $('requestNotes').value.trim()
      })
    });

    $('requestMessage').textContent = data.message;
    $('requestMessage').className = 'message success';

    $('requestForm').reset();
    $('requestDate').value = localToday;

    loadMyRequests();
  } catch (error) {
    $('requestMessage').textContent = error.message;
    $('requestMessage').className = 'message error';
  }
});

function requestCard(r, isPrincipal = false) {
  return `
    <article class="request-card">
      <div class="request-card-top">
        <strong>${escapeHtml(r.event_name)}</strong>
        <span class="status-tag ${String(r.status).toLowerCase()}">
          ${escapeHtml(r.status)}
        </span>
      </div>

      <p>
        ${escapeHtml(r.department)} ·
        ${escapeHtml(displayDate(r.event_date))} ·
        ${escapeHtml(r.start_time)}–${escapeHtml(r.end_time)}
      </p>

      <p class="muted">
        ${isPrincipal
          ? `Requested by ${escapeHtml(r.requester_name)} (${escapeHtml(r.requester_username)})`
          : `Contact: ${escapeHtml(r.contact_person)}`}
      </p>

      ${r.notes ? `<p>${escapeHtml(r.notes)}</p>` : ''}

      ${isPrincipal && r.status === 'PENDING' ? `
        <div class="card-actions">
          <button class="mini-button approve" data-approve="${r.id}" type="button">
            Approve
          </button>
          <button class="mini-button danger" data-reject="${r.id}" type="button">
            Reject
          </button>
        </div>
      ` : ''}

      ${r.decision_note
        ? `<small>Decision note: ${escapeHtml(r.decision_note)}</small>`
        : ''}
    </article>
  `;
}

async function loadMyRequests() {
  try {
    const data = await api('/api/booking-requests');

    $('myRequests').innerHTML = data.requests.length
      ? data.requests.map(r => requestCard(r)).join('')
      : '<div class="empty-state">No requests submitted yet.</div>';
  } catch (error) {
    $('myRequests').textContent = error.message;
  }
}

async function loadAllRequests() {
  try {
    const data = await api('/api/booking-requests');

    $('allRequests').innerHTML = data.requests.length
      ? data.requests.map(r => requestCard(r, true)).join('')
      : '<div class="empty-state">No booking requests yet.</div>';

    $('allRequests').querySelectorAll('[data-approve]').forEach(b => {
      b.addEventListener('click', () =>
        decideRequest(b.dataset.approve, 'approve')
      );
    });

    $('allRequests').querySelectorAll('[data-reject]').forEach(b => {
      b.addEventListener('click', () =>
        decideRequest(b.dataset.reject, 'reject')
      );
    });
  } catch (error) {
    $('allRequests').textContent = error.message;
  }
}

async function decideRequest(id, decision) {
  const note = decision === 'reject'
    ? prompt('Optional reason for rejection:') || ''
    : '';

  try {
    const data = await api(`/api/booking-requests/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, note })
    });

    showMessage(data.message, 'success');

    await Promise.all([
      loadAllRequests(),
      loadBookings()
    ]);
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

// Load users and display Enable/Disable and Delete buttons.
async function loadUsers() {
  try {
    const data = await api('/api/users');

    $('usersList').innerHTML = data.users.map(u => `
      <article class="user-row">
        <div>
          <strong>${escapeHtml(u.display_name)}</strong>
          <p>${escapeHtml(u.username)} · ${escapeHtml(u.role)}</p>
        </div>

        <span class="status-tag ${u.active ? 'active' : 'inactive'}">
          ${u.active ? 'Active' : 'Disabled'}
        </span>

        ${u.id !== currentUser.id ? `
          <button
            class="mini-button ${u.active ? 'danger' : ''}"
            data-toggle-user="${u.id}"
            data-active="${u.active ? 1 : 0}"
            type="button">
            ${u.active ? 'Disable' : 'Enable'}
          </button>

          ${u.role !== 'principal' ? `
            <button
              class="mini-button danger"
              data-delete-user="${u.id}"
              data-user-name="${escapeHtml(u.display_name)}"
              type="button">
              Delete
            </button>
          ` : ''}
        ` : ''}
      </article>
    `).join('');

    $('usersList').querySelectorAll('[data-toggle-user]').forEach(b => {
      b.addEventListener('click', () => {
        toggleUser(
          b.dataset.toggleUser,
          b.dataset.active !== '1'
        );
      });
    });

    $('usersList').querySelectorAll('[data-delete-user]').forEach(b => {
      b.addEventListener('click', () => {
        deleteUser(
          b.dataset.deleteUser,
          b.dataset.userName
        );
      });
    });
  } catch (error) {
    $('usersList').textContent = error.message;
  }
}

// Create a new user account.
$('userForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const data = await api('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        display_name: $('newDisplayName').value.trim(),
        username: $('newUsername').value.trim(),
        role: $('newRole').value,
        password: $('newPassword').value
      })
    });

    $('userMessage').textContent =
      `${data.message} Share the temporary password privately.`;
    $('userMessage').className = 'message success';

    $('userForm').reset();
    await loadUsers();
  } catch (error) {
    $('userMessage').textContent = error.message;
    $('userMessage').className = 'message error';
  }
});

// Enable or disable a user account.
async function toggleUser(id, active) {
  try {
    const data = await api(`/api/users/${id}/active`, {
      method: 'PATCH',
      body: JSON.stringify({ active })
    });

    $('userMessage').textContent = data.message;
    $('userMessage').className = 'message success';

    await loadUsers();
  } catch (error) {
    $('userMessage').textContent = error.message;
    $('userMessage').className = 'message error';
  }
}

// Delete a user after confirmation.
async function deleteUser(id, userName) {
  const confirmed = confirm(
    `Are you sure you want to delete "${userName}"?\n\nThis action cannot be undone.`
  );

  if (!confirmed) return;

  try {
    const data = await api(`/api/users/${id}`, {
      method: 'DELETE'
    });

    $('userMessage').textContent = data.message;
    $('userMessage').className = 'message success';

    await loadUsers();
  } catch (error) {
    $('userMessage').textContent = error.message;
    $('userMessage').className = 'message error';
  }
}

// Change the logged-in user's password.
$('passwordForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const data = await api('/api/change-password', {
      method: 'POST',
      body: JSON.stringify({
        current_password: $('currentPassword').value,
        new_password: $('newPasswordSelf').value
      })
    });

    $('passwordMessage').textContent = data.message;
    $('passwordMessage').className = 'message success';

    showLogin();
    checkInitialSetup();
  } catch (error) {
    $('passwordMessage').textContent = error.message;
    $('passwordMessage').className = 'message error';
  }
});

// Restore the existing login session when the app opens.
(async function init() {
  try {
    const data = await api('/api/me');
    showDashboard(data.user);
  } catch (_) {
    showLogin();
    checkInitialSetup();
  }
})();
