/* ============================================================
   app.js — MediSync Nurse Dashboard Logic
   Handles: API calls, live polling, form submit, alerts, logs
   ============================================================ */
'use strict';

// ── CONFIG ────────────────────────────────────────────────────
// Automatically uses the correct server address whether opened on
// the nurse's PC (localhost) or any phone/tablet on the same WiFi.
const API_BASE       = window.location.origin + '/api';
const POLL_INTERVAL  = 10_000;   // 10 seconds
const ALERT_INTERVAL = 8_000;    // 8 seconds

// ── AUDIO ALARM (Web Audio API — no file needed) ──────────────
function playAlarm() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // 15 consecutive beeps for an alarm (~5 seconds)
    const times = Array.from({length: 15}, (_, i) => i * 0.35);
    times.forEach(t => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type      = 'square';
      // Use alternating pitches for a siren-like feel
      const pitch = (t % 0.70 === 0) ? 880 : 1046; 
      osc.frequency.setValueAtTime(pitch, ctx.currentTime + t);
      gain.gain.setValueAtTime(0.5,  ctx.currentTime + t); // Louder (was 0.3)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.28);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime  + t + 0.28);
    });
  } catch (_) { /* AudioContext not available */ }
}

// ── BROWSER PUSH NOTIFICATIONS ────────────────────────────────────
// Smart notification permission system:
//   - Shows a sticky banner when permission is 'default' (not yet asked)
//   - Shows a 'how to unblock' banner when permission is 'denied'
//   - Re-checks on every window focus (catches mobile users who allow via Settings)
//   - 'Not now' hides the banner for the session (sessionStorage)

const DISMISSED_KEY = 'notifPromptDismissed';

function showNotifPromptBanner() {
  if (!('Notification' in window)) return;            // browser doesn't support it
  if (sessionStorage.getItem(DISMISSED_KEY)) return;  // user said 'not now' this session

  const banner    = $('notifPromptBanner');
  const title     = $('notifPromptTitle');
  const msg       = $('notifPromptMsg');
  const allowBtn  = $('notifPromptAllowBtn');
  if (!banner) return;

  const perm = Notification.permission;

  if (perm === 'granted') {
    // Already allowed — hide banner
    banner.classList.add('hidden');
    return;
  }

  if (perm === 'denied') {
    // Show 'how to fix' banner in red
    banner.classList.remove('hidden');
    banner.classList.add('notif-denied');
    $('notifPromptIcon') && ($('notifPromptIcon').textContent = '🚫');
    title.textContent = 'Notifications are Blocked';
    msg.textContent   = 'To get missed-dose alerts, go to your browser / phone Settings → Site Settings → Notifications → Allow for this site.';
    allowBtn.textContent = '⚙️ How to Enable';
    allowBtn.onclick = () => {
      // Open a help article on enabling notifications on common browsers
      window.open('https://support.google.com/chrome/answer/3220216', '_blank', 'noopener');
    };
    return;
  }

  // perm === 'default' — not yet asked
  banner.classList.remove('hidden');
  banner.classList.remove('notif-denied');
  title.textContent    = 'Enable Missed Dose Alerts';
  msg.textContent      = 'Get notified instantly when a patient misses their medicine, even when this tab is in the background.';
  allowBtn.textContent = '🔔 Allow Alerts';
  allowBtn.onclick     = requestNotificationPermission;
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    toast('⚠️ Your browser does not support notifications.', 'error', 5000);
    return;
  }
  // On iOS Safari, permission can only be requested from a user gesture.
  // This is already a button click, so it's fine.
  const result = await Notification.requestPermission();
  updateNotifButton(result);
  if (result === 'granted') {
    toast('✅ Notifications enabled! You\'ll get alerts even on your home screen.', 'success', 5000);
    $('notifPromptBanner').classList.add('hidden');
  } else if (result === 'denied') {
    toast('🚫 Permission denied. Enable it in your browser/phone Settings.', 'error', 6000);
    // Re-render banner in denied (red) mode
    showNotifPromptBanner();
  }
}

function updateNotifButton(permission) {
  const btn = $('notifEnableBtn');
  if (!btn) return;
  if (permission === 'granted') {
    btn.textContent = '✅ Alerts On';
    btn.style.background = 'rgba(34,197,94,0.15)';
    btn.style.borderColor = '#22c55e';
    btn.style.color       = '#22c55e';
    btn.disabled = true;
  } else if (permission === 'denied') {
    btn.textContent = '🚫 Blocked';
    btn.style.background = 'rgba(239,68,68,0.1)';
    btn.style.borderColor = '#ef4444';
    btn.style.color       = '#ef4444';
    btn.title = 'Go to browser Settings → Site Settings → Notifications to unblock';
  } else {
    btn.textContent = '🔔 Enable Alerts';
  }
}

function pushBrowserNotification(title, body, icon = '💊') {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  const n = new Notification(title, {
    body,
    icon:  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text y="28" font-size="28">' + icon + '</text></svg>',
    badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text y="28" font-size="28">🚨</text></svg>',
    requireInteraction: true,
    tag: 'medisync-alert',
    // Vibration pattern for mobile devices (exactly 5 seconds)
    vibrate: [500, 250, 500, 250, 500, 250, 500, 250, 500, 250, 500, 250, 500],
  });
  n.onclick = () => { window.focus(); n.close(); };
}

// ── NOTIFICATION BELL STATE ───────────────────────────────────
let unreadAlerts = 0;

function updateBellBadge(delta = 1) {
  unreadAlerts += delta;
  const badge = $('bellBadge');
  if (!badge) return;
  badge.textContent = unreadAlerts;
  badge.classList.toggle('hidden', unreadAlerts === 0);
  $('bellBtn').classList.toggle('bell-ringing', unreadAlerts > 0);
}

function clearBell() {
  unreadAlerts = 0;
  const badge = $('bellBadge');
  if (badge) { badge.textContent = '0'; badge.classList.add('hidden'); }
  const btn = $('bellBtn');
  if (btn) btn.classList.remove('bell-ringing');
}

// ── STATE ─────────────────────────────────────────────────────
let schedules        = [];
let lastAlertPoll    = new Date().toISOString();
let pendingDeleteId  = null;
let autoRefreshTimer = null;
let alertPollTimer   = null;

// ── DOM REFS ──────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const scheduleForm    = $('scheduleForm');
const bedIdSelect     = $('bedIdSelect');
const bedIdCustom     = $('bedIdCustom');
const medicineInput   = $('medicineName');
const compartmentSel  = $('compartment');
const doseTimeInput   = $('doseTime');
const startDateInput  = $('startDate');
const durationInput   = $('durationDays');
const submitBtn       = $('submitBtn');
const formError       = $('formError');

const scheduleBody    = $('scheduleBody');
const rowCount        = $('rowCount');
const filterBed       = $('filterBed');
const filterStatus    = $('filterStatus');
const filterDate      = $('filterDate');
const clearFiltersBtn = $('clearFilters');
const refreshBtn      = $('refreshBtn');

const alertBanner     = $('alertBanner');
const alertMsg        = $('alertMsg');
const alertClose      = $('alertClose');

const logsToggle      = $('logsToggle');
const logsBody        = $('logsBody');
const logsTableBody   = $('logsTableBody');

const confirmModal    = $('confirmModal');
const modalConfirm    = $('modalConfirm');
const modalCancel     = $('modalCancel');

const clock           = $('clock');
const clockDate       = $('clockDate');
const cntPending      = $('cntPending');
const cntDispensed    = $('cntDispensed');
const cntTaken        = $('cntTaken');
const cntNotTaken     = $('cntNotTaken');

// ── HELPERS ───────────────────────────────────────────────────

function formatTime(timeStr) {
  if (!timeStr) return '—';
  const [h, m] = timeStr.split(':');
  const d = new Date();
  d.setHours(+h, +m, 0, 0);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  // MySQL DATE comes as 'YYYY-MM-DD' or full ISO string '2026-04-25T00:00:00.000Z'
  // Grab just the YYYY-MM-DD part to avoid timezone shifting
  const plain = String(dateStr).slice(0, 10);  // '2026-04-25'
  const [y, m, d] = plain.split('-');
  const date = new Date(+y, +m - 1, +d);       // local midnight, no UTC shift
  return date.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(dtStr) {
  if (!dtStr) return '—';
  // Handle 'YYYY-MM-DD HH:MM:SS' (MySQL format) or ISO string
  const normalized = String(dtStr).replace(' ', 'T'); // make valid ISO
  const d = new Date(normalized);
  if (isNaN(d)) return String(dtStr).slice(0, 19);   // fallback: show raw string
  return d.toLocaleString([], {
    month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function statusBadge(status) {
  const map = {
    PENDING:   { cls: 'badge-pending',   icon: '⏳', label: 'Pending'    },
    DISPENSED: { cls: 'badge-dispensed', icon: '💊', label: 'Dispensed'  },
    TAKEN:     { cls: 'badge-taken',     icon: '✅', label: 'Taken'      },
    NOT_TAKEN: { cls: 'badge-not_taken', icon: '❌', label: 'Missed'     },
  };
  const s = map[status] || { cls: '', icon: '?', label: status };
  return `<span class="badge ${s.cls}">${s.icon} ${s.label}</span>`;
}

function toast(msg, type = 'info', duration = 3500) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${msg}</span>`;
  $('toastContainer').appendChild(el);
  setTimeout(() => {
    el.style.animation = 'fadeOut 0.3s forwards';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function setLoading(on) {
  $('submitBtn').querySelector('.btn-text').classList.toggle('hidden', on);
  $('submitBtn').querySelector('.btn-spinner').classList.toggle('hidden', !on);
  submitBtn.disabled = on;
}

function showFormError(msg) {
  formError.textContent = msg;
  formError.classList.remove('hidden');
}
function clearFormError() { formError.classList.add('hidden'); }

// ── CLOCK ─────────────────────────────────────────────────────
function tickClock() {
  const now = new Date();
  clock.textContent     = now.toLocaleTimeString();
  clockDate.textContent = now.toLocaleDateString([], {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}
tickClock();
setInterval(tickClock, 1000);

// ── SET DEFAULT DATE ──────────────────────────────────────────
startDateInput.value = new Date().toISOString().split('T')[0];

// ── BEDS DROPDOWN ─────────────────────────────────────────────
async function loadBeds() {
  try {
    const res  = await fetch(`${API_BASE}/schedules/beds`);
    const data = await res.json();
    if (!data.success) return;
    const beds = data.beds;

    // Populate header select & filter
    [bedIdSelect, filterBed].forEach(sel => {
      const currentVal = sel.value;
      while (sel.options.length > 1) sel.remove(1);
      beds.forEach(b => {
        const opt = new Option(`${b.bed_id}${b.location ? ' — ' + b.location : ''}`, b.bed_id);
        sel.appendChild(opt);
      });
      sel.value = currentVal;
    });
  } catch (_) {}
}

// Sync bed select ↔ custom input
bedIdSelect.addEventListener('change', () => {
  bedIdCustom.value = bedIdSelect.value || '';
});
bedIdCustom.addEventListener('input', () => {
  bedIdSelect.value = '';
});

// ── FORM SUBMIT ───────────────────────────────────────────────
scheduleForm.addEventListener('submit', async e => {
  e.preventDefault();
  clearFormError();

  const bed_id       = bedIdCustom.value.trim() || bedIdSelect.value;
  const medicine_name = medicineInput.value.trim();
  const compartment  = compartmentSel.value;
  const dose_time    = doseTimeInput.value;
  const start_date   = startDateInput.value;
  const duration_days = durationInput.value;

  if (!bed_id)        return showFormError('Please select or enter a Bed ID.');
  if (!medicine_name) return showFormError('Please enter a medicine name.');
  if (!dose_time)     return showFormError('Please select a dose time.');
  if (!start_date)    return showFormError('Please select a start date.');
  if (!duration_days || duration_days < 1) return showFormError('Duration must be at least 1 day.');

  setLoading(true);
  try {
    const res = await fetch(`${API_BASE}/schedules`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ bed_id, medicine_name, compartment: +compartment, dose_time, start_date, duration_days: +duration_days }),
    });
    const data = await res.json();

    if (!data.success) {
      const msg = data.errors ? data.errors.map(e => e.msg).join('. ') : (data.message || 'Error saving schedule.');
      return showFormError(msg);
    }

    toast('✅ Schedule added successfully!', 'success');
    scheduleForm.reset();
    startDateInput.value = new Date().toISOString().split('T')[0];
    durationInput.value  = 1;
    await loadBeds();
    await fetchSchedules();
  } catch (err) {
    showFormError('Cannot connect to server. Is the backend running?');
  } finally {
    setLoading(false);
  }
});

// ── FETCH SCHEDULES (filtered — for table only) ─────────────────────
async function fetchSchedules() {
  const params = new URLSearchParams();
  if (filterBed.value)    params.set('bed_id', filterBed.value);
  if (filterStatus.value) params.set('status', filterStatus.value);
  if (filterDate.value)   params.set('date',   filterDate.value);

  try {
    const res  = await fetch(`${API_BASE}/schedules?${params}`);
    const data = await res.json();
    if (!data.success) return;

    schedules = data.schedules;
    renderTable(schedules);
    // Stats always come from ALL schedules, not just filtered
    await fetchGlobalStats();
    $('liveBadge').title = 'Last refresh: ' + new Date().toLocaleTimeString();
  } catch (_) {
    // silent — keep previous data visible
  }
}

// ── FETCH GLOBAL STATS (always unfiltered) ────────────────────────
async function fetchGlobalStats() {
  try {
    const res  = await fetch(`${API_BASE}/schedules`); // no filters
    const data = await res.json();
    if (!data.success) return;
    updateStats(data.schedules);
  } catch (_) {}
}

// ── RENDER TABLE ──────────────────────────────────────────────
function renderTable(rows) {
  rowCount.textContent = `${rows.length} schedule${rows.length !== 1 ? 's' : ''}`;

  if (rows.length === 0) {
    scheduleBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="8">
          <div class="empty-state">
            <div class="empty-icon" aria-hidden="true">💊</div>
            <p>No schedules match the current filters.</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  scheduleBody.innerHTML = rows.map(s => {
    const rowCls = s.status === 'NOT_TAKEN' ? 'row-not-taken' :
                   s.status === 'TAKEN'     ? 'row-taken'     : '';
    return `
      <tr class="${rowCls}">
        <td><span class="bed-chip">${escHtml(s.bed_id)}</span></td>
        <td style="color:var(--text-primary);font-weight:500;">${escHtml(s.medicine_name)}</td>
        <td><span class="comp-badge comp-${s.compartment}">${s.compartment}</span></td>
        <td style="font-family:'JetBrains Mono',monospace;">${formatTime(s.dose_time)}</td>
        <td>${formatDate(s.start_date)}</td>
        <td style="text-align:center;">${s.duration_days}d</td>
        <td>${statusBadge(s.status)}</td>
        <td>
          <button class="btn-delete-row" data-id="${s.id}" aria-label="Delete schedule ${s.id}" title="Delete">🗑</button>
        </td>
      </tr>`;
  }).join('');

  // attach delete handlers
  scheduleBody.querySelectorAll('.btn-delete-row').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingDeleteId = btn.dataset.id;
      confirmModal.classList.remove('hidden');
    });
  });
}

// ── UPDATE STATS ──────────────────────────────────────────────
function updateStats(rows) {
  const counts = { PENDING: 0, DISPENSED: 0, TAKEN: 0, NOT_TAKEN: 0 };
  rows.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });
  cntPending.textContent   = counts.PENDING;
  cntDispensed.textContent = counts.DISPENSED;
  cntTaken.textContent     = counts.TAKEN;
  cntNotTaken.textContent  = counts.NOT_TAKEN;

  // Shake the not-taken stat if > 0
  const card = $('statNotTaken');
  if (counts.NOT_TAKEN > 0) card.style.boxShadow = 'var(--shadow-glow-red)';
  else card.style.boxShadow = '';
}

// ── DELETE CONFIRM ────────────────────────────────────────────
modalConfirm.addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  confirmModal.classList.add('hidden');
  try {
    const res  = await fetch(`${API_BASE}/schedules/${pendingDeleteId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      toast('🗑 Schedule deleted.', 'info');
      await fetchSchedules();
    } else {
      toast('❌ ' + (data.message || 'Delete failed.'), 'error');
    }
  } catch (_) {
    toast('❌ Cannot connect to server.', 'error');
  }
  pendingDeleteId = null;
});
modalCancel.addEventListener('click', () => {
  confirmModal.classList.add('hidden');
  pendingDeleteId = null;
});
confirmModal.addEventListener('click', e => {
  if (e.target === confirmModal) { confirmModal.classList.add('hidden'); pendingDeleteId = null; }
});

// ── FILTERS ───────────────────────────────────────────────────
[filterBed, filterStatus, filterDate].forEach(el =>
  el.addEventListener('change', fetchSchedules)
);
clearFiltersBtn.addEventListener('click', () => {
  filterBed.value = filterStatus.value = filterDate.value = '';
  fetchSchedules();
});
refreshBtn.addEventListener('click', fetchSchedules);

// ── ALERT POLLING ─────────────────────────────────────────────
async function pollAlerts() {
  try {
    const res  = await fetch(`${API_BASE}/status/alerts?since=${encodeURIComponent(lastAlertPoll)}`);
    const data = await res.json();
    if (data.success && data.alerts.length > 0) {
      lastAlertPoll = new Date().toISOString();

      // Handle every new alert (could be multiple)
      data.alerts.forEach(a => {
        const bedInfo  = `Bed ${a.bed_id}`;
        const medInfo  = `${a.medicine} (Compartment ${a.compartment})`;
        const timeInfo = new Date(a.timestamp).toLocaleTimeString();

        // 1. Update sticky red banner
        alertMsg.textContent = `🚨 MISSED DOSE — ${bedInfo}: ${medInfo} at ${timeInfo}`;
        alertBanner.classList.remove('hidden');

        // 2. Toast (stays 8 seconds)
        toast(`🚨 MISSED: ${a.medicine} @ ${bedInfo}`, 'error', 8000);

        // 3. Browser push notification (works even in background tab)
        pushBrowserNotification(
          '🚨 Missed Dose Alert — MediSync',
          `${bedInfo}: ${medInfo}\nNot taken by ${timeInfo}`,
          '🚨'
        );

        // 4. Audio alarm
        playAlarm();

        // 5. Bell badge update
        updateBellBadge(1);

        // 6. Add to notification dropdown list
        addNotificationItem(a);
      });

      // Refresh table to show red rows
      await fetchSchedules();
    }
  } catch (_) {}
}

// ── NOTIFICATION DROPDOWN LIST ────────────────────────────────
const notificationItems = [];

function addNotificationItem(alert) {
  const list = $('notifList');
  if (!list) return;

  notificationItems.unshift(alert);

  const item = document.createElement('div');
  item.className = 'notif-item';
  item.innerHTML = `
    <div class="notif-item-header">
      <span class="notif-bed bed-chip">${escHtml(alert.bed_id)}</span>
      <span class="notif-time">${new Date(alert.timestamp).toLocaleTimeString()}</span>
    </div>
    <div class="notif-item-body">
      <span class="notif-icon">💊</span>
      <span><strong>${escHtml(alert.medicine)}</strong></span>
    </div>
    <div class="notif-item-sub">Compartment ${alert.compartment} — Patient did NOT take medicine</div>
  `;
  // Prepend so newest is on top
  list.insertBefore(item, list.firstChild);

  // Keep max 20 entries
  while (list.children.length > 20) list.removeChild(list.lastChild);

  const emptyMsg = list.querySelector('.notif-empty');
  if (emptyMsg) emptyMsg.remove();
}

alertClose.addEventListener('click', () => alertBanner.classList.add('hidden'));

// ── LOGS PANEL ────────────────────────────────────────────────
logsToggle.addEventListener('click', async () => {
  const open = logsBody.classList.toggle('hidden');
  logsToggle.setAttribute('aria-expanded', !open);
  logsBody.setAttribute('aria-hidden', open);
  logsToggle.textContent = open ? 'Show Logs ▼' : 'Hide Logs ▲';
  if (!open) await fetchLogs();
});

async function fetchLogs() {
  try {
    const res  = await fetch(`${API_BASE}/status/logs?limit=50`);
    const data = await res.json();
    if (!data.success || data.logs.length === 0) {
      logsTableBody.innerHTML = `<tr class="empty-row"><td colspan="5"><div class="empty-state"><p>No logs yet.</p></div></td></tr>`;
      return;
    }
    logsTableBody.innerHTML = data.logs.map(l => `
      <tr>
        <td>${formatDateTime(l.timestamp)}</td>
        <td><span class="bed-chip">${escHtml(l.bed_id)}</span></td>
        <td>${escHtml(l.medicine)}</td>
        <td><span class="comp-badge comp-${l.compartment}">${l.compartment}</span></td>
        <td>${statusBadge(l.event_status)}</td>
      </tr>`).join('');
  } catch (_) {}
}

// ── ESCAPE HTML ───────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── AUTO-REFRESH ──────────────────────────────────────────────
function startAutoRefresh() {
  autoRefreshTimer = setInterval(fetchSchedules, POLL_INTERVAL);
  alertPollTimer   = setInterval(pollAlerts,    ALERT_INTERVAL);
}

// ── BELL BUTTON TOGGLE ────────────────────────────────────────
const bellBtn = $('bellBtn');
if (bellBtn) {
  bellBtn.addEventListener('click', () => {
    const dropdown = $('notifDropdown');
    const isOpen   = !dropdown.classList.contains('hidden');
    dropdown.classList.toggle('hidden', isOpen);
    if (!isOpen) clearBell();
  });
  // Close on outside click
  document.addEventListener('click', e => {
    if (!bellBtn.contains(e.target) && !$('notifDropdown').contains(e.target)) {
      $('notifDropdown').classList.add('hidden');
    }
  });
}

// ── SERVICE WORKER REGISTRATION ───────────────────────────────
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
    console.log('[MediSync] Service Worker registered ✅');
  } catch (err) {
    console.warn('[MediSync] SW registration failed:', err);
  }
}

// ── ENABLE NOTIFICATIONS BUTTON (header pill) ────────────────
const notifEnableBtn = $('notifEnableBtn');
if (notifEnableBtn) {
  notifEnableBtn.addEventListener('click', requestNotificationPermission);
}

// ── NOTIFICATION PROMPT BANNER DISMISS BUTTON ─────────────────
const notifPromptDismissBtn = $('notifPromptDismissBtn');
if (notifPromptDismissBtn) {
  notifPromptDismissBtn.addEventListener('click', () => {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    $('notifPromptBanner').classList.add('hidden');
  });
}

// Re-check permission when user returns to this tab (e.g. from browser Settings on mobile)
window.addEventListener('focus', () => {
  if ('Notification' in window) {
    updateNotifButton(Notification.permission);
    showNotifPromptBanner();
  }
});

// ── INIT ──────────────────────────────────────────────────────
(async function init() {
  // Register service worker (enables background notifications)
  await registerServiceWorker();

  // Show current notification permission state on header pill button
  if ('Notification' in window) {
    updateNotifButton(Notification.permission);
    // Show smart banner (default = ask, denied = how-to-fix, granted = hidden)
    setTimeout(showNotifPromptBanner, 800);
  }

  await loadBeds();
  await fetchSchedules();
  startAutoRefresh();
  toast('MediSync connected 🟢', 'success', 3000);
})();