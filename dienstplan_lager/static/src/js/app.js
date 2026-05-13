/* ============================================================
   SHIFT PLANNING TURBO – interactive SPA
   ============================================================ */
(function () {
'use strict';

// -----------------------------------------------------------
// Internationalization
// -----------------------------------------------------------
let I18N = {};
try {
  const el = document.getElementById('i18n-data');
  if (el) I18N = JSON.parse(el.textContent || '{}');
} catch (_) {
  I18N = {};
}

function t(key, vars) {
  let s = I18N[key] || key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.replace('%(' + k + ')s', vars[k])
           .replace('%s', vars[k]); // first %s
    }
  }
  return s;
}

function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
}

// Safe text setter — never throws if the element is missing.
function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(v);
}

// -----------------------------------------------------------
// State
// -----------------------------------------------------------
const state = {
  viewMode: 'week',     // 'day' | 'week' | 'month' | 'year'
  offset: 0,            // offset in current viewMode units (days/weeks/months/years)
  data: null,
  loading: false,
  empFilter: '',        // sidebar search (employees only)
  globalFilter: '',     // top-bar search (employees + areas + shift notes)
  statusFilter: null,   // 'draft' | 'published' | null (all)
  // Employees dragged onto the grid that don't have shifts yet.
  // Session-only — cleared on page refresh.
  pinnedEmployees: new Set(),
  // Saved per-user employee filter groups, persisted in localStorage.
  // crews: { "Lager": [empId, empId, ...], ... }
  // activeCrew: null = "All"; otherwise the name of the active filter.
  crews: {},
  activeCrew: null,
  // Additional filters from the Filter column in the dropdown.
  // statusFilter: null | 'draft' | 'published'
  // absenceOnly: true → only show shifts/leaves where is_leave is true
  absenceOnly: false,
};

const DAY_KEYS = [
  'day_short_mon', 'day_short_tue', 'day_short_wed', 'day_short_thu',
  'day_short_fri', 'day_short_sat', 'day_short_sun',
];
const MONTH_NAMES = [
  t('month_january'), t('month_february'), t('month_march'),
  t('month_april'), t('month_may'), t('month_june'),
  t('month_july'), t('month_august'), t('month_september'),
  t('month_october'), t('month_november'), t('month_december'),
];
// Shift defaults – initialised with safe fallbacks, then overwritten
// on every API load with the values the admin configured in
// Settings → Shift Planning.  This keeps the UI responsive even
// before the first fetch completes.
let DEFAULT_START_H = 8;
let DEFAULT_START_M = 0;
let DEFAULT_END_H = 16;
let DEFAULT_END_M = 30;

function _applyDefaults(defaults) {
  if (!defaults) return;
  if (defaults.start_hour  != null) DEFAULT_START_H = defaults.start_hour;
  if (defaults.start_minute != null) DEFAULT_START_M = defaults.start_minute;
  if (defaults.end_hour    != null) DEFAULT_END_H   = defaults.end_hour;
  if (defaults.end_minute  != null) DEFAULT_END_M   = defaults.end_minute;
}

// Parse a YYYY-MM-DD date string as local midnight (avoids TZ jitter)
function parseISODate(s) {
  return new Date(s + 'T00:00:00');
}

// -----------------------------------------------------------
// JSON-RPC helper (Odoo)
// -----------------------------------------------------------
async function rpc(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: params || {} }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  if (j.error) {
    const msg = j.error.data && j.error.data.message ? j.error.data.message : j.error.message;
    throw new Error(msg || t('rpc_error'));
  }
  if (j.result && j.result.error) throw new Error(j.result.error);
  return j.result;
}

// -----------------------------------------------------------
// Date helpers (server stores UTC; we display local)
// -----------------------------------------------------------
function parseServerDT(s) {
  if (!s) return null;
  const iso = s.replace(' ', 'T') + 'Z';
  return new Date(iso);
}
function toServerDT(date) {
  const pad = n => String(n).padStart(2, '0');
  return (
    date.getUTCFullYear() + '-' +
    pad(date.getUTCMonth() + 1) + '-' +
    pad(date.getUTCDate()) + ' ' +
    pad(date.getUTCHours()) + ':' +
    pad(date.getUTCMinutes()) + ':' +
    pad(date.getUTCSeconds())
  );
}
function fmtTimeLocal(date) {
  if (!date) return '';
  const pad = n => String(n).padStart(2, '0');
  return pad(date.getHours()) + ':' + pad(date.getMinutes());
}
function dayKey(date) {
  const pad = n => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}
function buildLocalDT(dateStr, hours, minutes) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, hours, minutes, 0, 0);
}

// -----------------------------------------------------------
// Toast
// -----------------------------------------------------------
function toast(msg, kind) {
  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  const tEl = document.createElement('div');
  tEl.className = 'toast ' + (kind || '');
  tEl.textContent = msg;
  stack.appendChild(tEl);
  setTimeout(() => {
    tEl.classList.add('fade-out');
    setTimeout(() => tEl.remove(), 250);
  }, 2400);
}

// -----------------------------------------------------------
// Rendering
// -----------------------------------------------------------

// -----------------------------------------------------------
// Rendering
// -----------------------------------------------------------
function render() {
  if (!state.data) return;
  renderTopbar();
  renderCrewTrigger();
  renderStats();
  renderSidebar();
  renderGrid();
  attachDnd();
}

// Track active sidebar tab
let sidebarTab = 'employees';

function renderTopbar() {
  const d = state.data;
  const start = parseISODate(d.start_date || d.monday);
  const end   = parseISODate(d.end_date   || d.sunday);
  const mode = state.viewMode;

  // Week label
  const fmt = dt => String(dt.getDate()).padStart(2, '0') + ' ' +
    MONTH_NAMES[dt.getMonth()];
  let title;
  if (mode === 'day') {
    title = t(DAY_KEYS[(start.getDay() + 6) % 7]) + ', ' + fmt(start) + ' ' + start.getFullYear();
  } else if (mode === 'month') {
    title = MONTH_NAMES[start.getMonth()] + ' ' + start.getFullYear();
  } else if (mode === 'year') {
    title = String(start.getFullYear());
  } else {
    title = fmt(start) + ' — ' + fmt(end) + ' · ' + d.jahr;
  }

  const kwEl = document.getElementById('kw-pill');
  if (kwEl && d.kw) kwEl.textContent = 'CW ' + d.kw;
  setText('week-title', title);

  // Sync view mode buttons
  document.querySelectorAll('.view-seg button').forEach(b => {
    b.classList.toggle('active', b.dataset.view === mode);
  });
}

function renderStats() {
  const d = state.data;
  const monday = new Date((d.start_date || d.monday) + 'T00:00:00');
  const sunday = new Date((d.end_date || d.sunday) + 'T23:59:59');

  let totalH = 0, conflicts = 0;
  const byEmpDay = {};
  for (const s of d.shifts) {
    if (!isShiftVisible(s)) continue;
    const dv = parseServerDT(s.datum_von);
    const db = parseServerDT(s.datum_bis);
    if (!s.is_leave) totalH += (db - dv) / 3600000;
    const key = s.employee_id + '|' + dayKey(dv);
    (byEmpDay[key] = byEmpDay[key] || []).push([dv, db]);
  }
  for (const k of Object.keys(byEmpDay)) {
    const arr = byEmpDay[k].sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < arr.length - 1; i++) {
      if (arr[i][1] > arr[i + 1][0]) conflicts++;
    }
  }
  const leaveDays = new Set();
  for (const l of d.leaves) {
    if (!isLeaveVisible(l)) continue;
    const dFrom = parseServerDT(l.date_from);
    const dTo = parseServerDT(l.date_to);
    let cur = new Date(Math.max(dFrom, monday));
    cur.setHours(0, 0, 0, 0);
    const lim = new Date(Math.min(dTo, sunday));
    while (cur <= lim) {
      leaveDays.add(l.employee_id + '|' + dayKey(cur));
      cur.setDate(cur.getDate() + 1);
    }
  }

  // Only count employees with activity (shift or leave) this period —
  // not every active employee in the Odoo DB. Scale by the number of
  // days in the current view so Day/Month/Year give sensible numbers.
  const activeEmpIds = new Set();
  for (const s of d.shifts) if (isShiftVisible(s)) activeEmpIds.add(s.employee_id);
  for (const l of d.leaves) if (isLeaveVisible(l)) activeEmpIds.add(l.employee_id);
  const activeEmployees = d.all_employees.filter(e => activeEmpIds.has(e.id));
  const periodDays = (d.days && d.days.length) || 7;
  const weeklyTargetH = activeEmployees.reduce(
    (sum, e) => sum + (e.weekly_hours_target || 40), 0);
  const targetH = Math.round(weeklyTargetH * (periodDays / 7));
  const rate = targetH > 0 ? Math.min(100, Math.round((totalH / targetH) * 100)) : 0;

  const $ = id => document.getElementById(id);
  setText('stat-hours', Math.round(totalH) + 'h');
  setText('stat-hours-trend', 'Target: ' + Math.round(targetH) + 'h');
  // Occupancy card was removed in 4.1.5 — guard the writes so the rest
  // of renderStats keeps working even when the elements don't exist.
  const rateEl = $('stat-rate');
  if (rateEl) rateEl.textContent = rate + '%';
  const rateTrend = $('stat-rate-trend');
  if (rateTrend) {
    rateTrend.textContent = rate >= 80 ? t('optimal') : rate >= 50 ? t('ok') : t('low');
    rateTrend.className = 'stat-trend ' +
      (rate >= 80 ? 'trend-up' : rate >= 50 ? 'trend-neutral' : 'trend-down');
  }
  setText('stat-leaves', leaveDays.size);
  setText('stat-leaves-trend', leaveDays.size + ' ' + t('days'));
  setText('stat-conflicts', conflicts);
  const cTrend = $('stat-conflicts-trend');
  if (cTrend) {
    cTrend.textContent = conflicts ? t('check') : t('all_ok');
    cTrend.className = 'stat-trend ' + (conflicts ? 'trend-down' : 'trend-up');
  }
}

function renderSidebar() {
  const d = state.data;
  const filter = state.empFilter.toLowerCase();
  const content = document.getElementById('sidebar-content');
  if (!content) return;

  // Update tab counts
  const countEl = document.getElementById('sidebar-count');
  if (countEl) {
    if (sidebarTab === 'employees') countEl.textContent = d.all_employees.filter(e => isInCrew(e.id)).length;
    else if (sidebarTab === 'areas') countEl.textContent = d.all_bereiche.length;
    else countEl.textContent = (d.all_vorlagen || []).length;
  }

  let html = '';
  if (sidebarTab === 'employees') {
    const globalF = state.globalFilter.trim().toLowerCase();
    for (const e of d.all_employees) {
      if (!isInCrew(e.id)) continue;
      const hay = `${e.name} ${e.role || ''}`.toLowerCase();
      if (filter && !hay.includes(filter)) continue;
      if (globalF && !hay.includes(globalF)) continue;
      html += `<div class="emp-chip" draggable="true" data-drag-type="employee" data-emp-id="${e.id}">
        <div class="avatar ${e.avatar_class}">${escapeHtml(e.initials)}</div>
        <div class="emp-info">
          <div class="emp-name">${escapeHtml(e.name)}</div>
          <div class="emp-role">${escapeHtml(e.role || '')}</div>
        </div>
        <span class="drag-handle">⠿</span>
      </div>`;
    }
  } else if (sidebarTab === 'areas') {
    html += '<div class="area-grid">';
    for (const b of d.all_bereiche) {
      if (filter && !b.name.toLowerCase().includes(filter) &&
          !(b.code || '').toLowerCase().includes(filter)) continue;
      html += `<div class="bereich-chip" draggable="true" data-drag-type="bereich"
        data-bereich-id="${b.id}"
        style="--c:${b.color}; background: color-mix(in oklab, ${b.color} 15%, var(--chip));
               border: 1px solid color-mix(in oklab, ${b.color} 35%, transparent);">
        <span class="swatch" style="background:${b.color}"></span>
        ${escapeHtml(b.code || b.name)}
      </div>`;
    }
    html += '</div>';
  } else {
    const vorlagen = d.all_vorlagen || [];
    if (vorlagen.length === 0) {
      html = `<div class="empty-hint">${escapeHtml(t('no_templates_hint'))}</div>`;
    } else {
      const fmt = (h, m) => String(h).padStart(2, '0') + ':' + String(m || 0).padStart(2, '0');
      for (const v of vorlagen) {
        if (filter && !v.name.toLowerCase().includes(filter)) continue;
        const color = v.color || '#6366f1';
        const timeRange = fmt(v.start_hour, v.start_minute) + '–' + fmt(v.end_hour, v.end_minute);
        html += `<div class="vorlage-chip" draggable="true" data-drag-type="vorlage" data-vorlage-id="${v.id}">
          <span class="swatch" style="background:${color}"></span>
          <div class="vorlage-info">
            <div class="vorlage-name">${escapeHtml(v.name)}</div>
            <div class="vorlage-meta">${escapeHtml(timeRange)}${v.bereich_name ? ' · ' + escapeHtml(v.bereich_name) : ''}</div>
          </div>
          <span class="vorlage-hrs">${v.duration_hours ? Math.round(v.duration_hours * 10) / 10 + 'h' : ''}</span>
        </div>`;
      }
    }
  }
  content.innerHTML = html;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderGrid() {
  const mode = state.viewMode;
  if (mode === 'day')   return renderDayView();
  if (mode === 'month') return renderMonthView();
  if (mode === 'year')  return renderYearView();
  return renderWeekView();
}

// ---- helpers shared by views -----------------------------------
function passesGlobalFilter(s, empName, areaName, areaCode) {
  const f = state.globalFilter.trim().toLowerCase();
  if (!f) return true;
  const note = (s && s.notiz) ? String(s.notiz).toLowerCase() : '';
  return (empName  && empName.toLowerCase().includes(f))  ||
         (areaName && areaName.toLowerCase().includes(f)) ||
         (areaCode && areaCode.toLowerCase().includes(f)) ||
         note.includes(f);
}

function buildEmployeeDayMatrix(d, dayCount) {
  const start = parseISODate(d.start_date || d.monday);
  const empMap = {};
  for (const e of d.all_employees) {
    empMap[e.id] = { emp: e, days: Array.from({ length: dayCount }, () => []), totalH: 0, hasContent: false };
  }
  for (const s of d.shifts) {
    if (!isShiftVisible(s)) continue;
    const dv = parseServerDT(s.datum_von);
    const db = parseServerDT(s.datum_bis);
    const idx = Math.round((parseISODate(dayKey(dv)) - start) / 86400000);
    if (idx < 0 || idx >= dayCount) continue;
    if (!empMap[s.employee_id]) continue;
    empMap[s.employee_id].days[idx].push({
      kind: 'shift', ...s, _dv: dv, _db: db,
      _hours: (db - dv) / 3600000,
      _timeLabel: fmtTimeLocal(dv) + '–' + fmtTimeLocal(db),
    });
    empMap[s.employee_id].totalH += (db - dv) / 3600000;
    empMap[s.employee_id].hasContent = true;
  }
  for (const l of (d.leaves || [])) {
    if (!isLeaveVisible(l)) continue;
    const dFrom = parseServerDT(l.date_from);
    const dTo = parseServerDT(l.date_to);
    if (!empMap[l.employee_id]) continue;
    let cur = new Date(Math.max(dFrom, start));
    cur.setHours(0, 0, 0, 0);
    const lim = new Date(dTo);
    while (cur <= lim) {
      const idx = Math.round((cur - start) / 86400000);
      if (idx >= 0 && idx < dayCount) {
        empMap[l.employee_id].days[idx].push({
          kind: 'leave', _leaveId: l.id, _leaveDateFrom: l.date_from, _leaveDateTo: l.date_to,
          _leaveEmpName: (state.data.all_employees.find(e => e.id === l.employee_id) || {}).name || '',
          bereich_code: t('absence'), bereich_name: l.name, bereich_color: '#9ca3af',
          _timeLabel: t('all_day'),
        });
        empMap[l.employee_id].hasContent = true;
      }
      cur.setDate(cur.getDate() + 1);
    }
  }
  for (const empId of Object.keys(empMap)) {
    for (const dayShifts of empMap[empId].days) {
      const real = dayShifts.filter(x => x.kind === 'shift');
      real.sort((a, b) => a._dv - b._dv);
      for (let i = 0; i < real.length - 1; i++) {
        if (real[i]._db > real[i + 1]._dv) { real[i].is_conflict = true; real[i + 1].is_conflict = true; }
      }
    }
  }
  return empMap;
}

function shiftHtml(s, fadedCls) {
  // Status filter: hide shifts that don't match
  if (state.statusFilter && s.kind === 'shift' && s.state !== state.statusFilter) {
    return '';
  }
  if (s.kind === 'shift') {
    const cls = ['shift'];
    if (s.state === 'draft') cls.push('draft');
    if (s.is_conflict) cls.push('conflict');
    if (s.is_leave) cls.push('is-leave');
    if (fadedCls) cls.push(fadedCls);
    const h = Math.round(s._hours * 10) / 10;
    return `<div class="${cls.join(' ')}" draggable="true"
      data-drag-type="shift" data-shift-id="${s.id}" style="--c: ${s.bereich_color};">
      <div class="shift-head">
        <span class="shift-time">${escapeHtml(s._timeLabel)}</span>
        <span class="shift-hrs">${h}h</span>
      </div>
      <div class="shift-area">${escapeHtml(s.bereich_code)}</div>
    </div>`;
  }
  const leaveAttr = s._leaveId ? ` data-leave-id="${s._leaveId}"` : '';
  return `<div class="shift is-leave ${fadedCls || ''}"${leaveAttr} style="--c:#9ca3af;">
    <div class="shift-head"><span class="shift-time">${escapeHtml(s._timeLabel)}</span></div>
    <div class="shift-area">${escapeHtml(s.bereich_code)}</div>
  </div>`;
}

// ---- WEEK view -------------------------------------------------
function renderWeekView() {
  const d = state.data;
  const monday = parseISODate(d.start_date || d.monday);
  const today = parseISODate(d.today);
  const todayIdx = Math.round((today - monday) / 86400000);
  const empMap = buildEmployeeDayMatrix(d, 7);

  // Header
  let html = '<div class="pl-head">';
  html += '<div class="hcell hcell-emp"><span>EMPLOYEE</span></div>';
  for (let i = 0; i < 7; i++) {
    const dt = new Date(monday); dt.setDate(monday.getDate() + i);
    const isToday = i === todayIdx;
    html += `<div class="hcell ${isToday ? 'today' : ''}">
      <span class="dow">${escapeHtml(t(DAY_KEYS[i]))}${isToday ? ' <span class="today-badge">· TODAY</span>' : ''}</span>
      <span class="dnum">${String(dt.getDate()).padStart(2, '0')}</span>
    </div>`;
  }
  html += '</div><div class="pl-body">';

  // Filter rows: hide employees with no matching content
  const f = state.globalFilter.trim().toLowerCase();
  const rows = d.all_employees.filter(e => {
    if (!isInCrew(e.id)) return false;
    if (!empMap[e.id].hasContent && !state.pinnedEmployees.has(e.id)) return false;
    if (!f) return true;
    if (e.name.toLowerCase().includes(f)) return true;
    if ((e.role || '').toLowerCase().includes(f)) return true;
    return empMap[e.id].days.some(dayShifts =>
      dayShifts.some(s =>
        (s.bereich_name || '').toLowerCase().includes(f) ||
        (s.bereich_code || '').toLowerCase().includes(f) ||
        String(s.notiz || '').toLowerCase().includes(f)
      )
    );
  });
  if (rows.length === 0 && d.shifts.length === 0 && d.leaves.length === 0) {
    html += `<div class="empty">
      <div class="empty-icon">📅</div>
      <div class="empty-title">${escapeHtml(t('no_shifts_title'))}</div>
      <div class="empty-sub">${escapeHtml(t('no_shifts_hint'))}</div>
    </div>`;
  } else {
    for (const e of rows) {
      const m = empMap[e.id];
      const empMatch = passesGlobalFilter(null, e.name, null, null);
      const target = e.weekly_hours_target || 40;
      const wlPct = Math.min(100, Math.round((m.totalH / target) * 100));
      const overload = m.totalH > target;

      html += `<div class="pl-row" data-emp-id="${e.id}">`;
      html += `<div class="emp-cell" data-emp-id="${e.id}">
        <div class="avatar ${e.avatar_class}">${escapeHtml(e.initials)}</div>
        <div class="emp-info">
          <div class="emp-name"><span class="presence-dot"></span> ${escapeHtml(e.name)}</div>
          <div class="emp-hours">${Math.round(m.totalH)}/${Math.round(target)}h
            <span class="wl-bar"><i style="width:${wlPct}%" class="${overload ? 'over' : ''}"></i></span>
          </div>
        </div>
        <button class="emp-remove" data-emp-id="${e.id}" title="${escapeHtml(t('remove_from_week_title'))}" type="button">×</button>
      </div>`;

      for (let i = 0; i < 7; i++) {
        const dt = new Date(monday); dt.setDate(monday.getDate() + i);
        const cls = ['day-cell'];
        if (i === todayIdx) cls.push('today');
        if (i >= 5) cls.push('weekend');
        html += `<div class="${cls.join(' ')}" data-emp-id="${e.id}" data-date="${dayKey(dt)}">`;
        const shifts = m.days[i];
        if (shifts.length === 0) {
          html += '<div class="cell-empty">—</div>';
        } else {
          for (const s of shifts) {
            const matches = empMatch || passesGlobalFilter(s, e.name, s.bereich_name, s.bereich_code);
            html += shiftHtml(s, matches ? '' : 'faded');
          }
        }
        html += '</div>';
      }
      html += '</div>';
    }
  }

  // Add row
  html += '<div class="pl-row add-row"><div class="emp-cell add-label">⤵ ' + escapeHtml(t('pull_employee_here')) + '</div>';
  for (let i = 0; i < 7; i++) {
    const dt = new Date(monday); dt.setDate(monday.getDate() + i);
    html += `<div class="day-cell" data-emp-id="" data-date="${dayKey(dt)}" data-add-row="1">
      <div class="add-zone">${escapeHtml(t('new_shift'))}</div>
    </div>`;
  }
  html += '</div>';

  // Sum row
  html += '<div class="pl-row sum-row"><div class="emp-cell">Sum / day</div>';
  for (let i = 0; i < 7; i++) {
    let h = 0;
    for (const empId of Object.keys(empMap)) {
      for (const s of empMap[empId].days[i]) {
        if (s.kind === 'shift' && !s.is_leave) h += s._hours;
      }
    }
    html += `<div class="day-cell"><span class="sum-pill">${Math.round(h)}h</span></div>`;
  }
  html += '</div></div>';

  document.getElementById('grid-card').innerHTML = html;
}

// ---- DAY view --------------------------------------------------
function renderDayView() {
  const d = state.data;
  const day = parseISODate(d.start_date || d.monday);
  const empMap = buildEmployeeDayMatrix(d, 1);
  const dayLabel = t(DAY_KEYS[(day.getDay() + 6) % 7]) + ', ' +
    String(day.getDate()).padStart(2, '0') + '.' + String(day.getMonth() + 1).padStart(2, '0') + '.';

  let html = '<div class="pl-head"><div class="hcell hcell-emp"><span>EMPLOYEE</span></div>';
  html += `<div class="hcell today" style="flex:1;"><span class="dow">${escapeHtml(dayLabel)}</span></div></div>`;
  html += '<div class="pl-body">';

  const rows = d.all_employees.filter(e => isInCrew(e.id) && empMap[e.id].hasContent);
  if (rows.length === 0) {
    html += `<div class="empty"><div class="empty-icon">📅</div>
      <div class="empty-title">${escapeHtml(t('no_shifts_title'))}</div>
      <div class="empty-sub">${escapeHtml(t('no_shifts_hint'))}</div></div>`;
  } else {
    for (const e of rows) {
      const m = empMap[e.id];
      const empMatch = passesGlobalFilter(null, e.name, null, null);
      html += `<div class="pl-row" data-emp-id="${e.id}">
        <div class="emp-cell">
          <div class="avatar ${e.avatar_class}">${escapeHtml(e.initials)}</div>
          <div class="emp-info"><div class="emp-name">${escapeHtml(e.name)}</div>
          <div class="emp-hours">${Math.round(m.totalH)}h</div></div>
        </div>
        <div class="day-cell today" style="flex:1;" data-emp-id="${e.id}" data-date="${dayKey(day)}">`;
      for (const s of m.days[0]) {
        const matches = empMatch || passesGlobalFilter(s, e.name, s.bereich_name, s.bereich_code);
        html += shiftHtml(s, matches ? '' : 'faded');
      }
      html += '</div></div>';
    }
  }
  html += `<div class="pl-row add-row"><div class="emp-cell add-label">⤵ ${escapeHtml(t('pull_employee_here'))}</div>
    <div class="day-cell" style="flex:1;" data-emp-id="" data-date="${dayKey(day)}" data-add-row="1">
    <div class="add-zone">${escapeHtml(t('new_shift'))}</div></div></div>`;
  html += '</div>';
  document.getElementById('grid-card').innerHTML = html;
}

function renderMonthView() {
  const d = state.data;
  const first = parseISODate(d.start_date);   // 1st of month
  const today = parseISODate(d.today);
  const year = first.getFullYear();
  const month = first.getMonth();
  // Calendar starts on Monday — find the Monday of the week containing the 1st.
  const firstDow = (first.getDay() + 6) % 7;  // 0 = Mon
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - firstDow);

  // Index shifts by date string for fast lookup
  const shiftsByDay = {};
  const f = state.globalFilter.trim().toLowerCase();
  const empById = {};
  for (const e of d.all_employees) empById[e.id] = e;
  for (const s of d.shifts) {
    if (!isShiftVisible(s)) continue;
    const dv = parseServerDT(s.datum_von);
    const k = dayKey(dv);
    if (!shiftsByDay[k]) shiftsByDay[k] = [];
    const empName = (empById[s.employee_id] || {}).name || '';
    const matches = !f || empName.toLowerCase().includes(f) ||
                    (s.bereich_name || '').toLowerCase().includes(f) ||
                    (s.bereich_code || '').toLowerCase().includes(f) ||
                    String(s.notiz || '').toLowerCase().includes(f);
    shiftsByDay[k].push({ ...s, _empName: empName, _matches: matches });
  }

  let html = '<div class="month-view">';
  html += '<div class="month-header">';
  for (let i = 0; i < 7; i++) html += `<div class="month-dow">${escapeHtml(t(DAY_KEYS[i]))}</div>`;
  html += '</div>';
  html += '<div class="month-grid">';

  for (let w = 0; w < 6; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const cur = new Date(gridStart);
      cur.setDate(gridStart.getDate() + w * 7 + dow);
      const isOther = cur.getMonth() !== month;
      const isToday = dayKey(cur) === d.today;
      const k = dayKey(cur);
      const cellShifts = shiftsByDay[k] || [];
      const visible = cellShifts.slice(0, 4);
      const more = cellShifts.length - visible.length;
      const cls = ['month-cell'];
      if (isOther) cls.push('other-month');
      if (isToday) cls.push('today');
      html += `<div class="${cls.join(' ')}" data-date="${k}">`;
      html += `<div class="month-date">${cur.getDate()}</div>`;
      for (const s of visible) {
        const fadedCls = s._matches ? '' : 'faded';
        html += `<div class="month-chip ${fadedCls}" style="background:${s.bereich_color}; color:#fff;"
          data-shift-id="${s.id}" title="${escapeHtml(s._empName)} · ${escapeHtml(s.bereich_name || s.bereich_code)}">
          ${escapeHtml(s.bereich_code || '')} · ${escapeHtml(s._empName.split(' ')[0])}
        </div>`;
      }
      if (more > 0) {
        html += `<div class="month-more">+${more}</div>`;
      }
      html += '</div>';
    }
  }
  html += '</div></div>';
  document.getElementById('grid-card').innerHTML = html;
}

// ---- YEAR view -------------------------------------------------
// 12 months in a 3×4 grid, each showing total shifts/hours for the month.
function renderYearView() {
  const d = state.data;
  const year = parseISODate(d.start_date).getFullYear();

  // aggregate per month: count + total hours
  const monthStats = Array.from({ length: 12 }, () => ({ count: 0, hours: 0 }));
  for (const s of d.shifts) {
    if (!isShiftVisible(s)) continue;
    const dv = parseServerDT(s.datum_von);
    if (dv.getFullYear() !== year) continue;
    const m = dv.getMonth();
    const db = parseServerDT(s.datum_bis);
    monthStats[m].count++;
    monthStats[m].hours += (db - dv) / 3600000;
  }
  const maxH = Math.max(1, ...monthStats.map(s => s.hours));

  let html = '<div class="year-view">';
  for (let m = 0; m < 12; m++) {
    const st = monthStats[m];
    const intensity = Math.round((st.hours / maxH) * 100);
    html += `<button type="button" class="year-month" data-month="${m}">
      <div class="year-month-name">${escapeHtml(MONTH_NAMES[m])}</div>
      <div class="year-month-bar">
        <div class="year-month-fill" style="width:${intensity}%"></div>
      </div>
      <div class="year-month-stats">
        <div class="year-stat"><span class="num">${st.count}</span> ${escapeHtml(t('shifts_lc'))}</div>
        <div class="year-stat"><span class="num">${Math.round(st.hours)}</span> h</div>
      </div>
    </button>`;
  }
  html += '</div>';
  document.getElementById('grid-card').innerHTML = html;

  // Click month → drill into that month
  document.querySelectorAll('.year-month').forEach(el => {
    el.addEventListener('click', () => {
      const targetMonth = parseInt(el.dataset.month, 10);
      // compute new offset to land on that month
      const today = new Date();
      const monthsDiff = (year - today.getFullYear()) * 12 + (targetMonth - today.getMonth());
      state.viewMode = 'month';
      state.offset = monthsDiff;
      reload();
    });
  });
}

// -----------------------------------------------------------
// Drag & Drop
// -----------------------------------------------------------
let dragPayload = null;

function attachDnd() {
  document.querySelectorAll('[draggable="true"]').forEach(el => {
    el.addEventListener('dragstart', onDragStart);
    el.addEventListener('dragend', onDragEnd);
  });
  // Drop targets: day cells (for shifts) AND employee name cells
  // (for adding an empty employee row).
  document.querySelectorAll('.day-cell, .emp-cell').forEach(cell => {
    cell.addEventListener('dragover', onDragOver);
    cell.addEventListener('dragleave', onDragLeave);
    cell.addEventListener('drop', onDrop);
  });
}

function onDragStart(e) {
  const el = e.currentTarget;
  const type = el.dataset.dragType;
  if (type === 'employee') {
    dragPayload = { type: 'employee', empId: parseInt(el.dataset.empId, 10) };
  } else if (type === 'bereich') {
    dragPayload = { type: 'bereich', bereichId: parseInt(el.dataset.bereichId, 10) };
  } else if (type === 'shift') {
    dragPayload = { type: 'shift', shiftId: parseInt(el.dataset.shiftId, 10) };
  } else if (type === 'vorlage') {
    dragPayload = { type: 'vorlage', vorlageId: parseInt(el.dataset.vorlageId, 10) };
  }
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', type); } catch (_) {}
  el.classList.add('dragging');
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.drop-target, .drop-target-bereich').forEach(el => {
    el.classList.remove('drop-target', 'drop-target-bereich');
  });
  dragPayload = null;
}

function onDragOver(e) {
  if (!dragPayload) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const cell = e.currentTarget;
  if (dragPayload.type === 'bereich' && !cell.dataset.addRow) {
    cell.classList.add('drop-target-bereich');
  } else {
    cell.classList.add('drop-target');
  }
}

function onDragLeave(e) {
  e.currentTarget.classList.remove('drop-target', 'drop-target-bereich');
}

async function onDrop(e) {
  e.preventDefault();
  const cell = e.currentTarget;
  cell.classList.remove('drop-target', 'drop-target-bereich');
  if (!dragPayload) return;

  const dateStr = cell.dataset.date;
  const cellEmpId = cell.dataset.empId ? parseInt(cell.dataset.empId, 10) : null;
  const isEmpCell = cell.classList.contains('emp-cell');

  try {
    if (dragPayload.type === 'employee') {
      // Pin the dragged employee — works on ANY drop target,
      // including the employee name column. No shift is created.
      state.pinnedEmployees.add(dragPayload.empId);
      dragPayload = null;
      toast(t('employee_added_to_view') || 'Employee added', 'success');
      render();
      return;
    }

    // Drops on the employee name column don't make sense for
    // non-employee payloads (no date, no day context).
    if (isEmpCell) {
      toast(t('add_employee_first') || 'Drop on a day cell to create a shift', 'error');
      return;
    }

    if (dragPayload.type === 'bereich') {
      if (cellEmpId) {
        await createNewShift(cellEmpId, dateStr, dragPayload.bereichId);
      } else {
        toast(t('add_employee_first'), 'error');
      }
    } else if (dragPayload.type === 'vorlage') {
      if (!cellEmpId) {
        toast(t('add_employee_first'), 'error');
      } else {
        const v = state.data.all_vorlagen.find(x => x.id === dragPayload.vorlageId);
        if (v) {
          let bereichId = v.bereich_id;
          if (!bereichId) {
            const emp = state.data.all_employees.find(e => e.id === cellEmpId);
            bereichId = (emp && emp.standard_bereich_id) ||
              (state.data.all_bereiche.find(b => !b.ist_abwesenheit) ||
               state.data.all_bereiche[0] || {}).id;
          }
          if (!bereichId) {
            toast(t('no_area_available'), 'error');
          } else {
            const dv = buildLocalDT(dateStr, v.start_hour, v.start_minute);
            let db = buildLocalDT(dateStr, v.end_hour, v.end_minute);
            if (db <= dv) db = new Date(db.getTime() + 24 * 3600 * 1000);
            const r = await rpc('/dienstplan/api/shift/create', {
              employee_id: cellEmpId,
              bereich_id: bereichId,
              datum_von: toServerDT(dv),
              datum_bis: toServerDT(db),
            });
            if (r && r.error) throw new Error(r.error);
            toast(t('shift_created'), 'success');
          }
        }
      }
    } else if (dragPayload.type === 'shift') {
      await moveShift(dragPayload.shiftId, cellEmpId, dateStr);
    }
  } catch (err) {
    toast(t('error_prefix') + err.message, 'error');
  } finally {
    dragPayload = null;
    await reload();
  }
}

async function createNewShift(empId, dateStr, bereichId) {
  if (!bereichId) {
    const emp = state.data.all_employees.find(e => e.id === empId);
    bereichId = (emp && emp.standard_bereich_id) ||
      (state.data.all_bereiche.find(b => !b.ist_abwesenheit) || state.data.all_bereiche[0] || {}).id;
  }
  if (!bereichId) {
    toast(t('no_area_available'), 'error');
    return;
  }
  const dv = buildLocalDT(dateStr, DEFAULT_START_H, DEFAULT_START_M);
  const db = buildLocalDT(dateStr, DEFAULT_END_H, DEFAULT_END_M);
  const r = await rpc('/dienstplan/api/shift/create', {
    employee_id: empId,
    bereich_id: bereichId,
    datum_von: toServerDT(dv),
    datum_bis: toServerDT(db),
  });
  if (r && r.error) throw new Error(r.error);
  toast(t('shift_created'), 'success');
}

async function moveShift(shiftId, newEmpId, newDateStr) {
  const orig = state.data.shifts.find(s => s.id === shiftId);
  if (!orig) return;
  const oldDv = parseServerDT(orig.datum_von);
  const oldDb = parseServerDT(orig.datum_bis);
  const newDv = buildLocalDT(newDateStr, oldDv.getHours(), oldDv.getMinutes());
  const dur = oldDb - oldDv;
  const newDb = new Date(newDv.getTime() + dur);
  const vals = {
    datum_von: toServerDT(newDv),
    datum_bis: toServerDT(newDb),
  };
  if (newEmpId && newEmpId !== orig.employee_id) {
    vals.employee_id = newEmpId;
  }
  const r = await rpc('/dienstplan/api/shift/update', { id: shiftId, vals });
  if (r && r.error) throw new Error(r.error);
  toast(t('shift_moved'), 'success');
}

// -----------------------------------------------------------
// Inline edit popover
// -----------------------------------------------------------
let popoverOpenId = null;

function openPopoverForShift(shiftEl) {
  const id = parseInt(shiftEl.dataset.shiftId, 10);
  const shift = state.data.shifts.find(s => s.id === id);
  if (!shift) return;
  popoverOpenId = id;

  const dv = parseServerDT(shift.datum_von);
  const db = parseServerDT(shift.datum_bis);

  const backdrop = document.getElementById('popover-backdrop');
  const pop = document.getElementById('popover');

  let bereichHtml = '';
  for (const b of state.data.all_bereiche) {
    const sel = b.id === shift.bereich_id ? 'selected' : '';
    bereichHtml += `<div class="pick ${sel}" data-bereich-id="${b.id}"
      style="background: linear-gradient(135deg, ${b.color}cc, ${b.color}66);"
      title="${escapeHtml(b.name)}">${escapeHtml(b.code)}</div>`;
  }

  pop.innerHTML = `
    <h4>
      <span>${escapeHtml(t('save'))}</span>
      <span class="close" id="pop-close">✕</span>
    </h4>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('areas_drag').split('·')[0].trim())}</div>
      <div class="bereich-picker" id="pop-bereich">${bereichHtml}</div>
    </div>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('from'))} – ${escapeHtml(t('to'))}</div>
      <div class="time-row">
        <input type="time" id="pop-von" class="time-input" value="${fmtTimeLocal(dv)}"/>
        <input type="time" id="pop-bis" class="time-input" value="${fmtTimeLocal(db)}"/>
      </div>
    </div>
    <div class="field-group">
      <div class="field-label">Status</div>
      <div class="state-toggle" id="pop-state">
        <button data-state="draft" class="${shift.state === 'draft' ? 'active' : ''}">${escapeHtml(I18N.draft || 'Draft')}</button>
        <button data-state="published" class="${shift.state === 'published' ? 'active' : ''}">${escapeHtml(I18N.published || 'Published')}</button>
      </div>
    </div>
    <div class="popover-actions">
      <button class="btn btn-del" id="pop-del" title="${escapeHtml(t('delete'))}">🗑</button>
      <button class="btn" id="pop-cancel">${escapeHtml(t('cancel'))}</button>
      <button class="btn btn-primary" id="pop-save">${escapeHtml(t('save'))}</button>
    </div>
  `;

  const r = shiftEl.getBoundingClientRect();
  const popW = 340;
  let left = r.right + 12;
  let top = r.top;
  if (left + popW > window.innerWidth - 16) left = r.left - popW - 12;
  if (left < 16) left = Math.max(16, r.left);
  if (top + 360 > window.innerHeight - 16) top = window.innerHeight - 360 - 16;
  if (top < 16) top = 16;
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';

  backdrop.classList.add('show');
  pop.classList.add('show');

  let selectedBereichId = shift.bereich_id;
  pop.querySelectorAll('#pop-bereich .pick').forEach(p => {
    p.addEventListener('click', () => {
      pop.querySelectorAll('#pop-bereich .pick').forEach(x => x.classList.remove('selected'));
      p.classList.add('selected');
      selectedBereichId = parseInt(p.dataset.bereichId, 10);
    });
  });
  let selectedState = shift.state;
  pop.querySelectorAll('#pop-state button').forEach(b => {
    b.addEventListener('click', () => {
      pop.querySelectorAll('#pop-state button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      selectedState = b.dataset.state;
    });
  });

  document.getElementById('pop-close').addEventListener('click', closePopover);
  document.getElementById('pop-cancel').addEventListener('click', closePopover);
  backdrop.addEventListener('click', closePopover, { once: true });

  document.getElementById('pop-del').addEventListener('click', async () => {
    if (!confirm(t('confirm_delete'))) return;
    try {
      const res = await rpc('/dienstplan/api/shift/delete', { id });
      if (res && res.error) throw new Error(res.error);
      toast(t('shift_deleted'), 'success');
      closePopover();
      await reload();
    } catch (err) {
      toast(t('error_prefix') + err.message, 'error');
    }
  });

  document.getElementById('pop-save').addEventListener('click', async () => {
    const von = document.getElementById('pop-von').value;
    const bis = document.getElementById('pop-bis').value;
    if (!von || !bis) { toast(t('time_incomplete'), 'error'); return; }
    const dateStr = dayKey(dv);
    const [vh, vm] = von.split(':').map(Number);
    const [bh, bm] = bis.split(':').map(Number);
    const newDv = buildLocalDT(dateStr, vh, vm);
    let newDb = buildLocalDT(dateStr, bh, bm);
    if (newDb <= newDv) {
      newDb = new Date(newDb.getTime() + 24 * 3600 * 1000);
    }
    try {
      const res = await rpc('/dienstplan/api/shift/update', {
        id,
        vals: {
          bereich_id: selectedBereichId,
          datum_von: toServerDT(newDv),
          datum_bis: toServerDT(newDb),
          state: selectedState,
        },
      });
      if (res && res.error) throw new Error(res.error);
      toast(t('save'), 'success');
      closePopover();
      await reload();
    } catch (err) {
      toast(t('error_prefix') + err.message, 'error');
    }
  });
}

function closePopover() {
  const pop = document.getElementById('popover');
  pop.classList.remove('show');
  document.getElementById('popover-backdrop').classList.remove('show');
  pop.style.transform = '';
  popoverOpenId = null;
}

document.addEventListener('click', e => {
  // 0. Click on the × button in an employee row → clear all their shifts in this view
  const removeBtn = e.target.closest('.emp-remove[data-emp-id]');
  if (removeBtn) {
    e.preventDefault();
    e.stopPropagation();
    const eid = parseInt(removeBtn.dataset.empId, 10);
    clearEmployeePeriod(eid);
    return;
  }
  // 1. Click on an existing shift → open edit popover
  const shiftEl = e.target.closest('.shift[data-shift-id]');
  if (shiftEl && !shiftEl.classList.contains('dragging')) {
    openPopoverForShift(shiftEl);
    return;
  }
  // 2. Click on an absence/leave entry → open absence dialog (info + delete)
  const leaveEl = e.target.closest('.shift.is-leave[data-leave-id]');
  if (leaveEl) {
    const lid = parseInt(leaveEl.dataset.leaveId, 10);
    const leave = state.data && state.data.leaves.find(l => l.id === lid);
    if (leave) openAbsencePopover(leave);
    return;
  }
  // 2b. Click on an employee chip in the sidebar → edit/delete employee
  const empChip = e.target.closest('.emp-chip[data-emp-id]');
  if (empChip && !empChip.classList.contains('dragging')) {
    const eid = parseInt(empChip.dataset.empId, 10);
    const emp = state.data && state.data.all_employees.find(x => x.id === eid);
    if (emp) openEditEmployeePopover(emp);
    return;
  }
  // 3. Click on an area chip in the sidebar → edit/delete area
  const bereichChip = e.target.closest('.bereich-chip[data-bereich-id]');
  if (bereichChip && !bereichChip.classList.contains('dragging')) {
    const bid = parseInt(bereichChip.dataset.bereichId, 10);
    const bereich = state.data && state.data.all_bereiche.find(b => b.id === bid);
    if (bereich) openEditBereichPopover(bereich);
    return;
  }
  // 3b. Click on a template chip in the sidebar → edit/delete template
  const vorlageChip = e.target.closest('.vorlage-chip[data-vorlage-id]');
  if (vorlageChip && !vorlageChip.classList.contains('dragging')) {
    const vid = parseInt(vorlageChip.dataset.vorlageId, 10);
    const vorlage = state.data && state.data.all_vorlagen.find(v => v.id === vid);
    if (vorlage) openEditVorlagePopover(vorlage);
    return;
  }
  // 4. Click on the bottom "+ new shift" row → create dialog with date pre-filled
  const addRowCell = e.target.closest('.day-cell[data-add-row="1"]');
  if (addRowCell) {
    const date = addRowCell.dataset.date;
    openCreateShiftPopover(date);
    return;
  }
  // 5. Click on a month-view cell → create dialog with that date pre-filled
  const monthCell = e.target.closest('.month-cell[data-date]');
  if (monthCell && !e.target.closest('.month-chip')) {
    openCreateShiftPopover(monthCell.dataset.date);
    return;
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && popoverOpenId) closePopover();
});

// -----------------------------------------------------------
// Manual creation popovers (centered modal-style)
// -----------------------------------------------------------
function openCenteredPopover(innerHtml) {
  const backdrop = document.getElementById('popover-backdrop');
  const pop = document.getElementById('popover');
  pop.innerHTML = innerHtml;
  // Position centered (override any inline left/top from shift popover)
  pop.style.left = '50%';
  pop.style.top = '50%';
  pop.style.transform = 'translate(-50%, -50%)';
  popoverOpenId = '__create__';
  backdrop.classList.add('show');
  pop.classList.add('show');
  const close = () => {
    pop.classList.remove('show');
    backdrop.classList.remove('show');
    pop.style.transform = '';
    popoverOpenId = null;
  };
  backdrop.addEventListener('click', close, { once: true });
  return close;
}

function openCreateShiftPopover(prefillDate, prefillEmpId) {
  if (!state.data) return;
  if (!state.data.all_employees.length) { toast(t('add_employee_first'), 'error'); return; }
  if (!state.data.all_bereiche.length)   { toast(t('no_area_available'), 'error'); return; }

  const empOpts = state.data.all_employees
    .map(e => {
      const sel = (prefillEmpId && Number(e.id) === Number(prefillEmpId)) ? 'selected' : '';
      return `<option value="${e.id}" ${sel}>${escapeHtml(e.name)}</option>`;
    }).join('');

  // Build day options from the loaded period (covers day/week/month).
  // Falls back to today if no period is loaded.
  const dayList = (state.data.days && state.data.days.length)
    ? state.data.days
    : [new Date().toISOString().slice(0, 10)];
  const dayOpts = dayList.map(iso => {
    const d = parseISODate(iso);
    const dowKey = DAY_KEYS[(d.getDay() + 6) % 7];
    const label = `${t(dowKey)} ${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.`;
    const sel = prefillDate === iso ? 'selected' : '';
    return `<option value="${iso}" ${sel}>${escapeHtml(label)}</option>`;
  }).join('');

  const bereichOpts = state.data.all_bereiche
    .map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');

  const html = `
    <h4><span>${escapeHtml(t('add_shift'))}</span><span class="close" id="cp-close">✕</span></h4>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('select_employee'))}</div>
      <select id="cp-emp" class="time-input" style="width:100%;">${empOpts}</select>
    </div>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('select_day'))}</div>
      <select id="cp-day" class="time-input" style="width:100%;">${dayOpts}</select>
    </div>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('select_area'))}</div>
      <select id="cp-bereich" class="time-input" style="width:100%;">${bereichOpts}</select>
    </div>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('from'))} – ${escapeHtml(t('to'))}</div>
      <div class="time-row">
        <input type="time" id="cp-von" class="time-input" value="${String(DEFAULT_START_H).padStart(2,'0')}:${String(DEFAULT_START_M).padStart(2,'0')}"/>
        <input type="time" id="cp-bis" class="time-input" value="${String(DEFAULT_END_H).padStart(2,'0')}:${String(DEFAULT_END_M).padStart(2,'0')}"/>
      </div>
    </div>
    <div class="popover-actions">
      <button class="btn" id="cp-cancel">${escapeHtml(t('cancel'))}</button>
      <button class="btn btn-primary" id="cp-save">${escapeHtml(t('create'))}</button>
    </div>`;
  const close = openCenteredPopover(html);
  document.getElementById('cp-close').addEventListener('click', close);
  document.getElementById('cp-cancel').addEventListener('click', close);
  document.getElementById('cp-save').addEventListener('click', async () => {
    const empId = parseInt(document.getElementById('cp-emp').value, 10);
    const dateStr = document.getElementById('cp-day').value;
    const bereichId = parseInt(document.getElementById('cp-bereich').value, 10);
    const von = document.getElementById('cp-von').value;
    const bis = document.getElementById('cp-bis').value;
    if (!von || !bis) { toast(t('time_incomplete'), 'error'); return; }
    const [vh, vm] = von.split(':').map(Number);
    const [bh, bm] = bis.split(':').map(Number);
    const dv = buildLocalDT(dateStr, vh, vm);
    let db = buildLocalDT(dateStr, bh, bm);
    if (db <= dv) db = new Date(db.getTime() + 24 * 3600 * 1000);
    try {
      const r = await rpc('/dienstplan/api/shift/create', {
        employee_id: empId,
        bereich_id: bereichId,
        datum_von: toServerDT(dv),
        datum_bis: toServerDT(db),
      });
      if (r && r.error) throw new Error(r.error);
      toast(t('shift_created'), 'success');
      close();
      await reload();
    } catch (err) {
      toast(t('error_prefix') + err.message, 'error');
    }
  });
}

function openCreateEmployeePopover() {
  if (!state.data) return;
  const bereichOpts = ['<option value="">—</option>'].concat(
    state.data.all_bereiche.filter(b => !b.ist_abwesenheit)
      .map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`)
  ).join('');
  const html = `
    <h4><span>${escapeHtml(t('add_employee'))}</span><span class="close" id="cp-close">✕</span></h4>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('mitarbeiter'))} *</div>
      <input type="text" id="cp-name" class="time-input" style="width:100%;" placeholder="${escapeHtml(t('mitarbeiter'))}"/>
    </div>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('work_email'))}</div>
      <input type="email" id="cp-email" class="time-input" style="width:100%;" placeholder="name@example.com"/>
    </div>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('default_area'))}</div>
      <select id="cp-bereich" class="time-input" style="width:100%;">${bereichOpts}</select>
    </div>
    <div class="popover-actions">
      <button class="btn" id="cp-cancel">${escapeHtml(t('cancel'))}</button>
      <button class="btn btn-primary" id="cp-save">${escapeHtml(t('create'))}</button>
    </div>`;
  const close = openCenteredPopover(html);
  document.getElementById('cp-close').addEventListener('click', close);
  document.getElementById('cp-cancel').addEventListener('click', close);
  document.getElementById('cp-name').focus();
  document.getElementById('cp-save').addEventListener('click', async () => {
    const name = document.getElementById('cp-name').value.trim();
    const email = document.getElementById('cp-email').value.trim();
    const bereichVal = document.getElementById('cp-bereich').value;
    if (!name) { toast(t('name_required'), 'error'); return; }
    try {
      const r = await rpc('/dienstplan/api/employee/create', {
        name,
        work_email: email || null,
        standard_bereich_id: bereichVal ? parseInt(bereichVal, 10) : null,
      });
      if (r && r.error) throw new Error(r.error);
      toast(t('employee_created'), 'success');
      close();
      await reload();
    } catch (err) {
      toast(t('error_prefix') + err.message, 'error');
    }
  });
}

function openEditEmployeePopover(emp) {
  if (!state.data) return;
  const bereichOpts = ['<option value="">—</option>'].concat(
    state.data.all_bereiche.filter(b => !b.ist_abwesenheit)
      .map(b => {
        const sel = emp.standard_bereich_id === b.id ? ' selected' : '';
        return `<option value="${b.id}"${sel}>${escapeHtml(b.name)}</option>`;
      })
  ).join('');
  const html = `
    <h4><span>${escapeHtml(t('edit_employee'))}</span><span class="close" id="cp-close">✕</span></h4>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('mitarbeiter'))} *</div>
      <input type="text" id="cp-name" class="time-input" style="width:100%;" value="${escapeHtml(emp.name || '')}"/>
    </div>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('work_email'))}</div>
      <input type="email" id="cp-email" class="time-input" style="width:100%;" value="${escapeHtml(emp.work_email || '')}" placeholder="name@example.com"/>
    </div>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('default_area'))}</div>
      <select id="cp-bereich" class="time-input" style="width:100%;">${bereichOpts}</select>
    </div>
    <div class="popover-actions">
      <button class="btn btn-del" id="cp-del" title="${escapeHtml(t('delete'))}">🗑</button>
      <button class="btn" id="cp-cancel">${escapeHtml(t('cancel'))}</button>
      <button class="btn btn-primary" id="cp-save">${escapeHtml(t('save'))}</button>
    </div>`;
  const close = openCenteredPopover(html);
  document.getElementById('cp-close').addEventListener('click', close);
  document.getElementById('cp-cancel').addEventListener('click', close);

  // Save (update)
  document.getElementById('cp-save').addEventListener('click', async () => {
    const name = document.getElementById('cp-name').value.trim();
    const email = document.getElementById('cp-email').value.trim();
    const bereichVal = document.getElementById('cp-bereich').value;
    if (!name) { toast(t('name_required'), 'error'); return; }
    try {
      const r = await rpc('/dienstplan/api/employee/update', {
        id: emp.id,
        vals: {
          name,
          work_email: email || '',
          standard_bereich_id: bereichVal ? parseInt(bereichVal, 10) : null,
        },
      });
      if (r && r.error) throw new Error(r.error);
      toast(t('employee_updated'), 'success');
      close();
      await reload();
    } catch (err) {
      toast(t('error_prefix') + err.message, 'error');
    }
  });

  // Delete (with confirmation)
  document.getElementById('cp-del').addEventListener('click', async () => {
    if (!confirm(t('confirm_delete_employee').replace('%s', emp.name || ''))) return;
    try {
      const r = await rpc('/dienstplan/api/employee/delete', { id: emp.id });
      if (r && r.error) throw new Error(r.error);
      if (r && r.archived) {
        toast(t('employee_archived'), 'success');
      } else {
        toast(t('employee_deleted'), 'success');
      }
      close();
      await reload();
    } catch (err) {
      toast(t('error_prefix') + err.message, 'error');
    }
  });
}

// Clear all of one employee's shifts in the current view.
// Also un-pins them so the empty row disappears.
async function clearEmployeePeriod(empId) {
  if (!empId) return;
  const emp = state.data && state.data.all_employees.find(x => x.id === empId);
  if (!emp) return;
  const n = (state.data.shifts || []).filter(s => s.employee_id === empId).length;
  // No shifts → just un-pin (no confirm dialog).
  if (!n) {
    if (state.pinnedEmployees.has(empId)) {
      state.pinnedEmployees.delete(empId);
      render();
      return;
    }
    toast(t('nothing_to_clear') || 'Nothing to clear', 'info');
    return;
  }
  const msg = (t('confirm_clear_period') || 'Remove %(name)s from this view? %(n)s shift(s) will be deleted.')
    .replace('%(name)s', emp.name || '')
    .replace('%(n)s', String(n));
  if (!confirm(msg)) return;
  try {
    const r = await rpc('/dienstplan/api/shift/clear_period', {
      employee_id: empId,
      offset: state.offset,
      view_mode: state.viewMode || 'week',
    });
    if (r && r.error) throw new Error(r.error);
    state.pinnedEmployees.delete(empId);
    toast((t('period_cleared') || 'Cleared %(n)s shift(s)').replace('%(n)s', String(r.deleted || 0)), 'success');
    await reload();
  } catch (err) {
    toast(t('error_prefix') + err.message, 'error');
  }
}

function openCreateBereichPopover() {
  // 16-color palette tuned for the dark dashboard theme.
  // Two rows of 8: warm spectrum on top, cool spectrum on bottom.
  const presetColors = [
    // Warm row
    '#ef4444', '#f97316', '#f59e0b', '#eab308',
    '#84cc16', '#22c55e', '#10b981', '#14b8a6',
    // Cool row
    '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
    '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  ];
  // Auto-pick: choose the first color in the palette that isn't already
  // used by an existing area, so consecutive new areas come out distinct.
  // Fall back to round-robin only when all 16 colors are taken.
  const usedColors = new Set(
    ((state.data && state.data.all_bereiche) || [])
      .map(b => (b.color || '').toLowerCase())
  );
  let defaultColorIdx = presetColors.findIndex(
    c => !usedColors.has(c.toLowerCase())
  );
  if (defaultColorIdx === -1) {
    const existingCount = (state.data && state.data.all_bereiche)
      ? state.data.all_bereiche.length : 0;
    defaultColorIdx = existingCount % presetColors.length;
  }
  const defaultColor = presetColors[defaultColorIdx];

  const colorPalette = presetColors.map((c, i) =>
    `<div class="color-swatch${i === defaultColorIdx ? ' selected' : ''}"
          data-color="${c}" style="background:${c};" title="${c}"></div>`
  ).join('');

  const html = `
    <h4><span>${escapeHtml(t('add_area'))}</span><span class="close" id="cp-close">✕</span></h4>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('mitarbeiter') === 'Employee' ? 'Name' : t('mitarbeiter'))} *</div>
      <input type="text" id="cp-name" class="time-input" style="width:100%;" placeholder="e.g. Picking B2C"/>
    </div>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('short_code_optional'))}</div>
      <input type="text" id="cp-code" class="time-input" style="width:100%;" placeholder="PICK-B2C" maxlength="16"/>
    </div>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('color'))}</div>
      <div class="color-picker" id="cp-colors">${colorPalette}</div>
      <input type="hidden" id="cp-color" value="${defaultColor}"/>
    </div>
    <div class="field-group" style="display:flex;align-items:center;gap:8px;">
      <input type="checkbox" id="cp-absence" style="width:auto;"/>
      <label for="cp-absence" style="font-size:0.85em;cursor:pointer;">${escapeHtml(t('is_absence_type'))}</label>
    </div>
    <div class="popover-actions">
      <button class="btn" id="cp-cancel">${escapeHtml(t('cancel'))}</button>
      <button class="btn btn-primary" id="cp-save">${escapeHtml(t('create'))}</button>
    </div>`;
  const close = openCenteredPopover(html);
  document.getElementById('cp-close').addEventListener('click', close);
  document.getElementById('cp-cancel').addEventListener('click', close);
  document.getElementById('cp-name').focus();
  document.querySelectorAll('#cp-colors .color-swatch').forEach(s => {
    s.addEventListener('click', () => {
      document.querySelectorAll('#cp-colors .color-swatch').forEach(x => x.classList.remove('selected'));
      s.classList.add('selected');
      document.getElementById('cp-color').value = s.dataset.color;
    });
  });
  document.getElementById('cp-save').addEventListener('click', async () => {
    const name = document.getElementById('cp-name').value.trim();
    const code = document.getElementById('cp-code').value.trim();
    const color = document.getElementById('cp-color').value;
    const isAbs = document.getElementById('cp-absence').checked;
    if (!name) { toast(t('name_required'), 'error'); return; }
    try {
      const r = await rpc('/dienstplan/api/bereich/create', {
        name,
        code: code || null,
        html_color: color,
        ist_abwesenheit: isAbs,
      });
      if (r && r.error) throw new Error(r.error);
      toast(t('area_created'), 'success');
      close();
      await reload();
    } catch (err) {
      toast(t('error_prefix') + err.message, 'error');
    }
  });
}

function openEditBereichPopover(bereich) {
  // Same 16-color palette as create dialog
  const presetColors = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308',
    '#84cc16', '#22c55e', '#10b981', '#14b8a6',
    '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
    '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  ];
  const currentColor = (bereich.color || '#3b82f6').toLowerCase();
  const colorPalette = presetColors.map(c => {
    const sel = c.toLowerCase() === currentColor ? ' selected' : '';
    return `<div class="color-swatch${sel}" data-color="${c}" style="background:${c};" title="${c}"></div>`;
  }).join('');

  const html = `
    <h4><span>${escapeHtml(t('edit_area'))}</span><span class="close" id="cp-close">✕</span></h4>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('mitarbeiter') === 'Employee' ? 'Name' : t('mitarbeiter'))} *</div>
      <input type="text" id="cp-name" class="time-input" style="width:100%;" value="${escapeHtml(bereich.name || '')}"/>
    </div>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('short_code_optional'))}</div>
      <input type="text" id="cp-code" class="time-input" style="width:100%;" value="${escapeHtml(bereich.code || '')}" maxlength="16"/>
    </div>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('color'))}</div>
      <div class="color-picker" id="cp-colors">${colorPalette}</div>
      <input type="hidden" id="cp-color" value="${currentColor}"/>
    </div>
    <div class="field-group" style="display:flex;align-items:center;gap:8px;">
      <input type="checkbox" id="cp-absence" style="width:auto;" ${bereich.ist_abwesenheit ? 'checked' : ''}/>
      <label for="cp-absence" style="font-size:0.85em;cursor:pointer;">${escapeHtml(t('is_absence_type'))}</label>
    </div>
    <div class="popover-actions">
      <button class="btn btn-del" id="cp-del" title="${escapeHtml(t('delete'))}">🗑</button>
      <button class="btn" id="cp-cancel">${escapeHtml(t('cancel'))}</button>
      <button class="btn btn-primary" id="cp-save">${escapeHtml(t('save'))}</button>
    </div>`;
  const close = openCenteredPopover(html);
  document.getElementById('cp-close').addEventListener('click', close);
  document.getElementById('cp-cancel').addEventListener('click', close);

  // Color picker
  document.querySelectorAll('#cp-colors .color-swatch').forEach(s => {
    s.addEventListener('click', () => {
      document.querySelectorAll('#cp-colors .color-swatch').forEach(x => x.classList.remove('selected'));
      s.classList.add('selected');
      document.getElementById('cp-color').value = s.dataset.color;
    });
  });

  // Save (update)
  document.getElementById('cp-save').addEventListener('click', async () => {
    const name = document.getElementById('cp-name').value.trim();
    const code = document.getElementById('cp-code').value.trim();
    const color = document.getElementById('cp-color').value;
    const isAbs = document.getElementById('cp-absence').checked;
    if (!name) { toast(t('name_required'), 'error'); return; }
    try {
      const r = await rpc('/dienstplan/api/bereich/update', {
        id: bereich.id,
        vals: {
          name,
          code: code,            // empty string is fine — backend keeps if blank
          html_color: color,
          ist_abwesenheit: isAbs,
        },
      });
      if (r && r.error) throw new Error(r.error);
      toast(t('area_updated'), 'success');
      close();
      await reload();
    } catch (err) {
      toast(t('error_prefix') + err.message, 'error');
    }
  });

  // Delete (with confirmation; backend archives instead of unlinking
  // when shifts reference the area)
  document.getElementById('cp-del').addEventListener('click', async () => {
    if (!confirm(t('confirm_delete_area').replace('%s', bereich.name || ''))) return;
    try {
      const r = await rpc('/dienstplan/api/bereich/delete', { id: bereich.id });
      if (r && r.error) throw new Error(r.error);
      if (r && r.archived) {
        toast(t('area_archived'), 'success');
      } else {
        toast(t('area_deleted'), 'success');
      }
      close();
      await reload();
    } catch (err) {
      toast(t('error_prefix') + err.message, 'error');
    }
  });
}

// ---- Shift Template (Vorlage) popovers --------------------------
function _vorlagePresetColors() {
  return [
    '#ef4444', '#f97316', '#f59e0b', '#eab308',
    '#84cc16', '#22c55e', '#10b981', '#14b8a6',
    '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
    '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  ];
}

function _vorlageTimeOpts(selectedH, selectedM) {
  // Build hour:minute select options in 15-minute steps from 00:00 to 23:45.
  const opts = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      const v = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      const sel = (h === selectedH && m === selectedM) ? 'selected' : '';
      opts.push(`<option value="${v}" ${sel}>${v}</option>`);
    }
  }
  return opts.join('');
}

function _vorlageBereichOpts(selectedId) {
  const opts = [`<option value="">— ${escapeHtml(t('select_area'))} —</option>`];
  for (const b of state.data.all_bereiche) {
    if (b.ist_abwesenheit) continue; // never use absence as template area
    const sel = (Number(selectedId) === b.id) ? 'selected' : '';
    opts.push(`<option value="${b.id}" ${sel}>${escapeHtml(b.name)}</option>`);
  }
  return opts.join('');
}

function openCreateVorlagePopover() {
  if (!state.data) return;

  const presetColors = _vorlagePresetColors();
  const usedColors = new Set(
    (state.data.all_vorlagen || []).map(v => (v.color || '').toLowerCase())
  );
  let defaultColorIdx = presetColors.findIndex(c => !usedColors.has(c.toLowerCase()));
  if (defaultColorIdx === -1) {
    defaultColorIdx = (state.data.all_vorlagen || []).length % presetColors.length;
  }
  const defaultColor = presetColors[defaultColorIdx];

  const colorPalette = presetColors.map((c, i) =>
    `<div class="color-swatch${i === defaultColorIdx ? ' selected' : ''}"
          data-color="${c}" style="background:${c};" title="${c}"></div>`
  ).join('');

  const html = `
    <h4><span>${escapeHtml(t('add_template'))}</span><span class="close" id="cp-close">✕</span></h4>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('mitarbeiter') === 'Employee' ? 'Name' : t('mitarbeiter'))} *</div>
      <input type="text" id="cp-name" class="time-input" style="width:100%;" placeholder="e.g. Early shift"/>
    </div>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('select_area'))} (${escapeHtml(t('optional'))})</div>
      <select id="cp-bereich" class="time-input" style="width:100%;">
        ${_vorlageBereichOpts(null)}
      </select>
    </div>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('from'))} – ${escapeHtml(t('to'))}</div>
      <div class="time-row">
        <select id="cp-von" class="time-input">${_vorlageTimeOpts(8, 0)}</select>
        <select id="cp-bis" class="time-input">${_vorlageTimeOpts(16, 30)}</select>
      </div>
    </div>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('color'))}</div>
      <div class="color-picker" id="cp-colors">${colorPalette}</div>
      <input type="hidden" id="cp-color" value="${defaultColor}"/>
    </div>
    <div class="popover-actions">
      <button class="btn" id="cp-cancel">${escapeHtml(t('cancel'))}</button>
      <button class="btn btn-primary" id="cp-save">${escapeHtml(t('create'))}</button>
    </div>`;
  const close = openCenteredPopover(html);
  document.getElementById('cp-close').addEventListener('click', close);
  document.getElementById('cp-cancel').addEventListener('click', close);
  document.getElementById('cp-name').focus();

  document.querySelectorAll('#cp-colors .color-swatch').forEach(s => {
    s.addEventListener('click', () => {
      document.querySelectorAll('#cp-colors .color-swatch').forEach(x => x.classList.remove('selected'));
      s.classList.add('selected');
      document.getElementById('cp-color').value = s.dataset.color;
    });
  });

  document.getElementById('cp-save').addEventListener('click', async () => {
    const name = document.getElementById('cp-name').value.trim();
    const bereichVal = document.getElementById('cp-bereich').value;
    const von = document.getElementById('cp-von').value;
    const bis = document.getElementById('cp-bis').value;
    const color = document.getElementById('cp-color').value;
    if (!name) { toast(t('name_required'), 'error'); return; }
    const [vh, vm] = von.split(':').map(Number);
    const [bh, bm] = bis.split(':').map(Number);
    try {
      const r = await rpc('/dienstplan/api/vorlage/create', {
        name,
        bereich_id: bereichVal ? parseInt(bereichVal, 10) : null,
        start_hour: vh, start_minute: vm,
        end_hour: bh, end_minute: bm,
        html_color: color,
      });
      if (r && r.error) throw new Error(r.error);
      toast(t('template_created'), 'success');
      close();
      await reload();
    } catch (err) {
      toast(t('error_prefix') + err.message, 'error');
    }
  });
}

function openEditVorlagePopover(vorlage) {
  const presetColors = _vorlagePresetColors();
  const currentColor = (vorlage.color || '#3b82f6').toLowerCase();
  const colorPalette = presetColors.map(c => {
    const sel = c.toLowerCase() === currentColor ? ' selected' : '';
    return `<div class="color-swatch${sel}" data-color="${c}" style="background:${c};" title="${c}"></div>`;
  }).join('');

  const html = `
    <h4><span>${escapeHtml(t('edit_template'))}</span><span class="close" id="cp-close">✕</span></h4>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('mitarbeiter') === 'Employee' ? 'Name' : t('mitarbeiter'))} *</div>
      <input type="text" id="cp-name" class="time-input" style="width:100%;" value="${escapeHtml(vorlage.name || '')}"/>
    </div>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('select_area'))} (${escapeHtml(t('optional'))})</div>
      <select id="cp-bereich" class="time-input" style="width:100%;">
        ${_vorlageBereichOpts(vorlage.bereich_id)}
      </select>
    </div>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('from'))} – ${escapeHtml(t('to'))}</div>
      <div class="time-row">
        <select id="cp-von" class="time-input">${_vorlageTimeOpts(vorlage.start_hour, vorlage.start_minute)}</select>
        <select id="cp-bis" class="time-input">${_vorlageTimeOpts(vorlage.end_hour, vorlage.end_minute)}</select>
      </div>
    </div>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('color'))}</div>
      <div class="color-picker" id="cp-colors">${colorPalette}</div>
      <input type="hidden" id="cp-color" value="${currentColor}"/>
    </div>
    <div class="popover-actions">
      <button class="btn btn-del" id="cp-del" title="${escapeHtml(t('delete'))}">🗑</button>
      <button class="btn" id="cp-cancel">${escapeHtml(t('cancel'))}</button>
      <button class="btn btn-primary" id="cp-save">${escapeHtml(t('save'))}</button>
    </div>`;
  const close = openCenteredPopover(html);
  document.getElementById('cp-close').addEventListener('click', close);
  document.getElementById('cp-cancel').addEventListener('click', close);

  document.querySelectorAll('#cp-colors .color-swatch').forEach(s => {
    s.addEventListener('click', () => {
      document.querySelectorAll('#cp-colors .color-swatch').forEach(x => x.classList.remove('selected'));
      s.classList.add('selected');
      document.getElementById('cp-color').value = s.dataset.color;
    });
  });

  document.getElementById('cp-save').addEventListener('click', async () => {
    const name = document.getElementById('cp-name').value.trim();
    const bereichVal = document.getElementById('cp-bereich').value;
    const von = document.getElementById('cp-von').value;
    const bis = document.getElementById('cp-bis').value;
    const color = document.getElementById('cp-color').value;
    if (!name) { toast(t('name_required'), 'error'); return; }
    const [vh, vm] = von.split(':').map(Number);
    const [bh, bm] = bis.split(':').map(Number);
    try {
      const r = await rpc('/dienstplan/api/vorlage/update', {
        id: vorlage.id,
        vals: {
          name,
          bereich_id: bereichVal ? parseInt(bereichVal, 10) : false,
          start_hour: vh, start_minute: vm,
          end_hour: bh, end_minute: bm,
          html_color: color,
        },
      });
      if (r && r.error) throw new Error(r.error);
      toast(t('template_updated'), 'success');
      close();
      await reload();
    } catch (err) {
      toast(t('error_prefix') + err.message, 'error');
    }
  });

  document.getElementById('cp-del').addEventListener('click', async () => {
    if (!confirm(t('confirm_delete_template').replace('%s', vorlage.name || ''))) return;
    try {
      const r = await rpc('/dienstplan/api/vorlage/delete', { id: vorlage.id });
      if (r && r.error) throw new Error(r.error);
      toast(t('template_deleted'), 'success');
      close();
      await reload();
    } catch (err) {
      toast(t('error_prefix') + err.message, 'error');
    }
  });
}

function openAbsencePopover(leave) {
  const empName = (state.data.all_employees.find(e => e.id === leave.employee_id) || {}).name || '';
  const dFrom = parseServerDT(leave.date_from);
  const dTo = parseServerDT(leave.date_to);
  const fmt = dt => `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`;
  const sameDay = dFrom.toDateString() === dTo.toDateString();
  const rangeLabel = sameDay
    ? fmt(dFrom)
    : `${fmt(dFrom)} – ${fmt(dTo)}`;

  const html = `
    <h4><span>${escapeHtml(t('absence'))}</span><span class="close" id="cp-close">✕</span></h4>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('mitarbeiter'))}</div>
      <div class="time-input" style="background:rgba(255,255,255,0.02);">${escapeHtml(empName)}</div>
    </div>
    <div class="field-group">
      <div class="field-label">${escapeHtml(t('from'))} – ${escapeHtml(t('to'))}</div>
      <div class="time-input" style="background:rgba(255,255,255,0.02);">${escapeHtml(rangeLabel)}</div>
    </div>
    <div class="field-group" style="font-size:0.78em;color:var(--text-muted);line-height:1.5;">
      ${escapeHtml(t('absence_managed_in_hr'))}
    </div>
    <div class="popover-actions">
      <button class="btn btn-del" id="cp-del" title="${escapeHtml(t('delete'))}">🗑</button>
      <button class="btn" id="cp-cancel">${escapeHtml(t('cancel'))}</button>
    </div>`;
  const close = openCenteredPopover(html);
  document.getElementById('cp-close').addEventListener('click', close);
  document.getElementById('cp-cancel').addEventListener('click', close);
  document.getElementById('cp-del').addEventListener('click', async () => {
    if (!confirm(t('confirm_delete_absence').replace('%s', empName))) return;
    try {
      const r = await rpc('/dienstplan/api/leave/delete', { id: leave.id });
      if (r && r.error) throw new Error(r.error);
      toast(t('absence_deleted'), 'success');
      close();
      await reload();
    } catch (err) {
      toast(t('error_prefix') + err.message, 'error');
    }
  });
}

// -----------------------------------------------------------
// Card popovers: Planned Hours, Absences, Schedule Health
// All three share the same .card-popover shell so the design
// stays consistent across the dashboard.
// -----------------------------------------------------------

function _scrollAndFlashShift(shiftId) {
  // Defer to next frame so any popover-close animation finishes first.
  setTimeout(() => {
    const el = document.querySelector('.shift[data-shift-id="' + shiftId + '"]');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('shift-flash');
    setTimeout(() => el.classList.remove('shift-flash'), 2400);
  }, 80);
}

function _scrollToEmployeeRow(empId) {
  setTimeout(() => {
    const el = document.querySelector('.pl-row[data-emp-id="' + empId + '"]');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('row-flash');
    setTimeout(() => el.classList.remove('row-flash'), 2400);
  }, 80);
}

function _scrollToDate(dateStr) {
  setTimeout(() => {
    const cells = document.querySelectorAll('.day-cell[data-date="' + dateStr + '"]');
    if (!cells.length) return;
    cells[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    cells.forEach(c => {
      c.classList.add('cell-flash');
      setTimeout(() => c.classList.remove('cell-flash'), 2400);
    });
  }, 80);
}

// =========================================================
// Card popover 1: Planned Hours — workload breakdown
// =========================================================
function openPlannedHoursPopover() {
  if (!state.data) return;
  const d = state.data;
  const periodDays = (d.days && d.days.length) || 7;

  // Compute totals using the same logic as renderStats
  let totalH = 0;
  const perEmpH = {};
  for (const s of d.shifts) {
    if (s.is_leave) continue;
    const dv = parseServerDT(s.datum_von);
    const db = parseServerDT(s.datum_bis);
    const h = (db - dv) / 3600000;
    totalH += h;
    perEmpH[s.employee_id] = (perEmpH[s.employee_id] || 0) + h;
  }
  const activeEmpIds = new Set();
  for (const s of d.shifts) activeEmpIds.add(s.employee_id);
  for (const l of d.leaves) activeEmpIds.add(l.employee_id);
  const activeEmployees = d.all_employees.filter(e => activeEmpIds.has(e.id));
  const weeklyTargetH = activeEmployees.reduce(
    (sum, e) => sum + (e.weekly_hours_target || 40), 0);
  const targetH = Math.round(weeklyTargetH * (periodDays / 7));
  const overallPct = targetH > 0 ? Math.round((totalH / targetH) * 100) : 0;
  const gap = Math.round(totalH - targetH);

  // Build per-employee rows
  const rows = activeEmployees.map(e => {
    const tgt = Math.round((e.weekly_hours_target || 40) * (periodDays / 7));
    const planned = Math.round(perEmpH[e.id] || 0);
    const pct = tgt > 0 ? Math.round((planned / tgt) * 100) : 0;
    return { emp: e, planned, target: tgt, pct };
  }).sort((a, b) => b.pct - a.pct);

  const cls = p => p >= 100 ? 'over' : p >= 50 ? 'good' : 'under';
  const rowsHtml = rows.map(r => `
    <button type="button" class="cp-row" data-emp-id="${r.emp.id}">
      <div class="avatar ${r.emp.avatar_class}">${escapeHtml(r.emp.initials)}</div>
      <div class="cp-row-name">
        <div class="cp-name">${escapeHtml(r.emp.name)}</div>
        <div class="cp-role">${escapeHtml(r.emp.role || '')}</div>
      </div>
      <div class="cp-bar-wrap">
        <span class="cp-hours">${r.planned}/${r.target}h</span>
        <div class="cp-bar"><i class="${cls(r.pct)}" style="width:${Math.min(100, r.pct)}%"></i></div>
      </div>
      <div class="cp-pct ${cls(r.pct)}">${r.pct}%</div>
    </button>
  `).join('');

  const html = `
    <div class="card-popover">
      <div class="cp-head">
        <div class="cp-head-text">
          <div class="cp-title">${escapeHtml(t('planned_hours'))}</div>
          <div class="cp-sub">${escapeHtml(_periodLabel())}</div>
        </div>
        <span class="cp-pill purple">${overallPct}%</span>
        <button class="cp-close" id="cp-close" aria-label="Close">✕</button>
      </div>
      <div class="cp-kpis">
        <div class="cp-kpi">
          <div class="cp-kpi-label">${escapeHtml(t('cp_planned') || 'Planned')}</div>
          <div class="cp-kpi-value">${Math.round(totalH)}<span class="cp-unit">h</span></div>
        </div>
        <div class="cp-kpi">
          <div class="cp-kpi-label">${escapeHtml(t('cp_target') || 'Target')}</div>
          <div class="cp-kpi-value">${targetH}<span class="cp-unit">h</span></div>
        </div>
        <div class="cp-kpi">
          <div class="cp-kpi-label">${escapeHtml(t('cp_gap') || 'Gap')}</div>
          <div class="cp-kpi-value">${gap > 0 ? '+' : ''}${gap}<span class="cp-unit">h</span></div>
        </div>
      </div>
      <div class="cp-body">
        <div class="cp-rows">${rowsHtml || '<div class="cp-empty">' + escapeHtml(t('cp_no_people') || 'No people scheduled yet') + '</div>'}</div>
      </div>
      <div class="cp-foot">
        <div class="cp-foot-info">${rows.length} ${escapeHtml(t('cp_sorted_by_pct') || 'employees · sorted by capacity used')}</div>
        <div class="cp-foot-actions">
          <button class="btn btn-primary" id="cp-done">${escapeHtml(t('close') || 'Close')}</button>
        </div>
      </div>
    </div>`;

  const close = openCenteredPopover(html);
  document.getElementById('cp-close').addEventListener('click', close);
  document.getElementById('cp-done').addEventListener('click', close);
  document.querySelectorAll('.card-popover .cp-row').forEach(r => {
    r.addEventListener('click', () => {
      const eid = parseInt(r.dataset.empId, 10);
      close();
      _scrollToEmployeeRow(eid);
    });
  });
}

// =========================================================
// Card popover 2: Absences
// =========================================================
function openAbsencesPopover() {
  if (!state.data) return;
  const d = state.data;
  const monday = parseISODate(d.start_date || d.monday);
  const sunday = parseISODate(d.end_date || d.sunday);
  sunday.setHours(23, 59, 59, 999);

  // Build flat list of one entry per (employee, day)
  const entries = [];
  const seen = new Set();
  for (const l of (d.leaves || [])) {
    const dFrom = parseServerDT(l.date_from);
    const dTo = parseServerDT(l.date_to);
    const emp = d.all_employees.find(e => e.id === l.employee_id);
    let cur = new Date(Math.max(dFrom, monday));
    cur.setHours(0, 0, 0, 0);
    const lim = new Date(Math.min(dTo, sunday));
    while (cur <= lim) {
      const key = l.employee_id + '|' + dayKey(cur);
      if (!seen.has(key)) {
        seen.add(key);
        entries.push({ emp, date: new Date(cur), leaveId: l.id });
      }
      cur.setDate(cur.getDate() + 1);
    }
  }
  entries.sort((a, b) => a.date - b.date || (a.emp?.name || '').localeCompare(b.emp?.name || ''));

  const fmtDay = dt => t(DAY_KEYS[(dt.getDay() + 6) % 7]) + ' ' +
    String(dt.getDate()).padStart(2,'0') + ' ' + MONTH_NAMES[dt.getMonth()].slice(0, 3);
  const unique = new Set(entries.map(e => e.emp && e.emp.id)).size;

  const rowsHtml = entries.map(e => {
    if (!e.emp) return '';
    return `
      <div class="cp-abs-row" data-emp-id="${e.emp.id}" data-date="${dayKey(e.date)}">
        <div class="avatar ${e.emp.avatar_class}">${escapeHtml(e.emp.initials)}</div>
        <div class="cp-abs-body">
          <div class="cp-name">${escapeHtml(e.emp.name)}</div>
          <div class="cp-abs-meta">
            <span class="cp-day-pill">${escapeHtml(fmtDay(e.date))}</span>
            <span class="cp-dot">·</span>
            <span>${escapeHtml(t('all_day'))}</span>
          </div>
        </div>
        <button class="btn cp-row-jump" type="button" data-emp-id="${e.emp.id}">
          ${escapeHtml(t('cp_jump') || 'Jump')}
        </button>
      </div>
    `;
  }).join('');

  const emptyHtml = `
    <div class="cp-clear">
      <div class="cp-clear-icon ok">✓</div>
      <div class="cp-clear-title">${escapeHtml(t('cp_no_absences') || 'No absences this week')}</div>
      <div class="cp-clear-sub">${escapeHtml(t('cp_no_absences_sub') || 'Everyone is available.')}</div>
    </div>`;

  const html = `
    <div class="card-popover">
      <div class="cp-head">
        <div class="cp-head-text">
          <div class="cp-title">${escapeHtml(t('absences'))}</div>
          <div class="cp-sub">${escapeHtml(_periodLabel())}</div>
        </div>
        <span class="cp-pill amber">${entries.length} ${entries.length === 1 ? (t('cp_day') || 'day') : (t('cp_days') || 'days')} · ${unique} ${unique === 1 ? (t('cp_person') || 'person') : (t('cp_people') || 'people')}</span>
        <button class="cp-close" id="cp-close" aria-label="Close">✕</button>
      </div>
      <div class="cp-body">
        ${entries.length ? '<div class="cp-abs-list">' + rowsHtml + '</div>' : emptyHtml}
      </div>
      <div class="cp-foot">
        <div class="cp-foot-info">${entries.length ? unique + ' ' + escapeHtml(t('cp_people_affected') || 'people affected') : ''}</div>
        <div class="cp-foot-actions">
          <button class="btn btn-primary" id="cp-done">${escapeHtml(t('close') || 'Close')}</button>
        </div>
      </div>
    </div>`;

  const close = openCenteredPopover(html);
  document.getElementById('cp-close').addEventListener('click', close);
  document.getElementById('cp-done').addEventListener('click', close);
  document.querySelectorAll('.cp-row-jump').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const eid = parseInt(b.dataset.empId, 10);
      close();
      _scrollToEmployeeRow(eid);
    });
  });
}

// =========================================================
// Card popover 3: Schedule Health (Conflicts +)
// Runs multiple checks on the currently loaded data:
//   - Overlaps (critical)
//   - Overtime (critical)
//   - Past unpublished drafts (warning)
//   - Empty rows (info)
//   - Current/future drafts (info)
// =========================================================
function _runHealthChecks() {
  const d = state.data;
  if (!d) return { critical: 0, warning: 0, info: 0, sections: [] };
  const out = { critical: 0, warning: 0, info: 0, sections: [] };

  // --- Overlaps ---
  const overlapItems = [];
  const byEmpDay = {};
  for (const s of d.shifts) {
    const dv = parseServerDT(s.datum_von);
    const k = s.employee_id + '|' + dayKey(dv);
    (byEmpDay[k] = byEmpDay[k] || []).push({ s, dv, db: parseServerDT(s.datum_bis) });
  }
  for (const k of Object.keys(byEmpDay)) {
    const arr = byEmpDay[k].sort((a, b) => a.dv - b.dv);
    for (let i = 0; i < arr.length - 1; i++) {
      if (arr[i].db > arr[i + 1].dv) {
        const emp = d.all_employees.find(e => e.id === arr[i].s.employee_id) || {};
        overlapItems.push({
          empName: emp.name || '?',
          dateLabel: _formatDateForHealth(arr[i].dv),
          areaA: arr[i].s.bereich_code,
          areaB: arr[i + 1].s.bereich_code,
          timeA: fmtTimeLocal(arr[i].dv) + ' – ' + fmtTimeLocal(arr[i].db),
          timeB: fmtTimeLocal(arr[i + 1].dv) + ' – ' + fmtTimeLocal(arr[i + 1].db),
          shiftId: arr[i].s.id,
          duplicateId: arr[i + 1].s.id,
        });
      }
    }
  }
  if (overlapItems.length) {
    out.critical += overlapItems.length;
    out.sections.push({ sev: 'critical', title: t('hp_overlaps') || 'OVERLAPS', items: overlapItems.map(o => ({
      title: o.empName + ' · ' + o.dateLabel,
      meta: (t('hp_overlap_desc') || 'Two shifts overlap. %a (%tA) and %b (%tB).')
        .replace('%a', o.areaA).replace('%tA', o.timeA)
        .replace('%b', o.areaB).replace('%tB', o.timeB),
      actions: [
        { label: t('hp_jump') || 'Jump to shift', primary: true,
          onClick: () => _scrollAndFlashShift(o.shiftId) },
        { label: t('hp_resolve_overlap') || 'Resolve…', danger: true,
          onClick: () => _openOverlapResolver(o) },
      ],
    })) });
  }

  // --- Overtime ---
  // Per-employee target is adjusted for approved leaves in the period —
  // someone with 2 leave days in a 7-day view has an available capacity
  // of 5/7 of their weekly target, not the full week.
  const periodDays = (d.days && d.days.length) || 7;
  const periodMonday = parseISODate(d.start_date || d.monday);
  const periodSunday = parseISODate(d.end_date || d.sunday);
  periodSunday.setHours(23, 59, 59, 999);

  const perEmpH = {};
  for (const s of d.shifts) {
    if (s.is_leave) continue;
    const dv = parseServerDT(s.datum_von);
    const db = parseServerDT(s.datum_bis);
    perEmpH[s.employee_id] = (perEmpH[s.employee_id] || 0) + (db - dv) / 3600000;
  }

  // Count leave days per employee within the period
  const leaveDaysPerEmp = {};
  for (const l of (d.leaves || [])) {
    const dFrom = parseServerDT(l.date_from);
    const dTo = parseServerDT(l.date_to);
    let cur = new Date(Math.max(dFrom, periodMonday));
    cur.setHours(0, 0, 0, 0);
    const lim = new Date(Math.min(dTo, periodSunday));
    let n = 0;
    while (cur <= lim) { n++; cur.setDate(cur.getDate() + 1); }
    leaveDaysPerEmp[l.employee_id] = (leaveDaysPerEmp[l.employee_id] || 0) + n;
  }

  const overtimeItems = [];
  for (const eid of Object.keys(perEmpH)) {
    const emp = d.all_employees.find(e => e.id === parseInt(eid, 10));
    if (!emp) continue;
    const availableDays = Math.max(0, periodDays - (leaveDaysPerEmp[eid] || 0));
    // If they have ZERO available days (full-period leave), skip — they
    // shouldn't have shifts at all, but that's the overlap check's job.
    if (availableDays === 0) continue;
    const tgt = Math.round((emp.weekly_hours_target || 40) * (availableDays / 7));
    const planned = Math.round(perEmpH[eid]);
    if (planned > tgt) {
      const leaveNote = (leaveDaysPerEmp[eid] || 0) > 0
        ? ' (' + (leaveDaysPerEmp[eid]) + ' ' + (t('cp_days') || 'days') + ' ' + (t('hp_on_leave') || 'on leave') + ')'
        : '';
      overtimeItems.push({
        title: emp.name + ' · ' + planned + 'h scheduled' + leaveNote,
        meta: (t('hp_overtime_desc') || 'Target %t h. Currently %o h over the weekly limit.')
          .replace('%t', tgt).replace('%o', planned - tgt),
        actions: [
          { label: t('hp_review') || 'Review shifts', primary: true, onClick: () => { _scrollToEmployeeRow(emp.id); } },
        ],
      });
    }
  }
  if (overtimeItems.length) {
    out.critical += overtimeItems.length;
    out.sections.push({ sev: 'critical', title: t('hp_overtime') || 'OVERTIME', items: overtimeItems });
  }

  // --- Empty rows: people in the grid with no shifts ---
  // Two cases: (a) pinned employee with no shifts/leaves yet, and
  // (b) employee whose ONLY content this period is leave — they're
  // showing in the grid but have nothing scheduled around the leave.
  const empWithShifts = new Set();
  const empWithLeaves = new Set();
  for (const s of d.shifts) empWithShifts.add(s.employee_id);
  for (const l of d.leaves) empWithLeaves.add(l.employee_id);
  const emptyRowItems = [];

  // (a) Pinned, fully empty
  for (const eid of state.pinnedEmployees) {
    if (empWithShifts.has(eid) || empWithLeaves.has(eid)) continue;
    const emp = d.all_employees.find(e => e.id === eid);
    if (!emp) continue;
    emptyRowItems.push({
      title: emp.name + ' · ' + (t('hp_empty_row_title') || 'in view but no shifts'),
      meta: t('hp_empty_row_desc') || 'Added to the planner but nothing scheduled yet.',
      actions: [
        { label: t('hp_add_shift') || 'Add shift', primary: true,
          onClick: () => openCreateShiftPopover(d.days[0], emp.id) },
        { label: t('hp_remove_row') || 'Remove from view',
          onClick: () => { state.pinnedEmployees.delete(emp.id); render(); } },
      ],
    });
  }
  if (emptyRowItems.length) {
    out.info += emptyRowItems.length;
    out.sections.push({ sev: 'info', title: t('hp_empty_rows') || 'EMPTY ROWS', items: emptyRowItems });
  }

  // --- Drafts ---
  const drafts = d.shifts.filter(s => s.state === 'draft' && !s.is_leave);
  if (drafts.length) {
    out.info += 1; // count as one rolled-up issue
    out.sections.push({
      sev: 'info',
      title: t('hp_drafts') || 'DRAFT SHIFTS',
      items: [{
        title: drafts.length + ' ' + (t('hp_drafts_title') || 'shifts still in draft'),
        meta: t('hp_drafts_desc') || "Not yet published — employees can't see them in their schedule.",
        actions: [
          { label: t('hp_publish_all') || 'Publish all', primary: true, onClick: () => _publishAllDraftsFromHealth() },
        ],
      }],
    });
  }

  return out;
}

function _formatDateForHealth(dv) {
  const dayKey = DAY_KEYS[(dv.getDay() + 6) % 7];
  return t(dayKey) + ' ' + String(dv.getDate()).padStart(2, '0') + ' ' + MONTH_NAMES[dv.getMonth()];
}

async function _deleteShiftFromHealth(shiftId) {
  if (!confirm(t('confirm_delete') || 'Really delete this shift?')) return;
  try {
    const r = await rpc('/dienstplan/api/shift/delete', { id: shiftId });
    if (r && r.error) throw new Error(r.error);
    toast(t('shift_deleted'), 'success');
    await reload();
    // Reopen health popover with refreshed data
    setTimeout(openScheduleHealthPopover, 200);
  } catch (err) {
    toast(t('error_prefix') + err.message, 'error');
  }
}

// Show both overlapping shifts side-by-side, let the user pick which one
// to delete. Replaces the old "always delete the second one" behaviour.
function _openOverlapResolver(o) {
  const html = `
    <div class="card-popover">
      <div class="cp-head">
        <div class="cp-head-text">
          <div class="cp-title">${escapeHtml(t('hp_resolve_title') || 'Resolve overlap')}</div>
          <div class="cp-sub">${escapeHtml(o.empName + ' · ' + o.dateLabel)}</div>
        </div>
        <button class="cp-close" id="cp-close" aria-label="Close">✕</button>
      </div>
      <div class="cp-body">
        <div class="ov-intro">
          ${escapeHtml(t('hp_resolve_intro') || 'Two shifts overlap. Choose which one to keep.')}
        </div>
        <div class="ov-grid">
          <div class="ov-shift">
            <div class="ov-shift-area">${escapeHtml(o.areaA)}</div>
            <div class="ov-shift-time">${escapeHtml(o.timeA)}</div>
            <div class="ov-shift-actions">
              <button class="btn btn-tiny" data-jump="${o.shiftId}">${escapeHtml(t('cp_jump') || 'Jump')}</button>
              <button class="btn btn-tiny btn-danger" data-delete="${o.shiftId}">${escapeHtml(t('hp_delete_this') || 'Delete this')}</button>
            </div>
          </div>
          <div class="ov-shift">
            <div class="ov-shift-area">${escapeHtml(o.areaB)}</div>
            <div class="ov-shift-time">${escapeHtml(o.timeB)}</div>
            <div class="ov-shift-actions">
              <button class="btn btn-tiny" data-jump="${o.duplicateId}">${escapeHtml(t('cp_jump') || 'Jump')}</button>
              <button class="btn btn-tiny btn-danger" data-delete="${o.duplicateId}">${escapeHtml(t('hp_delete_this') || 'Delete this')}</button>
            </div>
          </div>
        </div>
      </div>
      <div class="cp-foot">
        <div class="cp-foot-info">${escapeHtml(t('hp_resolve_hint') || 'Tip: jump to see the shift in the grid first')}</div>
        <div class="cp-foot-actions">
          <button class="btn" id="cp-cancel">${escapeHtml(t('cancel') || 'Cancel')}</button>
        </div>
      </div>
    </div>`;

  const close = openCenteredPopover(html);
  document.getElementById('cp-close').addEventListener('click', close);
  document.getElementById('cp-cancel').addEventListener('click', close);

  document.querySelectorAll('.card-popover [data-jump]').forEach(b => {
    b.addEventListener('click', () => {
      const sid = parseInt(b.dataset.jump, 10);
      close();
      _scrollAndFlashShift(sid);
    });
  });
  document.querySelectorAll('.card-popover [data-delete]').forEach(b => {
    b.addEventListener('click', async () => {
      const sid = parseInt(b.dataset.delete, 10);
      if (!confirm(t('confirm_delete') || 'Really delete this shift?')) return;
      try {
        const r = await rpc('/dienstplan/api/shift/delete', { id: sid });
        if (r && r.error) throw new Error(r.error);
        toast(t('shift_deleted'), 'success');
        close();
        await reload();
        setTimeout(openScheduleHealthPopover, 200);
      } catch (err) {
        toast(t('error_prefix') + err.message, 'error');
      }
    });
  });
}

async function _publishAllDraftsFromHealth() {
  if (!state.data) return;
  const drafts = state.data.shifts.filter(s => s.state === 'draft' && !s.is_leave);
  if (!drafts.length) return;
  if (!confirm((t('hp_publish_confirm') || 'Publish %n shift(s)?').replace('%n', drafts.length))) return;
  let ok = 0;
  for (const s of drafts) {
    try {
      const r = await rpc('/dienstplan/api/shift/publish', { id: s.id, publish: true });
      if (r && r.ok) ok++;
    } catch (_) {}
  }
  toast((t('hp_published_n') || 'Published %n shift(s)').replace('%n', ok), 'success');
  await reload();
  setTimeout(openScheduleHealthPopover, 200);
}

function openScheduleHealthPopover() {
  const health = _runHealthChecks();
  const totalIssues = health.critical + health.warning;
  const allClear = totalIssues === 0 && health.info === 0;

  const pillCls = totalIssues > 0 ? 'rose' : 'green';
  const pillText = totalIssues > 0
    ? '⚠ ' + totalIssues + ' ' + (totalIssues === 1 ? (t('hp_issue') || 'issue') : (t('hp_issues') || 'issues'))
    : '✓ ' + (t('hp_all_clear') || 'All clear');

  let bodyHtml;
  if (allClear) {
    bodyHtml = `
      <div class="cp-clear">
        <div class="cp-clear-icon ok">✓</div>
        <div class="cp-clear-title">${escapeHtml(t('hp_healthy_title') || 'Schedule is healthy')}</div>
        <div class="cp-clear-sub">${escapeHtml(t('hp_healthy_sub') || 'No conflicts, no overtime, nothing needs attention.')}</div>
      </div>`;
  } else {
    bodyHtml = health.sections.map((sec, sIdx) => {
      const itemsHtml = sec.items.map((it, iIdx) => {
        const actionsHtml = (it.actions || []).map((a, aIdx) => {
          const cls = 'btn btn-tiny' + (a.primary ? ' btn-primary' : '') + (a.danger ? ' btn-danger' : '');
          return `<button class="${cls}" data-section="${sIdx}" data-item="${iIdx}" data-action="${aIdx}">${escapeHtml(a.label)}</button>`;
        }).join('');
        const icon = sec.sev === 'critical' ? '⚠' : sec.sev === 'warning' ? '!' : 'i';
        return `
          <div class="hp-issue">
            <div class="hp-issue-head">
              <span class="hp-icon sev-${sec.sev}">${icon}</span>
              <div class="hp-issue-title">${escapeHtml(it.title)}</div>
            </div>
            <div class="hp-issue-meta">${escapeHtml(it.meta || '')}</div>
            ${actionsHtml ? '<div class="hp-issue-actions">' + actionsHtml + '</div>' : ''}
          </div>`;
      }).join('');
      return `
        <div class="hp-section-head sev-${sec.sev}">
          <span class="sev-dot"></span>
          ${escapeHtml(sec.title)}
          <span class="hp-section-count">${sec.items.length}</span>
        </div>
        ${itemsHtml}`;
    }).join('');
  }

  const html = `
    <div class="card-popover">
      <div class="cp-head">
        <div class="cp-head-text">
          <div class="cp-title">${escapeHtml(t('hp_title') || 'Schedule Health')}</div>
          <div class="cp-sub">${escapeHtml(_periodLabel())}</div>
        </div>
        <span class="cp-pill ${pillCls}">${pillText}</span>
        <button class="cp-close" id="cp-close" aria-label="Close">✕</button>
      </div>
      <div class="cp-body">${bodyHtml}</div>
      <div class="cp-foot">
        <div class="cp-foot-info">${escapeHtml(t('hp_last_checked') || 'Last checked: just now')}</div>
        <div class="cp-foot-actions">
          <button class="btn" id="cp-refresh">↻ ${escapeHtml(t('hp_refresh') || 'Refresh')}</button>
          <button class="btn btn-primary" id="cp-done">${escapeHtml(t('close') || 'Close')}</button>
        </div>
      </div>
    </div>`;

  const close = openCenteredPopover(html);
  document.getElementById('cp-close').addEventListener('click', close);
  document.getElementById('cp-done').addEventListener('click', close);
  document.getElementById('cp-refresh').addEventListener('click', () => { close(); setTimeout(openScheduleHealthPopover, 50); });

  // Wire up action buttons
  document.querySelectorAll('.card-popover .hp-issue .btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const sIdx = parseInt(btn.dataset.section, 10);
      const iIdx = parseInt(btn.dataset.item, 10);
      const aIdx = parseInt(btn.dataset.action, 10);
      const sec = health.sections[sIdx];
      const item = sec && sec.items[iIdx];
      const action = item && item.actions && item.actions[aIdx];
      if (action && action.onClick) {
        close();
        action.onClick();
      }
    });
  });
}

// Build a "CW 20 · 11 – 17 May 2026" style label for popover headers
function _periodLabel() {
  const d = state.data;
  if (!d) return '';
  const s = parseISODate(d.start_date || d.monday);
  const e = parseISODate(d.end_date || d.sunday);
  const fmt = dt => String(dt.getDate()).padStart(2,'0') + ' ' + MONTH_NAMES[dt.getMonth()].slice(0, 3);
  let label = '';
  if (d.kw) label += 'CW ' + d.kw + ' · ';
  label += fmt(s) + ' – ' + fmt(e) + ' ' + s.getFullYear();
  return label;
}

// -----------------------------------------------------------
// Settings popover (in-app)
// -----------------------------------------------------------
async function openSettingsPopover() {
  let settings;
  try {
    settings = await rpc('/dienstplan/api/settings/get');
  } catch (err) {
    toast(t('error_prefix') + err.message, 'error');
    return;
  }

  const fmtTime = (h, m) => String(h).padStart(2, '0') + ':' + String(m || 0).padStart(2, '0');

  const html = `
    <h4><span>⚙ Settings</span><span class="close" id="cp-close">✕</span></h4>

    <div class="field-group">
      <div class="field-label">DEFAULT SHIFT TIMES</div>
      <div class="time-row">
        <input type="time" id="set-start" class="time-input" value="${fmtTime(settings.start_hour, settings.start_minute)}"/>
        <span style="color:var(--muted);padding:0 4px;">→</span>
        <input type="time" id="set-end" class="time-input" value="${fmtTime(settings.end_hour, settings.end_minute)}"/>
      </div>
    </div>

    <div class="field-group">
      <div class="field-label">DEFAULT WEEKLY HOURS TARGET</div>
      <input type="number" id="set-hours" class="time-input" value="${settings.weekly_hours}" min="1" max="168" step="0.5"/>
    </div>

    <div class="field-group" style="display:flex;flex-direction:column;gap:10px;">
      <div class="field-label">DISPLAY &amp; AUTOMATION</div>
      <label style="display:flex;align-items:center;gap:8px;font:500 12.5px var(--font);color:var(--text);cursor:pointer;">
        <input type="checkbox" id="set-weekends" ${settings.show_weekends ? 'checked' : ''} style="width:auto;min-height:auto;margin:0;"/>
        Show Saturday &amp; Sunday
      </label>
      <label style="display:flex;align-items:center;gap:8px;font:500 12.5px var(--font);color:var(--text);cursor:pointer;">
        <input type="checkbox" id="set-autopub" ${settings.auto_publish ? 'checked' : ''} style="width:auto;min-height:auto;margin:0;"/>
        Auto-publish new shifts
      </label>
      <label style="display:flex;align-items:center;gap:8px;font:500 12.5px var(--font);color:var(--text);cursor:pointer;">
        <input type="checkbox" id="set-notify" ${settings.notify_on_publish ? 'checked' : ''} style="width:auto;min-height:auto;margin:0;"/>
        Email employees on publish
      </label>
    </div>

    <div class="field-group">
      <div class="field-label">TV KIOSK</div>
      <input type="text" id="set-token" class="time-input" value="${escapeHtml(settings.kiosk_token)}" placeholder="Leave empty to disable kiosk"/>
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
        <input type="number" id="set-refresh" class="time-input" value="${settings.kiosk_refresh}" min="10" max="600" style="width:80px;"/>
        <span style="font:500 12px var(--font);color:var(--muted);">seconds auto-refresh</span>
      </div>
    </div>

    <div class="popover-actions">
      <button class="btn" id="cp-cancel">Cancel</button>
      <button class="btn btn-primary" id="cp-save">Save</button>
    </div>`;

  const close = openCenteredPopover(html);
  document.getElementById('cp-close').addEventListener('click', close);
  document.getElementById('cp-cancel').addEventListener('click', close);

  document.getElementById('cp-save').addEventListener('click', async () => {
    const startTime = document.getElementById('set-start').value;
    const endTime = document.getElementById('set-end').value;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const vals = {
      start_hour: sh,
      start_minute: sm,
      end_hour: eh,
      end_minute: em,
      weekly_hours: parseFloat(document.getElementById('set-hours').value) || 40,
      show_weekends: document.getElementById('set-weekends').checked,
      auto_publish: document.getElementById('set-autopub').checked,
      notify_on_publish: document.getElementById('set-notify').checked,
      kiosk_token: document.getElementById('set-token').value.trim(),
      kiosk_refresh: parseInt(document.getElementById('set-refresh').value, 10) || 120,
    };
    try {
      const r = await rpc('/dienstplan/api/settings/update', { vals });
      if (r && r.error) throw new Error(r.error);
      toast('Settings saved', 'success');
      close();
      await reload();
    } catch (err) {
      toast(t('error_prefix') + err.message, 'error');
    }
  });
}

// -----------------------------------------------------------
// Loading
// -----------------------------------------------------------
async function reload() {
  state.loading = true;
  document.getElementById('grid-card').innerHTML =
    `<div class="loading">${escapeHtml(t('loading'))}</div>`;
  try {
    state.data = await rpc('/dienstplan/api/week', {
      offset: state.offset,
      view_mode: state.viewMode,
    });
    _applyDefaults(state.data.defaults);
    state.loading = false;
    render();
  } catch (err) {
    document.getElementById('grid-card').innerHTML =
      `<div class="empty"><div class="icon">⚠</div><h3>${escapeHtml(t('rpc_error'))}</h3><p>` +
      escapeHtml(err.message) + '</p></div>';
    state.loading = false;
  }
}

// -----------------------------------------------------------
// Crew filters – saved per-user employee groups
// -----------------------------------------------------------
const CREW_KEY = 'dienstplan_crews_v1';
const CREW_ACTIVE_KEY = 'dienstplan_crew_active_v1';

function loadCrews() {
  try {
    const raw = localStorage.getItem(CREW_KEY);
    if (raw) state.crews = JSON.parse(raw) || {};
  } catch (e) { state.crews = {}; }
  try {
    const a = localStorage.getItem(CREW_ACTIVE_KEY);
    if (a && state.crews[a]) state.activeCrew = a;
  } catch (e) { /* ignore */ }
}

function saveCrews() {
  try { localStorage.setItem(CREW_KEY, JSON.stringify(state.crews)); } catch (e) {}
}

function saveActiveCrew() {
  try {
    if (state.activeCrew) localStorage.setItem(CREW_ACTIVE_KEY, state.activeCrew);
    else localStorage.removeItem(CREW_ACTIVE_KEY);
  } catch (e) {}
}

function isInCrew(empId) {
  if (!state.activeCrew) return true;
  const members = state.crews[state.activeCrew];
  if (!members || !members.length) return true;
  return members.includes(empId);
}

// ============================================================
// Filter column logic (status + absence)
// ============================================================
const STATUS_FILTER_KEY = 'dienstplan_status_filter_v1';
const ABSENCE_ONLY_KEY = 'dienstplan_absence_only_v1';

function loadFilters() {
  try {
    const sf = localStorage.getItem(STATUS_FILTER_KEY);
    if (sf === 'draft' || sf === 'published') state.statusFilter = sf;
    else state.statusFilter = null;
    state.absenceOnly = localStorage.getItem(ABSENCE_ONLY_KEY) === '1';
  } catch (e) { /* ignore */ }
}

function saveFilters() {
  try {
    if (state.statusFilter) localStorage.setItem(STATUS_FILTER_KEY, state.statusFilter);
    else localStorage.removeItem(STATUS_FILTER_KEY);
    if (state.absenceOnly) localStorage.setItem(ABSENCE_ONLY_KEY, '1');
    else localStorage.removeItem(ABSENCE_ONLY_KEY);
  } catch (e) { /* ignore */ }
}

function isShiftVisible(s) {
  if (!isInCrew(s.employee_id)) return false;
  if (state.statusFilter && s.state !== state.statusFilter) return false;
  if (state.absenceOnly && !s.is_leave) return false;
  return true;
}

function isLeaveVisible(l) {
  if (!isInCrew(l.employee_id)) return false;
  // Status filter excludes leaves (they have no state field)
  if (state.statusFilter) return false;
  return true;
}

function activeFilterCount() {
  return (state.activeCrew ? 1 : 0)
       + (state.statusFilter ? 1 : 0)
       + (state.absenceOnly ? 1 : 0);
}

function toggleStatusFilter(value) {
  state.statusFilter = (state.statusFilter === value) ? null : value;
  saveFilters();
  render();
}

function toggleAbsenceOnly() {
  state.absenceOnly = !state.absenceOnly;
  saveFilters();
  render();
}

function jumpToThisWeek() {
  state.offset = 0;
  closeCrewDropdown();
  reload();
}

function clearAllFilters() {
  state.activeCrew = null;
  state.statusFilter = null;
  state.absenceOnly = false;
  saveActiveCrew();
  saveFilters();
  render();
}

function setActiveCrew(name) {
  state.activeCrew = name || null;
  saveActiveCrew();
  render();
}

function deleteCrew(name) {
  if (!confirm(`Delete filter "${name}"?`)) return;
  delete state.crews[name];
  if (state.activeCrew === name) {
    state.activeCrew = null;
    saveActiveCrew();
  }
  saveCrews();
  render();
}

function injectCrewStyles() {
  if (document.getElementById('crew-styles')) return;
  const s = document.createElement('style');
  s.id = 'crew-styles';
  s.textContent = `
/* ===== Active filter pill INSIDE the search bar ===== */
.topbar-search .search-kbd { right: 42px; }
.topbar-search .global-search-clear { right: 80px; }
.topbar-search .global-search-input { padding-right: 100px; }
.topbar-search.has-filter .global-search-input { padding-left: 130px; }
.topbar-search.has-filter { border-color: color-mix(in oklab, var(--accent) 40%, var(--hairline)); }
.topbar-search.has-filter .search-ico { color: var(--accent); }

.crew-pill {
  position: absolute; left: 34px; top: 50%; transform: translateY(-50%);
  display: none; align-items: center; gap: 6px;
  background: linear-gradient(135deg, var(--accent, #7c5cff), #a78bfa);
  color: #fff; padding: 4px 4px 4px 10px; border-radius: 99px;
  font: 700 11px var(--font, sans-serif);
  box-shadow: 0 2px 8px -2px rgba(124,92,255,.5);
  z-index: 2; pointer-events: auto;
  animation: crewPillIn .25s ease;
}
.crew-pill.show { display: inline-flex; }
@keyframes crewPillIn {
  from { opacity: 0; transform: translateY(-50%) scale(.85); }
  to { opacity: 1; transform: translateY(-50%) scale(1); }
}
.crew-pill-count {
  background: rgba(255,255,255,.28); padding: 1px 6px;
  border-radius: 9px; font: 700 10px var(--font-mono, monospace);
}
.crew-pill-x {
  width: 18px; height: 18px; display: inline-flex;
  align-items: center; justify-content: center;
  background: rgba(255,255,255,.2); border-radius: 50%;
  font-size: 11px; cursor: pointer; border: none; color: #fff;
  transition: background .15s, transform .15s;
}
.crew-pill-x:hover { background: rgba(255,255,255,.35); transform: scale(1.1); }

/* ===== Arrow button on the right of the search bar ===== */
.crew-arrow {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  width: 28px; height: 28px; display: inline-flex;
  align-items: center; justify-content: center;
  border: 1px solid var(--hairline); background: var(--chip);
  color: var(--text-muted); border-radius: 6px;
  cursor: pointer; transition: all .18s; z-index: 2;
}
.crew-arrow:hover { background: var(--chip-hover); color: var(--text);
  border-color: var(--hairline-strong); }
.crew-arrow.open { background: var(--accent, #7c5cff); color: #fff;
  border-color: transparent;
  box-shadow: 0 3px 10px -2px rgba(124,92,255,.5); }
.crew-arrow svg { transition: transform .25s cubic-bezier(.4,0,.2,1); }
.crew-arrow.open svg { transform: rotate(180deg); }
.crew-arrow-dot {
  display: none; position: absolute; top: 4px; right: 4px;
  width: 7px; height: 7px; border-radius: 50%;
  background: linear-gradient(135deg, #ef4444, #f59e0b);
  border: 2px solid var(--panel-solid, #14161e);
  animation: crewDotPulse 2s ease-in-out infinite;
}
.crew-arrow.has-filter .crew-arrow-dot { display: block; }
@keyframes crewDotPulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.15); opacity: .85; }
}

/* ===== 3-column dropdown panel ===== */
.crew-panel {
  display: none; position: absolute; top: calc(100% + 8px); right: 0;
  z-index: 60; width: 720px; max-width: 95vw;
  background: var(--panel-solid, #fff);
  border: 1px solid var(--hairline);
  border-radius: 14px; padding: 0;
  box-shadow: 0 24px 60px rgba(0,0,0,.45), 0 4px 16px rgba(0,0,0,.2);
  overflow: hidden;
  opacity: 0; transform: translateY(-6px) scale(.99);
  transition: opacity .18s ease, transform .18s ease;
}
[data-theme="light"] .crew-panel {
  box-shadow: 0 24px 60px rgba(15,18,30,.18), 0 6px 16px rgba(15,18,30,.08);
}
.crew-panel.show { display: block; opacity: 1; transform: translateY(0) scale(1); }

.crew-reset-bar {
  display: none; align-items: center; gap: 8px;
  padding: 8px 14px;
  background: color-mix(in oklab, var(--accent-soft, rgba(124,92,255,.18)) 50%, transparent);
  border-bottom: 1px solid var(--hairline);
  font: 500 12px var(--font, sans-serif); color: var(--text-2, inherit);
}
.crew-reset-bar.show { display: flex; }
.crew-reset-bar strong { color: var(--text, inherit); font-weight: 600; }
.crew-reset-link {
  margin-left: auto; background: none; border: none;
  color: var(--accent, #7c5cff); font: 600 11.5px var(--font, sans-serif);
  cursor: pointer; padding: 2px 8px; border-radius: 5px;
  transition: background .12s;
}
.crew-reset-link:hover { background: var(--chip-hover); }

.crew-grid { display: grid; grid-template-columns: 1fr 1fr; }
.crew-col {
  padding: 16px 8px 10px; border-right: 1px solid var(--hairline);
  display: flex; flex-direction: column; min-height: 230px;
  opacity: 0; transform: translateY(4px);
  animation: crewColIn .25s ease forwards;
}
.crew-panel.show .crew-col:nth-child(1) { animation-delay: .05s; }
.crew-panel.show .crew-col:nth-child(2) { animation-delay: .10s; }
@keyframes crewColIn { to { opacity: 1; transform: translateY(0); } }
.crew-col:last-child { border-right: none; }

.crew-col-header {
  display: flex; align-items: center; gap: 8px;
  padding: 0 12px 4px 12px;
  font: 700 13px var(--font, sans-serif); color: var(--text, inherit);
}
.crew-col-icon { width: 18px; height: 18px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center; }
.crew-col-icon.icon-filter { color: #9c5ce8; }
.crew-col-icon.icon-group { color: #1abc9c; }
.crew-col-icon.icon-fav { color: #f1c40f; }
.crew-col-count {
  margin-left: auto; font: 700 10px var(--font-mono, monospace);
  color: var(--text-muted, #888); background: var(--chip);
  padding: 1px 7px; border-radius: 99px;
  border: 1px solid var(--hairline);
}
.crew-col-subtitle {
  padding: 0 12px 8px 38px;
  font: 500 10.5px var(--font, sans-serif); color: var(--text-muted, #888);
}

.crew-item {
  display: flex; align-items: center; gap: 9px;
  padding: 8px 12px; border-radius: 7px;
  background: transparent; border: none; color: var(--text, inherit);
  text-align: left; width: 100%;
  font: 500 13px var(--font, sans-serif); cursor: pointer;
  transition: background .15s, padding-left .15s, color .15s;
}
.crew-item:hover { background: var(--chip-hover); padding-left: 14px; }
.crew-item.active { color: var(--accent, #7c5cff); font-weight: 600; }
.crew-item-tick {
  width: 14px; flex-shrink: 0; color: var(--accent, #7c5cff);
  font-size: 13px; font-weight: 700; opacity: 0; transition: opacity .15s;
}
.crew-item.active .crew-item-tick { opacity: 1; }
.crew-item-arrow {
  width: 14px; flex-shrink: 0; color: var(--text-muted, #888);
  font-size: 13px; font-weight: 600; opacity: .55;
  transition: opacity .15s, transform .15s;
}
.crew-item-action:hover .crew-item-arrow {
  opacity: 1; color: var(--accent, #7c5cff); transform: translateX(2px);
}
.crew-item-name {
  flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.crew-item-count {
  font: 700 10.5px var(--font-mono, monospace);
  background: var(--chip); padding: 1px 7px; border-radius: 9px;
  color: var(--text-muted, #888); border: 1px solid var(--hairline);
}
.crew-item.active .crew-item-count {
  background: var(--accent-soft, rgba(124,92,255,.18));
  color: var(--accent, #7c5cff); border-color: transparent;
}

/* Avatar stack in Favoriten items */
.crew-avatars { display: inline-flex; flex-shrink: 0; margin-right: 2px; }
.crew-avatar-mini {
  width: 20px; height: 20px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font: 700 8.5px var(--font, sans-serif); color: #fff;
  border: 1.5px solid var(--panel-solid, #fff);
  margin-left: -6px; flex-shrink: 0;
}
.crew-avatar-mini:first-child { margin-left: 0; }

.crew-row { display: flex; align-items: center; }
.crew-item-del {
  margin-left: auto; background: transparent; border: none;
  color: var(--text-muted, #888); font-size: 14px; line-height: 1;
  padding: 4px 6px; cursor: pointer; border-radius: 5px;
  opacity: 0; transition: opacity .15s, background .15s, color .15s;
}
.crew-row:hover .crew-item-del { opacity: .7; }
.crew-item-del:hover { opacity: 1; background: rgba(239,68,68,.12); color: #ef4444; }

.crew-divider { height: 1px; background: var(--hairline); margin: 8px 6px; }
.crew-create {
  display: flex; align-items: center; gap: 7px;
  padding: 9px 12px; border-radius: 7px; cursor: pointer;
  background: transparent; border: none;
  color: var(--text-2, inherit); width: 100%; text-align: left;
  font: 600 12.5px var(--font, sans-serif); transition: all .15s;
  margin-top: auto;
}
.crew-create:hover { background: var(--chip-hover); color: var(--accent, #7c5cff); }
.crew-create-arrow { margin-left: auto; font-size: 10px; opacity: .6;
  transition: transform .15s; }
.crew-create:hover .crew-create-arrow { transform: translateX(2px); }

.crew-footer {
  display: flex; align-items: center; gap: 14px;
  padding: 9px 16px;
  background: color-mix(in oklab, var(--chip) 50%, var(--panel-solid));
  border-top: 1px solid var(--hairline);
  font: 500 11px var(--font, sans-serif); color: var(--text-muted, #888);
}
.crew-kbd { display: inline-flex; align-items: center; gap: 5px; }
.crew-kbd kbd {
  background: var(--panel-solid, #fff);
  border: 1px solid var(--hairline); border-bottom-width: 2px;
  border-radius: 4px; padding: 1px 5px;
  font: 600 10px var(--font-mono, monospace);
  color: var(--text-2, inherit); line-height: 1.4;
  box-shadow: 0 1px 0 var(--hairline);
}
.crew-footer-brand { margin-left: auto; font-weight: 500; }

.crew-item.crew-item-disabled,
.crew-create.crew-item-disabled {
  opacity: .4; cursor: not-allowed; pointer-events: none;
}
.crew-item.crew-item-disabled:hover { background: transparent; padding-left: 12px; }

/* ===== Modal (unchanged from earlier) ===== */
.crew-modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 9998;
  display: none; backdrop-filter: blur(4px);
}
.crew-modal-backdrop.show { display: block; }
.crew-modal {
  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%,-50%) scale(.96);
  z-index: 9999; background: var(--panel-solid, #14161e);
  color: var(--text, inherit);
  border-radius: 16px; padding: 22px 22px 18px;
  max-width: 480px; width: 92vw; max-height: 82vh;
  display: none; flex-direction: column;
  box-shadow: 0 30px 80px rgba(0,0,0,.55);
  border: 1px solid var(--hairline);
  opacity: 0; transition: opacity .18s ease, transform .18s ease;
}
.crew-modal.show { display: flex; opacity: 1; transform: translate(-50%,-50%) scale(1); }
.crew-modal h3 { margin: 0 0 16px; font-size: 1.05em; font-weight: 700;
  display: flex; align-items: center; gap: 9px; }
.crew-modal h3::before { content: ''; display: inline-block;
  width: 22px; height: 22px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-radius: 7px; flex-shrink: 0; }
.crew-name-label { display: block; font: 600 10px var(--font, sans-serif);
  letter-spacing: .08em; text-transform: uppercase;
  color: var(--text-muted, #888); margin: 0 0 6px; }
.crew-name-input, .crew-member-search {
  width: 100%; padding: 10px 12px; border-radius: 9px;
  border: 1px solid var(--hairline);
  background: rgba(120,120,140,.05); color: inherit;
  font: 500 13.5px var(--font, sans-serif); outline: none;
  box-sizing: border-box;
  transition: border-color .15s, background .15s, box-shadow .15s;
}
.crew-name-input { margin-bottom: 14px; }
.crew-member-search { margin-bottom: 8px; font-size: 12.5px; padding: 8px 12px; }
.crew-name-input:focus, .crew-member-search:focus {
  border-color: #6366f1; background: transparent;
  box-shadow: 0 0 0 3px rgba(99,102,241,.18);
}
.crew-members {
  overflow-y: auto; flex: 1; min-height: 0;
  border: 1px solid var(--hairline);
  border-radius: 10px; padding: 5px; margin-bottom: 14px; max-height: 46vh;
}
.crew-member {
  display: flex; align-items: center; gap: 10px; padding: 7px 9px;
  border-radius: 8px; cursor: pointer; user-select: none;
  transition: background .12s;
}
.crew-member:hover { background: rgba(120,120,140,.1); }
.crew-member.selected { background: rgba(99,102,241,.12); }
.crew-member input[type=checkbox] {
  margin: 0; width: 16px; height: 16px; cursor: pointer;
  accent-color: #6366f1; flex-shrink: 0;
}
.crew-avatar-sm {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font: 700 10.5px var(--font, sans-serif); color: #fff; flex-shrink: 0;
}
.crew-member-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.crew-member-name { font: 600 13px var(--font, sans-serif); }
.crew-member-meta {
  font: 500 11px var(--font, sans-serif); color: var(--text-muted, #888);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.crew-empty-search { padding: 18px; text-align: center;
  color: var(--text-muted, #888); font-size: .85em; }
.crew-modal-actions {
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
}
.crew-selected-count {
  font: 600 11.5px var(--font, sans-serif); color: var(--text-muted, #888);
}
.crew-modal-buttons { display: flex; gap: 8px; }
.crew-modal-buttons button {
  padding: 9px 18px; border-radius: 9px;
  font: 600 13px var(--font, sans-serif); cursor: pointer;
  border: 1px solid transparent; transition: all .15s;
}
.crew-modal-buttons .btn-cancel {
  background: transparent; border-color: var(--hairline); color: inherit;
}
.crew-modal-buttons .btn-cancel:hover { background: rgba(120,120,140,.1); }
.crew-modal-buttons .btn-save {
  background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff;
}
.crew-modal-buttons .btn-save:hover {
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
  transform: translateY(-1px);
  box-shadow: 0 6px 14px -4px rgba(99,102,241,.5);
}
.crew-modal-buttons .btn-save:disabled {
  opacity: .4; cursor: not-allowed; transform: none; box-shadow: none;
}
  `;
  document.head.appendChild(s);
}

// ============================================================
// Inject the pill, arrow button, and 3-column panel
// into the existing .topbar-search element.
// ============================================================
function ensureCrewDropdown() {
  if (document.getElementById('crew-arrow')) return;
  const searchWrap = document.querySelector('.topbar-search');
  if (!searchWrap) return;

  // Pill (initially hidden), placed right after .search-ico
  const pill = document.createElement('span');
  pill.id = 'crew-pill';
  pill.className = 'crew-pill';
  pill.innerHTML = `
    <span id="crew-pill-name"></span>
    <span class="crew-pill-count" id="crew-pill-count"></span>
    <button id="crew-pill-x" class="crew-pill-x" type="button" title="${escapeHtml(t('crew_remove_filter'))}">×</button>
  `;
  const ico = searchWrap.querySelector('.search-ico');
  if (ico && ico.nextSibling) {
    searchWrap.insertBefore(pill, ico.nextSibling);
  } else {
    searchWrap.appendChild(pill);
  }

  // Arrow button — at the right of the search bar
  const arrow = document.createElement('button');
  arrow.id = 'crew-arrow';
  arrow.className = 'crew-arrow';
  arrow.type = 'button';
  arrow.title = t('crew_arrow_title');
  arrow.setAttribute('aria-expanded', 'false');
  arrow.innerHTML = `
    <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
      <path d="M2 4l4 4 4-4z"/>
    </svg>
    <span class="crew-arrow-dot"></span>
  `;
  searchWrap.appendChild(arrow);

  // Panel
  const panel = document.createElement('div');
  panel.id = 'crew-panel';
  panel.className = 'crew-panel';
  searchWrap.appendChild(panel);

  // Wire events
  arrow.addEventListener('click', e => {
    e.stopPropagation();
    toggleCrewDropdown();
  });

  document.getElementById('crew-pill-x').addEventListener('click', e => {
    e.stopPropagation();
    // Pill always represents one or more active filters. Click × clears all.
    if (state.activeCrew) {
      setActiveCrew(null);
    } else {
      // Status/absence pill — clear those
      state.statusFilter = null;
      state.absenceOnly = false;
      saveFilters();
      render();
    }
  });

  panel.addEventListener('click', e => {
    if (e.target.closest('#crew-reset-link')) {
      clearAllFilters();
      return;
    }
    const del = e.target.closest('.crew-item-del');
    if (del) {
      e.preventDefault(); e.stopPropagation();
      deleteCrew(del.dataset.delCrew);
      return;
    }
    if (e.target.closest('#crew-custom-filter')) {
      e.preventDefault();
      closeCrewDropdown();
      openCrewModal();
      return;
    }
    // Filter column items — actual filter actions
    const filterItem = e.target.closest('.crew-item[data-filter]');
    if (filterItem) {
      const kind = filterItem.dataset.filter;
      if (kind === 'this-week') jumpToThisWeek();
      else if (kind === 'published') toggleStatusFilter('published');
      else if (kind === 'draft') toggleStatusFilter('draft');
      else if (kind === 'absent') toggleAbsenceOnly();
      return;
    }
    // Favoriten: switch active crew
    const fav = e.target.closest('.crew-item[data-fav]');
    if (fav) {
      setActiveCrew(fav.dataset.fav || null);
      closeCrewDropdown();
      return;
    }
    // "Alle" row in Favoriten — clear just the crew, keep other filters
    const all = e.target.closest('.crew-item[data-all]');
    if (all) {
      setActiveCrew(null);
      closeCrewDropdown();
    }
  });

  // Close on outside click / Escape
  document.addEventListener('click', e => {
    if (!panel.classList.contains('show')) return;
    if (e.target.closest('#crew-panel')) return;
    if (e.target.closest('#crew-arrow')) return;
    closeCrewDropdown();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && panel.classList.contains('show')) closeCrewDropdown();
  });

  renderCrewTrigger();
}

// Pick the avatar class from the existing employee data.
function _crewAvatarsFor(crewName) {
  const ids = (state.crews[crewName] || []).slice(0, 3);
  const all = (state.data && state.data.all_employees) || [];
  const byId = {};
  for (const e of all) byId[e.id] = e;
  return ids.map(id => byId[id]).filter(Boolean);
}

// Update pill + arrow + search-wrap state to reflect active filter.
function renderCrewTrigger() {
  const wrap = document.querySelector('.topbar-search');
  const pill = document.getElementById('crew-pill');
  const pillName = document.getElementById('crew-pill-name');
  const pillCount = document.getElementById('crew-pill-count');
  const arrow = document.getElementById('crew-arrow');
  if (!wrap || !pill || !arrow) return;

  const anyFilter = activeFilterCount() > 0;

  // Pill shows the crew name when a crew is active.
  // For status/absence-only filters (no crew), show a generic pill.
  if (state.activeCrew) {
    const count = (state.crews[state.activeCrew] || []).length;
    if (pillName) pillName.textContent = state.activeCrew;
    if (pillCount) {
      pillCount.textContent = String(count);
      pillCount.style.display = '';
    }
    pill.classList.add('show');
  } else if (state.statusFilter || state.absenceOnly) {
    // Show a generic label
    const labels = [];
    if (state.statusFilter === 'published') labels.push(t('published'));
    if (state.statusFilter === 'draft') labels.push(t('draft'));
    if (state.absenceOnly) labels.push(t('absences'));
    if (pillName) pillName.textContent = labels.join(' · ');
    if (pillCount) pillCount.style.display = 'none';
    pill.classList.add('show');
  } else {
    pill.classList.remove('show');
  }

  if (anyFilter) {
    wrap.classList.add('has-filter');
    arrow.classList.add('has-filter');
  } else {
    wrap.classList.remove('has-filter');
    arrow.classList.remove('has-filter');
  }
}

// Build the 3-column panel content.
function renderCrewDropdown() {
  const panel = document.getElementById('crew-panel');
  if (!panel) return;
  const names = Object.keys(state.crews).sort((a, b) => a.localeCompare(b));
  const total = activeFilterCount();

  // Reset bar — built dynamically from active filters
  let resetBar = '';
  if (total > 0) {
    const parts = [];
    if (state.activeCrew) {
      parts.push(t('crew_favorite_prefix', { name: escapeHtml(state.activeCrew) }));
    }
    if (state.statusFilter === 'published') parts.push(t('published'));
    if (state.statusFilter === 'draft') parts.push(t('draft'));
    if (state.absenceOnly) parts.push(t('absences'));
    const activeKey = total === 1 ? 'crew_filters_active' : 'crew_filters_active_plural';
    const activeLabel = t(activeKey, { n: total });
    resetBar = `<div class="crew-reset-bar show">
      <strong>${escapeHtml(activeLabel)}</strong> · ${parts.join(' · ')}
      <button id="crew-reset-link" class="crew-reset-link" type="button">${escapeHtml(t('crew_reset_all'))}</button>
    </div>`;
  }

  // ---------- Column 1: Filter (fully wired) ----------
  // Note: "Diese Woche" is a navigation action (jump to current week),
  // not a filter state, so it never shows the ✓ active marker.
  const publishedActive = state.statusFilter === 'published';
  const draftActive = state.statusFilter === 'draft';
  const absenceActive = state.absenceOnly;
  const col1 = `
    <div class="crew-col">
      <div class="crew-col-header">
        <span class="crew-col-icon icon-filter">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 2.5C1 2.22 1.22 2 1.5 2h13a.5.5 0 0 1 .4.8L10 9v4.5a.5.5 0 0 1-.8.4l-2-1.5a.5.5 0 0 1-.2-.4V9L1.1 2.8A.5.5 0 0 1 1 2.5z"/>
          </svg>
        </span>
        <span>${escapeHtml(t('crew_filter'))}</span>
        <span class="crew-col-count">4</span>
      </div>
      <div class="crew-col-subtitle">${escapeHtml(t('crew_filter_shifts'))}</div>
      <button class="crew-item crew-item-action" data-filter="this-week"><span class="crew-item-arrow">→</span><span class="crew-item-name">${escapeHtml(t('crew_this_week'))}</span></button>
      <button class="crew-item ${publishedActive ? 'active' : ''}" data-filter="published"><span class="crew-item-tick">✓</span><span class="crew-item-name">${escapeHtml(t('published'))}</span></button>
      <button class="crew-item ${draftActive ? 'active' : ''}" data-filter="draft"><span class="crew-item-tick">✓</span><span class="crew-item-name">${escapeHtml(t('draft'))}</span></button>
      <button class="crew-item ${absenceActive ? 'active' : ''}" data-filter="absent"><span class="crew-item-tick">✓</span><span class="crew-item-name">${escapeHtml(t('absences'))}</span></button>
      <div class="crew-divider"></div>
      <button class="crew-create" id="crew-custom-filter">
        <span class="crew-item-name">${escapeHtml(t('crew_custom_filter'))}</span>
        <span class="crew-create-arrow">▾</span>
      </button>
    </div>`;

  // ---------- Column 3: Favoriten (real, dynamic) ----------
  let favRows = '';
  if (names.length) {
    for (const n of names) {
      const active = state.activeCrew === n;
      const count = (state.crews[n] || []).length;
      const avatars = _crewAvatarsFor(n);
      let avatarsHtml = '';
      if (avatars.length) {
        avatarsHtml = '<span class="crew-avatars">';
        for (const e of avatars) {
          avatarsHtml += `<span class="crew-avatar-mini ${escapeHtml(e.avatar_class || '')}">${escapeHtml(e.initials || '?')}</span>`;
        }
        avatarsHtml += '</span>';
      }
      favRows += `<div class="crew-row">
        <button class="crew-item ${active ? 'active' : ''}" data-fav="${escapeHtml(n)}">
          <span class="crew-item-tick">✓</span>
          ${avatarsHtml}
          <span class="crew-item-name">${escapeHtml(n)}</span>
          <span class="crew-item-count">${count}</span>
        </button>
        <button class="crew-item-del" data-del-crew="${escapeHtml(n)}" title="${escapeHtml(t('crew_delete'))}">×</button>
      </div>`;
    }
  } else {
    // Build the hint with a bold link label. The translation already
    // contains the surrounding quotes (e.g. 'Click on "%(label)s".'), so
    // we only wrap the label text in <strong>, not in extra quotes.
    const labelHtml = `<strong>${escapeHtml(t('crew_custom_filter'))}</strong>`;
    const hintText = t('crew_no_favorites_hint', { label: '__LABEL__' });
    const hintHtml = escapeHtml(hintText).replace('__LABEL__', labelHtml);
    favRows = `<div style="padding:20px 14px;text-align:center;color:var(--text-muted);font:500 12px var(--font);line-height:1.5;">
      <div style="font-size:24px;opacity:.5;margin-bottom:6px;">⭐</div>
      ${escapeHtml(t('crew_no_favorites'))}<br/>
      ${hintHtml}
    </div>`;
  }

  const allActive = !state.activeCrew;
  const col3 = `
    <div class="crew-col">
      <div class="crew-col-header">
        <span class="crew-col-icon icon-fav">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0l2.4 5L16 6l-4 4 1 5.5L8 13l-5 2.5L4 10 0 6l5.6-1z"/>
          </svg>
        </span>
        <span>${escapeHtml(t('crew_favorites'))}</span>
        <span class="crew-col-count">${names.length}</span>
      </div>
      <div class="crew-col-subtitle">${escapeHtml(t('crew_saved_teams'))}</div>
      <button class="crew-item ${allActive ? 'active' : ''}" data-all="1">
        <span class="crew-item-tick">✓</span>
        <span class="crew-item-name">${escapeHtml(t('crew_all'))}</span>
      </button>
      ${names.length ? '<div class="crew-divider"></div>' : ''}
      ${favRows}
    </div>`;

  const footer = `<div class="crew-footer">
    <span class="crew-kbd"><kbd>↵</kbd> ${escapeHtml(t('crew_kbd_apply'))}</span>
    <span class="crew-kbd"><kbd>⎋</kbd> ${escapeHtml(t('crew_kbd_close'))}</span>
    <span class="crew-kbd"><kbd>↑</kbd><kbd>↓</kbd> ${escapeHtml(t('crew_kbd_navigate'))}</span>
    <span class="crew-footer-brand">${escapeHtml(t('app_footer_brand'))}</span>
  </div>`;

  panel.innerHTML = resetBar + `<div class="crew-grid">${col1}${col3}</div>` + footer;
}

function toggleCrewDropdown() {
  const panel = document.getElementById('crew-panel');
  if (!panel) return;
  if (panel.classList.contains('show')) closeCrewDropdown();
  else openCrewDropdown();
}

function openCrewDropdown() {
  const panel = document.getElementById('crew-panel');
  const arrow = document.getElementById('crew-arrow');
  if (!panel) return;
  renderCrewDropdown();
  panel.classList.add('show');
  if (arrow) {
    arrow.classList.add('open');
    arrow.setAttribute('aria-expanded', 'true');
  }
  const searchDrop = document.getElementById('search-dropdown');
  if (searchDrop) searchDrop.classList.remove('open');
}

function closeCrewDropdown() {
  const panel = document.getElementById('crew-panel');
  const arrow = document.getElementById('crew-arrow');
  if (panel) panel.classList.remove('show');
  if (arrow) {
    arrow.classList.remove('open');
    arrow.setAttribute('aria-expanded', 'false');
  }
}
function ensureCrewModal() {
  if (document.getElementById('crew-modal-backdrop')) return;
  const bd = document.createElement('div');
  bd.id = 'crew-modal-backdrop';
  bd.className = 'crew-modal-backdrop';
  const md = document.createElement('div');
  md.id = 'crew-modal';
  md.className = 'crew-modal';
  document.body.appendChild(bd);
  document.body.appendChild(md);
  bd.addEventListener('click', closeCrewModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && md.classList.contains('show')) closeCrewModal();
  });
}

function updateCrewSelectedCount() {
  const md = document.getElementById('crew-modal');
  if (!md) return;
  const total = md.querySelectorAll('.crew-members .crew-member').length;
  const checked = md.querySelectorAll('.crew-members input[type=checkbox]:checked').length;
  const countEl = md.querySelector('.crew-selected-count');
  if (countEl) countEl.textContent = t('crew_selected_of', { n: checked, total: total });
  // Toggle selected class on row for visual feedback
  md.querySelectorAll('.crew-member').forEach(row => {
    const cb = row.querySelector('input[type=checkbox]');
    row.classList.toggle('selected', !!(cb && cb.checked));
  });
}

function openCrewModal() {
  ensureCrewModal();
  const md = document.getElementById('crew-modal');
  const bd = document.getElementById('crew-modal-backdrop');
  const all = (state.data && state.data.all_employees) || [];

  let memberRows = '';
  for (const e of all) {
    memberRows += `<label class="crew-member" data-name="${escapeHtml((e.name || '').toLowerCase())}">
      <input type="checkbox" value="${e.id}"/>
      <div class="crew-avatar-sm ${escapeHtml(e.avatar_class || '')}">${escapeHtml(e.initials || '?')}</div>
      <div class="crew-member-info">
        <div class="crew-member-name">${escapeHtml(e.name)}</div>
        <div class="crew-member-meta">${escapeHtml(e.role || '')}</div>
      </div>
    </label>`;
  }

  md.innerHTML = `<h3>${escapeHtml(t('crew_new_filter'))}</h3>
    <label class="crew-name-label">${escapeHtml(t('crew_filter_name'))}</label>
    <input type="text" class="crew-name-input" id="crew-name-input" placeholder="${escapeHtml(t('crew_filter_name_placeholder'))}" autocomplete="off"/>
    <label class="crew-name-label">${escapeHtml(t('crew_include_people'))}</label>
    <input type="text" class="crew-member-search" id="crew-member-search" placeholder="${escapeHtml(t('crew_search_employees'))}" autocomplete="off"/>
    <div class="crew-members">${memberRows || '<div class="crew-empty-search">' + escapeHtml(t('crew_no_employees')) + '</div>'}</div>
    <div class="crew-modal-actions">
      <span class="crew-selected-count">${escapeHtml(t('crew_selected_of', { n: 0, total: all.length }))}</span>
      <div class="crew-modal-buttons">
        <button type="button" class="btn-cancel" id="crew-cancel">${escapeHtml(t('cancel'))}</button>
        <button type="button" class="btn-save" id="crew-save">${escapeHtml(t('crew_save_filter'))}</button>
      </div>
    </div>`;

  // Force a frame so the transition runs
  md.classList.add('show');
  bd.classList.add('show');

  const nameInput = document.getElementById('crew-name-input');
  setTimeout(() => nameInput && nameInput.focus(), 10);

  // Click anywhere on the row toggles the checkbox (the <label> wrapping already does this)
  md.querySelectorAll('.crew-members input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', updateCrewSelectedCount);
  });

  // Live search filter
  const search = document.getElementById('crew-member-search');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    md.querySelectorAll('.crew-member').forEach(row => {
      const match = !q || (row.dataset.name || '').includes(q);
      row.style.display = match ? '' : 'none';
    });
  });

  document.getElementById('crew-cancel').addEventListener('click', closeCrewModal);
  document.getElementById('crew-save').addEventListener('click', () => {
    const name = (nameInput.value || '').trim();
    if (!name) { nameInput.focus(); return; }
    const checked = Array.from(md.querySelectorAll('.crew-members input[type=checkbox]:checked'))
      .map(cb => parseInt(cb.value, 10))
      .filter(n => !isNaN(n));
    state.crews[name] = checked;
    saveCrews();
    state.activeCrew = name;
    saveActiveCrew();
    closeCrewModal();
    render();
  });
}

function closeCrewModal() {
  const md = document.getElementById('crew-modal');
  const bd = document.getElementById('crew-modal-backdrop');
  if (md) md.classList.remove('show');
  if (bd) bd.classList.remove('show');
}

// -----------------------------------------------------------
// Init
// -----------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  applyStaticI18n();
  document.getElementById('btn-prev').addEventListener('click', () => { state.offset--; reload(); });
  document.getElementById('btn-next').addEventListener('click', () => { state.offset++; reload(); });

  // Today button — jump to current period
  document.getElementById('btn-today-reset').addEventListener('click', () => {
    state.offset = 0;
    reload();
  });

  // Theme toggle
  const themeKey = 'dienstplan_theme';
  const savedTheme = localStorage.getItem(themeKey) || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  document.getElementById('btn-theme').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(themeKey, next);
  });

  // Global search with spotlight dropdown
  let _searchTimer = null;
  const globalSearchInput = document.getElementById('global-search');
  const globalSearchClear = document.getElementById('global-search-clear');

  // Create dropdown container
  const searchWrap = globalSearchInput.closest('.topbar-search');
  const searchDrop = document.getElementById('search-dropdown');

  let activeFilter = null; // { type: 'employee'|'area'|'status', id, label }

  function renderSearchDropdown(query) {
    if (!query || !state.data) { searchDrop.classList.remove('open'); return; }
    const q = query.toLowerCase();
    const d = state.data;

    // Find matching employees
    const empMatches = d.all_employees.filter(e =>
      e.name.toLowerCase().includes(q) || (e.role || '').toLowerCase().includes(q)
    ).slice(0, 5);

    // Find matching areas
    const areaMatches = d.all_bereiche.filter(b =>
      b.name.toLowerCase().includes(q) || (b.code || '').toLowerCase().includes(q)
    ).slice(0, 5);

    // Find matching shifts (by note, area, employee)
    const shiftMatches = [];
    const empById = {};
    for (const e of d.all_employees) empById[e.id] = e;
    for (const s of d.shifts) {
      const emp = empById[s.employee_id] || {};
      const hay = `${emp.name || ''} ${s.bereich_name || ''} ${s.bereich_code || ''} ${s.notiz || ''}`.toLowerCase();
      if (hay.includes(q)) {
        const dv = parseServerDT(s.datum_von);
        shiftMatches.push({
          id: s.id, empName: emp.name || '?', area: s.bereich_code || s.bereich_name,
          color: s.bereich_color, time: fmtTimeLocal(dv),
          date: t(DAY_KEYS[(dv.getDay() + 6) % 7]) + ' ' + String(dv.getDate()).padStart(2, '0'),
        });
      }
      if (shiftMatches.length >= 5) break;
    }

    // Status filters
    const statusFilters = [
      { id: 'draft', label: 'Draft only', icon: '○' },
      { id: 'published', label: 'Published only', icon: '●' },
    ].filter(s => s.label.toLowerCase().includes(q) || s.id.includes(q));

    if (!empMatches.length && !areaMatches.length && !shiftMatches.length && !statusFilters.length) {
      searchDrop.innerHTML = '<div class="sd-empty">No results for "' + escapeHtml(query) + '"</div>';
      searchDrop.classList.add('open');
      return;
    }

    let html = '';
    if (empMatches.length) {
      html += '<div class="sd-group"><div class="sd-label">EMPLOYEES</div>';
      for (const e of empMatches) {
        html += `<div class="sd-item" data-type="employee" data-id="${e.id}" data-label="${escapeHtml(e.name)}">
          <div class="avatar ${e.avatar_class}" style="width:24px;height:24px;font-size:9px;">${escapeHtml(e.initials)}</div>
          <div class="sd-text"><span class="sd-name">${escapeHtml(e.name)}</span><span class="sd-meta">${escapeHtml(e.role || '')}</span></div>
          <span class="sd-action">Filter ↵</span>
        </div>`;
      }
      html += '</div>';
    }
    if (areaMatches.length) {
      html += '<div class="sd-group"><div class="sd-label">AREAS</div>';
      for (const b of areaMatches) {
        html += `<div class="sd-item" data-type="area" data-id="${b.id}" data-label="${escapeHtml(b.code || b.name)}">
          <span class="swatch" style="background:${b.color};width:10px;height:10px;border-radius:4px;"></span>
          <div class="sd-text"><span class="sd-name">${escapeHtml(b.name)}</span><span class="sd-meta">${escapeHtml(b.code || '')}</span></div>
          <span class="sd-action">Filter ↵</span>
        </div>`;
      }
      html += '</div>';
    }
    if (shiftMatches.length) {
      html += '<div class="sd-group"><div class="sd-label">SHIFTS</div>';
      for (const s of shiftMatches) {
        html += `<div class="sd-item" data-type="shift" data-id="${s.id}" data-label="${escapeHtml(s.area)}">
          <span class="swatch" style="background:${s.color};width:10px;height:10px;border-radius:4px;"></span>
          <div class="sd-text"><span class="sd-name">${escapeHtml(s.empName)} · ${escapeHtml(s.area)}</span>
          <span class="sd-meta">${escapeHtml(s.date)} ${escapeHtml(s.time)}</span></div>
        </div>`;
      }
      html += '</div>';
    }
    if (statusFilters.length) {
      html += '<div class="sd-group"><div class="sd-label">STATUS</div>';
      for (const s of statusFilters) {
        html += `<div class="sd-item" data-type="status" data-id="${s.id}" data-label="${escapeHtml(s.label)}">
          <span style="font-size:12px;">${s.icon}</span>
          <div class="sd-text"><span class="sd-name">${escapeHtml(s.label)}</span></div>
          <span class="sd-action">Filter ↵</span>
        </div>`;
      }
      html += '</div>';
    }

    searchDrop.innerHTML = html;
    searchDrop.classList.add('open');

    // Click handlers for dropdown items
    searchDrop.querySelectorAll('.sd-item').forEach(item => {
      item.addEventListener('click', () => {
        const type = item.dataset.type;
        const id = item.dataset.id;
        const label = item.dataset.label;
        if (type === 'status') {
          // Filter by draft/published
          state.statusFilter = id;
          globalSearchInput.value = '';
          state.globalFilter = '';
        } else {
          // Apply as text filter
          globalSearchInput.value = label;
          state.globalFilter = label;
        }
        searchDrop.classList.remove('open');
        globalSearchClear.classList.toggle('visible', !!globalSearchInput.value);
        if (state.data) { renderGrid(); renderSidebar(); attachDnd(); }
      });
    });
  }

  function _doSearch() {
    const q = globalSearchInput.value.trim();
    state.globalFilter = q;
    renderSearchDropdown(q);
    if (state.data) { renderGrid(); renderSidebar(); attachDnd(); }
    globalSearchClear.classList.toggle('visible', !!q);
  }
  globalSearchInput.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(_doSearch, 120);
  });
  globalSearchInput.addEventListener('focus', () => {
    if (globalSearchInput.value.trim()) renderSearchDropdown(globalSearchInput.value.trim());
  });
  globalSearchClear.addEventListener('click', () => {
    globalSearchInput.value = '';
    state.globalFilter = '';
    state.statusFilter = null;
    searchDrop.classList.remove('open');
    globalSearchClear.classList.remove('visible');
    if (state.data) { renderGrid(); renderSidebar(); attachDnd(); }
    globalSearchInput.focus();
  });
  // Close dropdown on click outside
  document.addEventListener('click', e => {
    if (!searchWrap.contains(e.target)) searchDrop.classList.remove('open');
  });
  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && searchDrop.classList.contains('open')) {
      searchDrop.classList.remove('open');
      globalSearchInput.blur();
    }
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      globalSearchInput.focus();
      globalSearchInput.select();
    }
  });

  document.getElementById('btn-tv').addEventListener('click', () => {
    window.open('/dienstplan/print?offset=' + state.offset, '_blank');
  });

  // Sidebar tab switching
  document.querySelectorAll('.sidebar-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      sidebarTab = btn.dataset.tab;
      document.querySelectorAll('.sidebar-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === sidebarTab));
      renderSidebar();
      attachDnd();
    });
  });
  // Sidebar add button (context-sensitive)
  document.getElementById('btn-sidebar-add').addEventListener('click', () => {
    if (sidebarTab === 'employees') openCreateEmployeePopover();
    else if (sidebarTab === 'areas') openCreateBereichPopover();
    else openCreateVorlagePopover();
  });
  document.getElementById('sidebar-search').addEventListener('input', e => {
    state.empFilter = e.target.value;
    renderSidebar();
    attachDnd();
  });

  // View mode segmented control
  document.querySelectorAll('.view-seg button').forEach(btn => {
    btn.addEventListener('click', () => {
      state.viewMode = btn.dataset.view;
      state.offset = 0;
      reload();
    });
  });

  // Refresh button
  const refreshBtn = document.getElementById('btn-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', () => reload());

  // Settings button
  const settingsBtn = document.getElementById('btn-settings');
  if (settingsBtn) settingsBtn.addEventListener('click', () => openSettingsPopover());

  // Stat-card click handlers — three clickable cards
  const cardPlanned   = document.getElementById('card-planned-hours');
  const cardAbsences  = document.getElementById('card-absences');
  const cardConflicts = document.getElementById('card-conflicts');
  const wire = (el, fn) => {
    if (!el) return;
    el.addEventListener('click', fn);
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
    });
  };
  wire(cardPlanned,   openPlannedHoursPopover);
  wire(cardAbsences,  openAbsencesPopover);
  wire(cardConflicts, openScheduleHealthPopover);

  // ---- Mobile drawer ----
  const sidebar = document.getElementById('sidebar');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const hamburger = document.getElementById('hamburger');
  const sidebarClose = document.getElementById('sidebar-close');
  const closeSidebar = () => {
    sidebar.classList.remove('open');
    sidebarBackdrop.classList.remove('open');
  };
  const openSidebar = () => {
    sidebar.classList.add('open');
    sidebarBackdrop.classList.add('open');
  };
  hamburger.addEventListener('click', e => {
    e.stopPropagation();
    if (sidebar.classList.contains('open')) closeSidebar();
    else openSidebar();
  });
  sidebarBackdrop.addEventListener('click', closeSidebar);
  sidebarClose.addEventListener('click', closeSidebar);
  // Close drawer when window resizes back to desktop
  window.addEventListener('resize', () => {
    if (window.innerWidth > 880) closeSidebar();
  });
  // Close drawer on Escape (only on mobile when it's open as overlay)
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
  });

  // Crew filters: load saved, inject styles + dropdown trigger + modal
  loadCrews();
  loadFilters();
  injectCrewStyles();
  ensureCrewDropdown();
  ensureCrewModal();

  reload();
});

})();