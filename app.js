// Rolodex PWA - Version 7 Codebase
const DB_NAME = 'RolodexDB';
const DB_VERSION = 2;
const BACKUP_FILENAME = 'rolodex_backup.json';
let db = null;

let activeTab = 'home';
let currentWeekOffset = 0;
let currentProject = 'All';
let currentAspect = 'Daily';
let showReminderSummary = false;
let selectedLongPressItem = null;
let selectedEventPersons = [];
let customProjects = ['Default Tasks'];
let customAspects = ['Daily'];
let editingLogContext = null;
let editingPersonPhoto = null;
let peopleSearchQuery = '';
let journalSelectedDateStr = null;
let journalSelectedLabels = [];
let journalSearchQuery = '';
let backupDirHandle = null;

function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) {
    return new Date(dateStr.getFullYear(), dateStr.getMonth(), dateStr.getDate());
  }
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length === 3 && !parts.some(Number.isNaN)) {
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  const d = new Date(dateStr);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toIsoDateStr(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTodayLocal() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Secondary Calendar Helper (Week starts Sunday; Quarter starts on Sunday of week containing Oct 16) -> WW-QQ-MM-YY
function getSundayOfWeek(dateObj) {
  const d = parseLocalDate(dateObj);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
}

function getSecondaryCycleStartSunday(dateObj) {
  const d = parseLocalDate(dateObj);
  const year = d.getFullYear();
  const oct16ThisYear = new Date(year, 9, 16);
  const cycleStartThisYear = getSundayOfWeek(oct16ThisYear);

  if (d < cycleStartThisYear) {
    const oct16PrevYear = new Date(year - 1, 9, 16);
    return {
      startSunday: getSundayOfWeek(oct16PrevYear),
      personalYearNum: (year - 1) - 1991
    };
  }

  return {
    startSunday: cycleStartThisYear,
    personalYearNum: year - 1991
  };
}

function getSecondaryCalendarKey(dateObj) {
  const d = parseLocalDate(dateObj);
  const { startSunday, personalYearNum } = getSecondaryCycleStartSunday(d);
  const currentSunday = getSundayOfWeek(d);

  const msPerDay = 1000 * 60 * 60 * 24;
  const diffWeeks = Math.floor((currentSunday - startSunday) / (msPerDay * 7));
  let weekNum = diffWeeks + 1;
  let quarterNum = Math.floor(diffWeeks / 13) + 1;
  let monthNum = Math.floor(diffWeeks / 4) + 1;

  if (quarterNum > 4) {
    quarterNum = 4;
  }
  if (weekNum > 52) {
    weekNum = 0;
    monthNum = 0;
    quarterNum = 4;
  }

  const ww = String(weekNum).padStart(2, '0');
  const qq = String(quarterNum).padStart(2, '0');
  const mm = String(monthNum).padStart(2, '0');
  const yy = String(((personalYearNum % 100) + 100) % 100).padStart(2, '0');

  return `${ww}-${qq}-${mm}-${yy}`;
}

// Primary / Regular Calendar Helper -> DD-WW-MM-YY
function getRegularCalendarKey(dateObj) {
  const localD = parseLocalDate(dateObj);
  const d = new Date(Date.UTC(localD.getFullYear(), localD.getMonth(), localD.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);

  const dd = String(localD.getDate()).padStart(2, '0');
  const ww = String(weekNo).padStart(2, '0');
  const mm = String(localD.getMonth() + 1).padStart(2, '0');
  const yy = String(localD.getFullYear() % 100).padStart(2, '0');

  return `${dd}-${ww}-${mm}-${yy}`;
}

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('tasks')) db.createObjectStore('tasks', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('reminders')) db.createObjectStore('reminders', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('people')) db.createObjectStore('people', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('dayLogs')) db.createObjectStore('dayLogs', { keyPath: 'date' });
    };
  });
}

function getAll(storeName) {
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
  });
}

function getMeta(key) {
  return new Promise((resolve) => {
    if (!db || !db.objectStoreNames.contains('meta')) return resolve(null);
    const tx = db.transaction('meta', 'readonly');
    const req = tx.objectStore('meta').get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
  });
}

function setMeta(key, value) {
  return new Promise((resolve) => {
    if (!db || !db.objectStoreNames.contains('meta')) return resolve();
    const tx = db.transaction('meta', 'readwrite');
    const req = tx.objectStore('meta').put({ key, value });
    req.onsuccess = () => resolve();
  });
}

function saveItem(storeName, item) {
  return new Promise((resolve) => {
    if (item.date) {
      item.secDateKey = getSecondaryCalendarKey(parseLocalDate(item.date));
    }
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = item.id ? store.put(item) : store.add(item);
    req.onsuccess = () => resolve(req.result);
  });
}

function deleteItem(storeName, id) {
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(id);
    req.onsuccess = () => resolve();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  journalSelectedDateStr = toIsoDateStr(getTodayLocal());
  await initDB();
  registerServiceWorker();
  setupTabNavigation();
  setupEventListeners();
  await initBackupSystem();
  renderAll();
});

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.error('SW reg error:', err));
  }
}

function setupEventListeners() {
  document.getElementById('settings-btn').addEventListener('click', async () => {
    renderSettingsDropdowns();
    await refreshBackupStatusUI();
    document.getElementById('settings-modal').classList.remove('hidden');
  });
  document.getElementById('close-settings-modal').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
  });

  document.getElementById('select-backup-folder-btn').addEventListener('click', selectBackupFolder);
  document.getElementById('push-backup-btn').addEventListener('click', () => {
    if (confirm('Push current app data to backup?')) pushBackupToFolder(false);
  });
  document.getElementById('update-from-backup-btn').addEventListener('click', updateDataFromBackup);
  document.getElementById('fallback-backup-file-input').addEventListener('change', handleFallbackBackupFileSelected);

  document.querySelectorAll('.sample-btn').forEach(btn => {
    btn.addEventListener('click', (e) => downloadSample(e.target.dataset.type));
  });

  const summaryToggle = document.getElementById('home-summary-toggle');
  if (summaryToggle) {
    summaryToggle.addEventListener('change', (e) => {
      showReminderSummary = e.target.checked;
      renderHome();
    });
  }

  document.getElementById('prev-week-btn').addEventListener('click', () => { currentWeekOffset--; renderHome(); });
  document.getElementById('next-week-btn').addEventListener('click', () => { currentWeekOffset++; renderHome(); });
  document.getElementById('reset-week-btn').addEventListener('click', () => { currentWeekOffset = 0; renderHome(); });
  document.getElementById('close-day-modal').addEventListener('click', () => {
    document.getElementById('day-details-modal').classList.add('hidden');
  });
  document.getElementById('close-reminder-calendar-modal')?.addEventListener('click', () => {
    document.getElementById('reminder-calendar-modal').classList.add('hidden');
    activeHabitReminderId = null;
  });
  document.getElementById('habit-prev-month-btn')?.addEventListener('click', async () => {
    if (!activeHabitMonthDate) activeHabitMonthDate = getTodayLocal();
    activeHabitMonthDate = new Date(activeHabitMonthDate.getFullYear(), activeHabitMonthDate.getMonth() - 1, 1);
    await renderReminderHabitCalendarModal();
  });
  document.getElementById('habit-next-month-btn')?.addEventListener('click', async () => {
    if (!activeHabitMonthDate) activeHabitMonthDate = getTodayLocal();
    activeHabitMonthDate = new Date(activeHabitMonthDate.getFullYear(), activeHabitMonthDate.getMonth() + 1, 1);
    await renderReminderHabitCalendarModal();
  });

  document.getElementById('task-deadline-type').addEventListener('change', updateTaskDeadlineInput);
  document.getElementById('task-form').addEventListener('submit', handleTaskSubmit);
  document.getElementById('add-project-btn').addEventListener('click', addProjectPrompt);

  document.getElementById('event-form').addEventListener('submit', handleEventSubmit);

  document.getElementById('reminder-form').addEventListener('submit', handleReminderSubmit);
  document.querySelectorAll('.day-chip').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('selected'));
  });
  document.getElementById('add-aspect-btn').addEventListener('click', addAspectPrompt);

  document.getElementById('add-phone-btn').addEventListener('click', () => addDynamicField('phones-container', 'phone', ''));
  document.getElementById('add-email-btn').addEventListener('click', () => addDynamicField('emails-container', 'email', ''));
  document.getElementById('add-relationship-btn').addEventListener('click', () => addRelationshipField());
  document.getElementById('person-photo-input').addEventListener('change', handlePersonPhotoInputChange);
  document.getElementById('person-form').addEventListener('submit', handlePersonSubmit);
  document.getElementById('close-person-modal').addEventListener('click', () => {
    document.getElementById('person-details-modal').classList.add('hidden');
  });

  const peopleSearch = document.getElementById('people-search-input');
  if (peopleSearch) {
    peopleSearch.addEventListener('input', (e) => {
      peopleSearchQuery = e.target.value.trim().toLowerCase();
      renderPeople();
    });
  }

  document.getElementById('close-photo-viewer-modal').addEventListener('click', () => {
    document.getElementById('photo-viewer-modal').classList.add('hidden');
  });

  const jDatePicker = document.getElementById('journal-date-picker');
  if (jDatePicker) {
    jDatePicker.addEventListener('change', (e) => {
      if (e.target.value) {
        journalSelectedDateStr = e.target.value;
        renderJournal();
      }
    });
  }

  const jSearchToggle = document.getElementById('journal-search-toggle-btn');
  if (jSearchToggle) {
    jSearchToggle.addEventListener('click', () => {
      const box = document.getElementById('journal-search-box');
      if (!box) return;
      box.classList.toggle('hidden');
      if (!box.classList.contains('hidden')) {
        const inp = document.getElementById('journal-search-input');
        if (inp) inp.focus();
      } else {
        journalSearchQuery = '';
        const inp = document.getElementById('journal-search-input');
        if (inp) inp.value = '';
        renderJournal();
      }
    });
  }

  const jSearchInput = document.getElementById('journal-search-input');
  if (jSearchInput) {
    jSearchInput.addEventListener('input', (e) => {
      journalSearchQuery = e.target.value.trim().toLowerCase();
      renderJournal();
    });
  }

  document.getElementById('settings-delete-project-btn').addEventListener('click', deleteSelectedProject);
  document.getElementById('settings-delete-aspect-btn').addEventListener('click', deleteSelectedAspect);

  document.getElementById('action-cancel-btn').addEventListener('click', () => {
    document.getElementById('action-modal').classList.add('hidden');
  });
  document.getElementById('action-duplicate-btn').addEventListener('click', handleLongPressDuplicate);
  document.getElementById('action-delete-btn').addEventListener('click', handleLongPressDelete);
  document.getElementById('action-edit-btn').addEventListener('click', handleLongPressEdit);

  setupTaskPersonSearch();
  setupEventPersonSearch();
}

function setupTabNavigation() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      document.getElementById(`tab-${activeTab}`).classList.add('active');
      renderAll();
    });
  });
}

function renderAll() {
  renderHome();
  renderTasks();
  renderEvents();
  renderReminders();
  renderPeople();
  renderJournal();
}

// --- HOME TAB: Exclusive Toggle (Tasks+Events vs Reminders) ---
async function renderHome() {
  const tasks = await getAll('tasks');
  const events = await getAll('events');
  const reminders = await getAll('reminders');

  renderAgendaSummary(tasks, events, reminders);

  const today = getTodayLocal();
  const startOfWeek = getStartOfWeek(today, currentWeekOffset);
  const weekDaysContainer = document.getElementById('week-days-container');
  weekDaysContainer.innerHTML = '';

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const weekEnd = new Date(startOfWeek);
  weekEnd.setDate(weekEnd.getDate() + 6);

  document.getElementById('week-range-label').textContent =
    `${startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(startOfWeek);
    dayDate.setDate(dayDate.getDate() + i);
    const dateStr = toIsoDateStr(dayDate);
    const isToday = dayDate.getTime() === today.getTime();

    const dayTasks = tasks.filter(t => t.deadline === dateStr);
    const dayEvents = events.filter(ev => isEventOnDate(ev, dayDate));
    const dayReminders = reminders.filter(r => isReminderOnDate(r, dayDate));

    const regKey = getRegularCalendarKey(dayDate);
    const secKey = getSecondaryCalendarKey(dayDate);

    let summaryText = `Tasks: ${dayTasks.length} | Events: ${dayEvents.length}`;
    if (showReminderSummary) {
      const weekPeriodOccs = [];
      reminders.forEach(r => {
        if (r.routine) {
          if (isReminderOnDate(r, dayDate)) {
            getReminderOccurrencesOnDate(r, dayDate).forEach(occ => weekPeriodOccs.push({ r, occ }));
          }
        } else {
          getReminderOccurrencesInWeek(r, startOfWeek).forEach(occ => weekPeriodOccs.push({ r, occ }));
        }
      });
      summaryText = weekPeriodOccs.length
        ? `Reminders (${weekPeriodOccs.length}): ${weekPeriodOccs.map(({ r, occ }) => `${r.title} [${occ.date}${occ.completed ? ' ✓' : ''}]`).join(', ')}`
        : 'Reminders: None';
    }

    const row = document.createElement('div');
    row.className = `day-row-container ${isToday ? 'today-highlight' : ''}`;
    row.innerHTML = `
      <div class="day-row-top">
        <span class="day-reg-cal">${regKey}</span>
        <span class="day-center-label">${dayNames[i]}</span>
        <span class="day-sec-cal">${secKey}</span>
      </div>
      <div class="day-summary-bottom">${summaryText}</div>
    `;
    row.addEventListener('click', () => showDayDetails(dayNames[i], dateStr, tasks, dayEvents, showReminderSummary ? dayReminders : [], dayDate));
    weekDaysContainer.appendChild(row);
  }
}

function getStartOfWeek(d, weekOffset = 0) {
  const base = parseLocalDate(d);
  const day = base.getDay();
  const diff = base.getDate() - day + (weekOffset * 7);
  return new Date(base.getFullYear(), base.getMonth(), diff);
}

function isReminderInWeek(r, startDate) {
  const start = parseLocalDate(startDate);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    if (isReminderOnDate(r, d)) return true;
  }
  return false;
}

function isReminderInMonth(r, targetDate) {
  const d = parseLocalDate(targetDate);
  const year = d.getFullYear();
  const month = d.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    if (isReminderOnDate(r, new Date(year, month, day))) return true;
  }
  return false;
}

function isReminderInQuarter(r, targetDate) {
  const d = parseLocalDate(targetDate);
  const q = Math.floor(d.getMonth() / 3);
  const startMonth = q * 3;
  for (let m = startMonth; m < startMonth + 3; m++) {
    if (isReminderInMonth(r, new Date(d.getFullYear(), m, 1))) return true;
  }
  return false;
}

function isTaskInWeek(t, startDate) {
  const start = parseLocalDate(startDate);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    if (t.deadline === toIsoDateStr(d)) return true;
  }
  return false;
}

function isTaskInMonth(t, targetDate) {
  if (!t.deadline) return false;
  const d = parseLocalDate(t.deadline);
  const ref = parseLocalDate(targetDate);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

function isTaskInQuarter(t, targetDate) {
  if (!t.deadline) return false;
  const d = parseLocalDate(t.deadline);
  const ref = parseLocalDate(targetDate);
  return d.getFullYear() === ref.getFullYear() && Math.floor(d.getMonth() / 3) === Math.floor(ref.getMonth() / 3);
}

function renderAgendaSummary(tasks, events, reminders) {
  const today = getTodayLocal();
  const todayStr = toIsoDateStr(today);
  const weekStart = getStartOfWeek(today, currentWeekOffset);

  if (showReminderSummary) {
    const todayEntries = [];
    const weekEntries = [];
    const monthEntries = [];
    const quarterEntries = [];

    reminders.forEach(r => {
      const isRoutine = Boolean(r.routine);
      const todayOccs = getReminderOccurrencesOnDate(r, today);
      todayOccs.forEach(occ => {
        todayEntries.push({ reminder: r, occ });
      });

      if (isRoutine) {
        todayOccs.forEach(occ => {
          weekEntries.push({ reminder: r, occ });
          monthEntries.push({ reminder: r, occ });
          quarterEntries.push({ reminder: r, occ });
        });
      } else {
        getReminderOccurrencesInWeek(r, weekStart).forEach(occ => weekEntries.push({ reminder: r, occ }));
        getReminderOccurrencesInMonth(r, today).forEach(occ => monthEntries.push({ reminder: r, occ }));
        getReminderOccurrencesInQuarter(r, today).forEach(occ => quarterEntries.push({ reminder: r, occ }));
      }
    });

    renderAgendaList('agenda-today', todayEntries, 'reminder');
    renderAgendaList('agenda-week', weekEntries, 'reminder');
    renderAgendaList('agenda-month', monthEntries, 'reminder');
    renderAgendaList('agenda-quarter', quarterEntries, 'reminder');
  } else {
    const todayCombined = [
      ...tasks.filter(t => t.deadline === todayStr).map(t => ({ kind: 'task', item: t })),
      ...events.filter(ev => isEventOnDate(ev, today)).map(ev => ({ kind: 'event', item: ev }))
    ];
    const weekCombined = [
      ...tasks.filter(t => isTaskInWeek(t, weekStart)).map(t => ({ kind: 'task', item: t })),
      ...events.filter(ev => isEventInWeek(ev, today)).map(ev => ({ kind: 'event', item: ev }))
    ];
    const monthCombined = [
      ...tasks.filter(t => isTaskInMonth(t, today)).map(t => ({ kind: 'task', item: t })),
      ...events.filter(ev => isEventInMonth(ev, today)).map(ev => ({ kind: 'event', item: ev }))
    ];
    const quarterCombined = [
      ...tasks.filter(t => isTaskInQuarter(t, today)).map(t => ({ kind: 'task', item: t })),
      ...events.filter(ev => isEventInQuarter(ev, today)).map(ev => ({ kind: 'event', item: ev }))
    ];

    renderAgendaList('agenda-today', todayCombined, 'tasksEvents');
    renderAgendaList('agenda-week', weekCombined, 'tasksEvents');
    renderAgendaList('agenda-month', monthCombined, 'tasksEvents');
    renderAgendaList('agenda-quarter', quarterCombined, 'tasksEvents');
  }
}

function renderAgendaList(containerId, items, mode = 'tasksEvents') {
  const container = document.getElementById(containerId);
  if (items.length === 0) {
    const emptyText = mode === 'reminder' ? 'No reminders' : 'No tasks or events';
    container.innerHTML = `<div class="agenda-item text-muted">${emptyText}</div>`;
    return;
  }
  if (mode === 'reminder') {
    container.innerHTML = '';
    items.forEach(entry => {
      const rem = entry.reminder || entry;
      const occ = entry.occ || { date: '', completed: false };
      const row = document.createElement('div');
      row.className = `occurrence-item ${occ.completed ? 'completed' : ''}`;

      const left = document.createElement('label');
      left.className = 'occurrence-left';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = Boolean(occ.completed);
      cb.addEventListener('change', (ev) => {
        ev.stopPropagation();
        toggleReminderOccurrenceCompletion(rem.id, occ.date);
      });

      const span = document.createElement('span');
      span.className = 'occurrence-label';
      span.innerHTML = `<strong>${escapeHtml(rem.title)}</strong> (${escapeHtml(occ.date || rem.aspect || 'Daily')})${rem.routine ? ' <span class="routine-badge">Routine</span>' : ''}`;

      left.appendChild(cb);
      left.appendChild(span);
      row.appendChild(left);
      container.appendChild(row);
    });
  } else {
    container.innerHTML = items.map(entry => {
      if (entry.kind === 'task') {
        return `<div class="agenda-item">• <strong>Task</strong>: ${escapeHtml(entry.item.title)} (${escapeHtml(entry.item.deadline || '')})</div>`;
      }
      const ev = entry.item;
      const peopleText = ev.persons && ev.persons.length ? ev.persons.join(', ') : 'Event';
      return `<div class="agenda-item">• <strong>${escapeHtml(ev.type)}</strong>: ${escapeHtml(peopleText)} (${escapeHtml(ev.date || '')})</div>`;
    }).join('');
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- TASKS TAB ---
async function renderTasks() {
  const tasks = await getAll('tasks');
  const people = await getAll('people');
  window.cachedPeople = people;

  const setProjects = [...new Set(['Default Tasks', ...tasks.map(t => t.project).filter(Boolean), ...customProjects])];
  customProjects = setProjects;

  const chipsContainer = document.getElementById('project-chips');
  chipsContainer.innerHTML = ['All', ...customProjects].map(p => `
    <div class="chip ${currentProject === p ? 'active' : ''}" onclick="selectProject('${p.replace(/'/g, "\'")}')">${escapeHtml(p)}</div>
  `).join('');

  const projectSelect = document.getElementById('task-project');
  projectSelect.innerHTML = customProjects.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');

  const filteredTasks = currentProject === 'All' ? tasks : tasks.filter(t => t.project === currentProject);
  const tasksList = document.getElementById('tasks-list');
  tasksList.innerHTML = '';

  filteredTasks.forEach(t => {
    const person = people.find(p => p.id == t.assigned);
    const item = document.createElement('div');
    item.className = `list-item ${t.completed ? 'completed' : ''}`;
    item.innerHTML = `
      <div>
        <div class="item-title">${escapeHtml(t.title)}</div>
        <div class="item-details">Project: ${escapeHtml(t.project)} | Assigned: ${person ? escapeHtml(person.name) : 'None'} | Deadline: ${escapeHtml(t.deadline)}</div>
      </div>
    `;

    item.addEventListener('click', async () => {
      t.completed = !t.completed;
      await saveItem('tasks', t);
      renderTasks();
    });

    addLongPressHandler(item, () => openActionModal('tasks', t));
    tasksList.appendChild(item);
  });
}

function updateTaskDeadlineInput() {
  const type = document.getElementById('task-deadline-type').value;
  const container = document.getElementById('task-deadline-input-container');
  if (type === 'date') {
    container.innerHTML = `<input type="date" id="task-deadline-val" required>`;
  } else if (type === 'week') {
    container.innerHTML = `<input type="week" id="task-deadline-val" required>`;
  } else if (type === 'month') {
    container.innerHTML = `<input type="month" id="task-deadline-val" required>`;
  } else {
    container.innerHTML = `
      <select id="task-deadline-val" required>
        <option value="Q1">Q1 (Jan-Mar)</option>
        <option value="Q2">Q2 (Apr-Jun)</option>
        <option value="Q3">Q3 (Jul-Sep)</option>
        <option value="Q4">Q4 (Oct-Dec)</option>
      </select>`;
  }
}

async function handleTaskSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('task-id').value;
  const task = {
    title: document.getElementById('task-title').value,
    assigned: document.getElementById('task-assigned').value,
    project: document.getElementById('task-project').value || 'Default Tasks',
    deadlineType: document.getElementById('task-deadline-type').value,
    deadline: document.getElementById('task-deadline-val').value,
    completed: false
  };
  if (id) task.id = parseInt(id, 10);
  await saveItem('tasks', task);
  document.getElementById('task-form').reset();
  document.getElementById('task-id').value = '';
  document.getElementById('task-assigned').value = '';
  document.getElementById('task-assigned-search').value = '';
  renderTasks();
  renderHome();
}

function selectProject(p) {
  currentProject = p;
  renderTasks();
}

function addProjectPrompt() {
  const name = prompt('Enter new project name:');
  if (name) {
    if (!customProjects.includes(name)) customProjects.push(name);
    currentProject = name;
    renderTasks();
  }
}

// --- EVENTS TAB ---
async function renderEvents() {
  const events = await getAll('events');
  const people = await getAll('people');
  window.cachedPeople = people;

  const now = getTodayLocal();
  const currentQuarterEvents = events.filter(ev => isEventInQuarterWithLead(ev, now));

  const eventsList = document.getElementById('events-list');
  eventsList.innerHTML = '';

  currentQuarterEvents.forEach(ev => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div>
        <div class="item-title">${escapeHtml(ev.type)} - ${ev.persons && ev.persons.length ? escapeHtml(ev.persons.join(', ')) : 'Event'}</div>
        <div class="item-details">Recurring Date: ${escapeHtml(ev.date)}</div>
      </div>
    `;
    addLongPressHandler(item, () => openActionModal('events', ev));
    eventsList.appendChild(item);
  });
}

async function handleEventSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('event-id').value;
  const checkedPersons = [...selectedEventPersons];
  const eventObj = {
    persons: checkedPersons,
    type: document.getElementById('event-type').value,
    date: document.getElementById('event-date').value,
  };
  if (id) eventObj.id = parseInt(id, 10);
  await saveItem('events', eventObj);
  document.getElementById('event-form').reset();
  selectedEventPersons = [];
  renderEventPersonTags();
  document.getElementById('event-id').value = '';
  renderEvents();
  renderHome();
}

function isEventOnDate(ev, targetDate) {
  if (!ev.date) return false;
  const eDate = parseLocalDate(ev.date);
  const tDate = parseLocalDate(targetDate);
  return eDate.getMonth() === tDate.getMonth() && eDate.getDate() === tDate.getDate();
}

function isEventInWeek(ev, today) {
  const base = parseLocalDate(today);
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    if (isEventOnDate(ev, d)) return true;
  }
  return false;
}

function isEventInMonth(ev, today) {
  if (!ev.date) return false;
  const eDate = parseLocalDate(ev.date);
  const tDate = parseLocalDate(today);
  return eDate.getMonth() === tDate.getMonth();
}

function isEventInQuarter(ev, today) {
  if (!ev.date) return false;
  const eDate = parseLocalDate(ev.date);
  const tDate = parseLocalDate(today);
  return Math.floor(tDate.getMonth() / 3) === Math.floor(eDate.getMonth() / 3);
}

function isEventInQuarterWithLead(ev, today) {
  if (!ev.date) return false;
  const tDate = parseLocalDate(today);
  const leadStart = new Date(tDate);
  leadStart.setDate(leadStart.getDate() - 3);
  const eDate = parseLocalDate(ev.date);
  const currentQ = Math.floor(tDate.getMonth() / 3);
  const eventQ = Math.floor(eDate.getMonth() / 3);
  return (currentQ === eventQ) || (eDate >= leadStart && eDate <= tDate);
}

// --- REMINDERS TAB: End Date, Aspect Collapsible Groups, Habit Calendar Modal & Completion ---
const DEFAULT_REMINDER_END_DATE = '2051-10-15';
let expandedReminderAspect = null;
let activeHabitReminderId = null;
let activeHabitMonthDate = null;

function generateReminderOccurrences(reminder) {
  const occurrences = [];
  const start = parseLocalDate(reminder.startDate);
  if (!start || Number.isNaN(start.getTime())) return occurrences;

  const end = parseLocalDate(reminder.endDate || DEFAULT_REMINDER_END_DATE);
  if (!end || Number.isNaN(end.getTime()) || end < start) return occurrences;

  const interval = Math.max(1, parseInt(reminder.weeksInterval, 10) || 1);
  const selectedDays = Array.isArray(reminder.days) ? reminder.days : [];
  const existingMap = new Map();
  if (Array.isArray(reminder.occurrences)) {
    reminder.occurrences.forEach(occ => {
      if (occ && occ.date) existingMap.set(occ.date, Boolean(occ.completed));
    });
  }

  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (cursor <= end) {
    const diffDays = Math.floor((cursor - start) / (1000 * 60 * 60 * 24));
    const weeksDiff = Math.floor(diffDays / 7);
    const weekMatches = (weeksDiff % interval) === 0;
    const dayMatches = selectedDays.length === 0 ? true : selectedDays.includes(cursor.getDay());

    if (weekMatches && dayMatches) {
      const dateStr = toIsoDateStr(cursor);
      occurrences.push({
        date: dateStr,
        completed: existingMap.has(dateStr) ? existingMap.get(dateStr) : false
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return occurrences;
}

function getReminderOccurrenceDates(r) {
  if (Array.isArray(r.occurrences) && r.occurrences.length) {
    return r.occurrences;
  }
  return generateReminderOccurrences(r);
}

function getReminderOccurrencesOnDate(r, dateObj) {
  const targetStr = toIsoDateStr(parseLocalDate(dateObj));
  return getReminderOccurrenceDates(r).filter(occ => occ.date === targetStr);
}

function isReminderOnDate(r, date) {
  return getReminderOccurrencesOnDate(r, date).length > 0;
}

function isReminderInWeek(r, startDate) {
  const start = parseLocalDate(startDate);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    if (isReminderOnDate(r, d)) return true;
  }
  return false;
}

function isReminderInMonth(r, targetDate) {
  const d = parseLocalDate(targetDate);
  const year = d.getFullYear();
  const month = d.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    if (isReminderOnDate(r, new Date(year, month, day))) return true;
  }
  return false;
}

function isReminderInQuarter(r, targetDate) {
  const d = parseLocalDate(targetDate);
  const q = Math.floor(d.getMonth() / 3);
  const startMonth = q * 3;
  for (let m = startMonth; m < startMonth + 3; m++) {
    if (isReminderInMonth(r, new Date(d.getFullYear(), m, 1))) return true;
  }
  return false;
}

function getReminderOccurrencesInWeek(r, startDate) {
  const start = parseLocalDate(startDate);
  const list = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const dStr = toIsoDateStr(d);
    getReminderOccurrenceDates(r).forEach(occ => {
      if (occ.date === dStr) list.push(occ);
    });
  }
  return list;
}

function getReminderOccurrencesInMonth(r, targetDate) {
  const d = parseLocalDate(targetDate);
  const year = d.getFullYear();
  const month = d.getMonth();
  return getReminderOccurrenceDates(r).filter(occ => {
    const od = parseLocalDate(occ.date);
    return od.getFullYear() === year && od.getMonth() === month;
  });
}

function getReminderOccurrencesInQuarter(r, targetDate) {
  const d = parseLocalDate(targetDate);
  const year = d.getFullYear();
  const q = Math.floor(d.getMonth() / 3);
  return getReminderOccurrenceDates(r).filter(occ => {
    const od = parseLocalDate(occ.date);
    return od.getFullYear() === year && Math.floor(od.getMonth() / 3) === q;
  });
}

async function toggleReminderOccurrenceCompletion(reminderId, occDate) {
  const reminders = await getAll('reminders');
  const rem = reminders.find(item => item.id == reminderId);
  if (!rem) return;

  const occs = getReminderOccurrenceDates(rem).map(occ =>
    occ.date === occDate ? { ...occ, completed: !occ.completed } : occ
  );
  rem.occurrences = occs;
  await saveItem('reminders', rem);
  renderReminders();
  renderHome();
  if (activeHabitReminderId == reminderId && !document.getElementById('reminder-calendar-modal').classList.contains('hidden')) {
    await renderReminderHabitCalendarModal();
  }
}

function getReminderCompletionScoreThroughYesterday(reminder) {
  const start = parseLocalDate(reminder.startDate);
  if (!start || Number.isNaN(start.getTime())) return 0;

  const today = getTodayLocal();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (yesterday < start) return 0;

  const yesterdayStr = toIsoDateStr(yesterday);
  const occs = getReminderOccurrenceDates(reminder).filter(occ => occ.date <= yesterdayStr);
  if (!occs.length) return 0;

  const completedCount = occs.filter(occ => Boolean(occ.completed)).length;
  return Math.round((completedCount / occs.length) * 100);
}

async function duplicateReminderItem(reminder) {
  const copy = {
    title: `${reminder.title} (Copy)`,
    startDate: reminder.startDate,
    endDate: reminder.endDate || DEFAULT_REMINDER_END_DATE,
    routine: Boolean(reminder.routine),
    aspect: reminder.aspect || 'Daily',
    weeksInterval: reminder.weeksInterval || 1,
    days: Array.isArray(reminder.days) ? [...reminder.days] : [],
    occurrences: []
  };
  copy.occurrences = generateReminderOccurrences(copy);
  await saveItem('reminders', copy);
  renderReminders();
  renderHome();
}

async function openReminderHabitCalendar(reminderId) {
  const reminders = await getAll('reminders');
  const rem = reminders.find(r => r.id == reminderId);
  if (!rem) return;
  activeHabitReminderId = rem.id;
  activeHabitMonthDate = parseLocalDate(rem.startDate) || getTodayLocal();
  document.getElementById('reminder-calendar-modal').classList.remove('hidden');
  await renderReminderHabitCalendarModal();
}

async function renderReminderHabitCalendarModal() {
  if (!activeHabitReminderId) return;
  const reminders = await getAll('reminders');
  const rem = reminders.find(r => r.id == activeHabitReminderId);
  if (!rem) return;

  document.getElementById('reminder-cal-title').textContent = rem.title;
  const baseDate = activeHabitMonthDate || getTodayLocal();
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();

  document.getElementById('habit-month-label').textContent =
    new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const occs = getReminderOccurrenceDates(rem);
  const occMap = new Map();
  occs.forEach(o => occMap.set(o.date, Boolean(o.completed)));

  const grid = document.getElementById('habit-calendar-grid');
  grid.innerHTML = '';

  const dows = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  dows.forEach(d => {
    const el = document.createElement('div');
    el.className = 'habit-cal-dow';
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstOfMonth = new Date(year, month, 1);
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - mondayOffset);

  let monthDoneCount = 0;
  for (let i = 0; i < 42; i++) {
    const cellDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const dateStr = toIsoDateStr(cellDate);
    const inCurrentMonth = cellDate.getMonth() === month;
    const isScheduled = occMap.has(dateStr);
    const isDone = isScheduled && occMap.get(dateStr);

    if (inCurrentMonth && isDone) monthDoneCount++;

    const cell = document.createElement('div');
    cell.className = 'habit-cal-day';
    if (!inCurrentMonth) cell.classList.add('muted-day');
    if (isScheduled) {
      cell.classList.add('scheduled');
      if (isDone) cell.classList.add('completed');
      cell.title = 'Click to toggle completion';
      cell.addEventListener('click', async () => {
        await toggleReminderOccurrenceCompletion(rem.id, dateStr);
      });
    }
    cell.textContent = cellDate.getDate();
    grid.appendChild(cell);
  }

  const totalDoneCount = occs.filter(o => Boolean(o.completed)).length;
  document.getElementById('habit-month-done').textContent = String(monthDoneCount);
  document.getElementById('habit-total-done').textContent = String(totalDoneCount);
}

function toggleReminderAspectAccordion(aspectName) {
  expandedReminderAspect = expandedReminderAspect === aspectName ? null : aspectName;
  renderReminders();
}

async function renderReminders() {
  const reminders = await getAll('reminders');
  const setAspects = [...new Set(['Daily', ...reminders.map(r => r.aspect).filter(Boolean), ...customAspects])];
  customAspects = setAspects;

  const chipsContainer = document.getElementById('aspect-chips');
  chipsContainer.innerHTML = customAspects.map(a => `
    <div class="chip ${currentAspect === a ? 'active' : ''}" onclick="selectAspect('${a.replace(/'/g, "\'")}')">${escapeHtml(a)}</div>
  `).join('');

  const aspectSelect = document.getElementById('reminder-aspect');
  aspectSelect.innerHTML = customAspects.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');

  const remindersList = document.getElementById('reminders-list');
  remindersList.innerHTML = '';

  const aspectsToRender = currentAspect === 'All'
    ? customAspects
    : [...new Set([currentAspect, ...customAspects])];

  aspectsToRender.forEach(aspectName => {
    const groupReminders = reminders.filter(r => (r.aspect || 'Daily') === aspectName);
    const isExpanded = expandedReminderAspect === aspectName;

    const groupBox = document.createElement('div');
    groupBox.className = 'aspect-group';

    const groupHeader = document.createElement('div');
    groupHeader.className = 'aspect-group-header';
    groupHeader.innerHTML = `
      <span>${escapeHtml(aspectName)} (${groupReminders.length})</span>
      <span>${isExpanded ? '▾' : '▸'}</span>
    `;
    groupHeader.addEventListener('click', () => toggleReminderAspectAccordion(aspectName));
    groupBox.appendChild(groupHeader);

    const groupBody = document.createElement('div');
    groupBody.className = `aspect-group-body ${isExpanded ? '' : 'hidden'}`;

    if (!groupReminders.length) {
      groupBody.innerHTML = `<div class="text-muted" style="font-size:13px;">No reminders in ${escapeHtml(aspectName)}.</div>`;
    } else {
      groupReminders.forEach(r => {
        const scorePct = getReminderCompletionScoreThroughYesterday(r);
        const row = document.createElement('div');
        row.className = 'list-item reminder-list-row';
        row.innerHTML = `
          <div class="item-title">${escapeHtml(r.title)}</div>
          <span class="reminder-completion-score">${scorePct}%</span>
        `;
        row.addEventListener('click', () => openReminderHabitCalendar(r.id));
        addLongPressHandler(row, () => openActionModal('reminders', r));
        groupBody.appendChild(row);
      });
    }

    groupBox.appendChild(groupBody);
    remindersList.appendChild(groupBox);
  });
}

function selectAspect(a) {
  currentAspect = a;
  expandedReminderAspect = a;
  renderReminders();
}

function addAspectPrompt() {
  const name = prompt('Enter new Aspect / List name:');
  if (name) {
    if (!customAspects.includes(name)) customAspects.push(name);
    currentAspect = name;
    expandedReminderAspect = name;
    renderReminders();
  }
}

async function handleReminderSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('reminder-id').value;
  const selectedDays = Array.from(document.querySelectorAll('.day-chip.selected')).map(chip => parseInt(chip.dataset.day, 10));
  const isRoutine = Boolean(document.getElementById('reminder-routine')?.checked);

  let existingOccurrences = [];
  if (id) {
    const existingAll = await getAll('reminders');
    const found = existingAll.find(item => item.id == parseInt(id, 10));
    if (found && Array.isArray(found.occurrences)) existingOccurrences = found.occurrences;
  }

  const reminder = {
    title: document.getElementById('reminder-title').value,
    startDate: document.getElementById('reminder-start-date').value,
    endDate: document.getElementById('reminder-end-date')?.value || DEFAULT_REMINDER_END_DATE,
    routine: isRoutine,
    aspect: document.getElementById('reminder-aspect').value || 'Daily',
    weeksInterval: parseInt(document.getElementById('reminder-weeks-interval').value, 10) || 1,
    days: selectedDays,
    occurrences: existingOccurrences
  };
  reminder.occurrences = generateReminderOccurrences(reminder);

  if (id) reminder.id = parseInt(id, 10);
  await saveItem('reminders', reminder);
  expandedReminderAspect = reminder.aspect;
  document.getElementById('reminder-form').reset();
  if (document.getElementById('reminder-end-date')) {
    document.getElementById('reminder-end-date').value = DEFAULT_REMINDER_END_DATE;
  }
  document.querySelectorAll('.day-chip').forEach(c => c.classList.remove('selected'));
  document.getElementById('reminder-id').value = '';
  renderReminders();
  renderHome();
}

// --- PEOPLE TAB ---
function openFullPhotoModal(src, title = 'Photo') {
  if (!src) return;
  document.getElementById('photo-viewer-title').textContent = title;
  document.getElementById('photo-viewer-img').src = src;
  document.getElementById('photo-viewer-modal').classList.remove('hidden');
}

async function handlePersonPhotoInputChange(e) {
  const preview = document.getElementById('person-photo-preview');
  const file = e.target.files && e.target.files[0];
  if (file) {
    const dataUrl = await readAsDataURL(file);
    preview.innerHTML = `<img src="${dataUrl}" alt="Photo preview" onclick="openFullPhotoModal('${dataUrl.replace(/'/g, "\'")}', 'Photo Preview')">`;
  } else if (editingPersonPhoto) {
    preview.innerHTML = `<img src="${editingPersonPhoto}" alt="Photo preview" onclick="openFullPhotoModal('${editingPersonPhoto.replace(/'/g, "\'")}', 'Photo Preview')">`;
  } else {
    preview.innerHTML = '';
  }
}

async function renderPeople() {
  const people = await getAll('people');
  const tasks = await getAll('tasks');
  const events = await getAll('events');

  const q = peopleSearchQuery;
  const filteredPeople = q
    ? people.filter(p => {
        const inName = (p.name || '').toLowerCase().includes(q);
        const inCode = (p.code || '').toLowerCase().includes(q);
        const inPhones = Array.isArray(p.phones) && p.phones.some(ph => String(ph).toLowerCase().includes(q));
        const inEmails = Array.isArray(p.emails) && p.emails.some(em => String(em).toLowerCase().includes(q));
        return inName || inCode || inPhones || inEmails;
      })
    : [...people];

  filteredPeople.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const peopleList = document.getElementById('people-list');
  peopleList.innerHTML = '';

  if (!filteredPeople.length) {
    peopleList.innerHTML = `<div class="text-muted" style="font-size:13px;">${q ? 'No matching people found.' : 'No contacts added yet.'}</div>`;
    window.cachedPeople = people;
    return;
  }

  filteredPeople.forEach(p => {
    const item = document.createElement('div');
    item.className = 'list-item';

    const header = document.createElement('div');
    header.className = 'person-card-header';

    if (p.photo) {
      const img = document.createElement('img');
      img.src = p.photo;
      img.className = 'photo-avatar clickable-photo';
      img.alt = p.name;
      img.title = 'View full photo';
      img.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openFullPhotoModal(p.photo, `${p.name} (${p.code})`);
      });
      header.appendChild(img);
    } else {
      const avatar = document.createElement('div');
      avatar.className = 'photo-avatar';
      avatar.textContent = '👤';
      header.appendChild(avatar);
    }

    const infoCol = document.createElement('div');
    const titleDiv = document.createElement('div');
    titleDiv.className = 'item-title';
    titleDiv.textContent = p.name;
    const codeDiv = document.createElement('div');
    codeDiv.className = 'person-code-subline';
    codeDiv.textContent = p.code || '';
    infoCol.appendChild(titleDiv);
    infoCol.appendChild(codeDiv);
    header.appendChild(infoCol);

    item.appendChild(header);
    item.addEventListener('click', () => showPersonDetails(p, people, tasks, events));
    addLongPressHandler(item, () => openActionModal('people', p));
    peopleList.appendChild(item);
  });

  window.cachedPeople = people;
}

function addDynamicField(containerId, name, value = '') {
  const container = document.getElementById(containerId);
  const row = document.createElement('div');
  row.className = 'dynamic-row';
  row.innerHTML = `
    <input type="text" name="${name}" value="${escapeHtml(value)}" placeholder="Enter ${name}...">
    <button type="button" class="btn-sm" onclick="this.parentElement.remove()">X</button>
  `;
  container.appendChild(row);
}

function addRelationshipField(targetId = '', relName = '') {
  const container = document.getElementById('relationships-container');
  const people = window.cachedPeople || [];
  const row = document.createElement('div');
  row.className = 'dynamic-row';
  row.innerHTML = `
    <select name="rel-target">
      <option value="">Select Person</option>
      ${people.map(p => `<option value="${p.id}" ${p.id == targetId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
    </select>
    <input type="text" name="rel-name" value="${escapeHtml(relName)}" placeholder="Relationship (e.g. Spouse)">
    <button type="button" class="btn-sm" onclick="this.parentElement.remove()">X</button>
  `;
  container.appendChild(row);
}

async function handlePersonSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('person-id').value;
  const people = await getAll('people');

  let code = document.getElementById('person-serial-code').value;
  if (!code) {
    code = generateNextPersonCode(people);
  }

  const photoInput = document.getElementById('person-photo-input');
  let photoData = id ? editingPersonPhoto : null;
  if (photoInput.files && photoInput.files[0]) {
    photoData = await readAsDataURL(photoInput.files[0]);
  }

  const phones = Array.from(document.querySelectorAll('input[name="phone"]')).map(i => i.value.trim()).filter(Boolean);
  const emails = Array.from(document.querySelectorAll('input[name="email"]')).map(i => i.value.trim()).filter(Boolean);

  const relTargets = document.querySelectorAll('select[name="rel-target"]');
  const relNames = document.querySelectorAll('input[name="rel-name"]');
  const relationships = [];
  relTargets.forEach((sel, idx) => {
    if (sel.value) {
      relationships.push({ targetId: sel.value, relName: relNames[idx].value.trim() || 'Related' });
    }
  });

  const person = {
    code,
    name: document.getElementById('person-name').value.trim(),
    photo: photoData,
    phones,
    emails,
    relationships,
    notes: document.getElementById('person-notes').value
  };

  if (id) person.id = parseInt(id, 10);

  await saveItem('people', person);
  editingPersonPhoto = null;
  document.getElementById('person-form').reset();
  document.getElementById('person-id').value = '';
  document.getElementById('person-serial-code').value = '';
  document.getElementById('person-photo-preview').innerHTML = '';
  document.getElementById('phones-container').innerHTML = '';
  document.getElementById('emails-container').innerHTML = '';
  document.getElementById('relationships-container').innerHTML = '';
  renderPeople();
}

function generateNextPersonCode(people) {
  if (people.length === 0) return 'P00001';
  const codes = people.map(p => p.code).filter(Boolean);
  codes.sort();
  const lastCode = codes[codes.length - 1];
  const prefix = lastCode.charAt(0);
  let num = parseInt(lastCode.slice(1), 10) + 1;
  if (num > 99999) {
    const nextPrefix = String.fromCharCode(prefix.charCodeAt(0) + 1);
    return `${nextPrefix}00001`;
  }
  return `${prefix}${String(num).padStart(5, '0')}`;
}

function readAsDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function showPersonDetails(p, allPeople, tasks, events) {
  const modal = document.getElementById('person-details-modal');
  const body = document.getElementById('person-details-body');

  const personTasks = tasks.filter(t => t.assigned == p.id);
  const personEvents = events.filter(ev => ev.persons && ev.persons.includes(p.name));

  let relHtml = '';
  if (p.relationships && p.relationships.length) {
    relHtml = p.relationships.map(r => {
      const target = allPeople.find(ap => ap.id == r.targetId);
      return target ? `<p>• ${escapeHtml(r.relName)}: <span class="rel-link" onclick="openLinkedPerson(${target.id})">${escapeHtml(target.name)}</span></p>` : '';
    }).join('');
  } else {
    relHtml = '<p class="text-muted">None</p>';
  }

  const phonesHtml = p.phones && p.phones.length
    ? p.phones.map(ph => {
        const cleanTel = String(ph).replace(/[^+\d]/g, '');
        return `<p>• <a href="tel:${encodeURIComponent(cleanTel)}" class="contact-link">${escapeHtml(ph)}</a></p>`;
      }).join('')
    : '<p class="text-muted">None</p>';

  const emailsHtml = p.emails && p.emails.length
    ? p.emails.map(em => `<p>• <a href="mailto:${encodeURIComponent(String(em).trim())}" class="contact-link">${escapeHtml(em)}</a></p>`).join('')
    : '<p class="text-muted">None</p>';

  const photoHtml = p.photo
    ? `<img src="${p.photo}" style="width:88px;height:88px;border-radius:50%;object-fit:cover;" class="clickable-photo" alt="${escapeHtml(p.name)}" title="Tap for full image" onclick="openFullPhotoModal('${p.photo.replace(/'/g, "\'")}', '${escapeHtml(p.name).replace(/'/g, "\'")} (${escapeHtml(p.code)})')">`
    : `<div style="font-size:40px;">👤</div>`;

  body.innerHTML = `
    <div style="text-align:center; margin-bottom:12px;">
      ${photoHtml}
      <h2>${escapeHtml(p.name)} (${escapeHtml(p.code)})</h2>
    </div>
    <h4>Phone Numbers</h4>
    ${phonesHtml}

    <h4 style="margin-top:8px;">Email Addresses</h4>
    ${emailsHtml}

    <h4 style="margin-top:8px;">Relationships</h4>
    ${relHtml}

    <h4 style="margin-top:8px;">Associated Tasks</h4>
    ${personTasks.length ? personTasks.map(t => `<p>• ${escapeHtml(t.title)} (${escapeHtml(t.deadline)})</p>`).join('') : '<p class="text-muted">None</p>'}

    <h4 style="margin-top:8px;">Associated Events</h4>
    ${personEvents.length ? personEvents.map(ev => `<p>• ${escapeHtml(ev.type)} (${escapeHtml(ev.date)})</p>`).join('') : '<p class="text-muted">None</p>'}

    <h4 style="margin-top:8px;">Notes</h4>
    <p>${escapeHtml(p.notes || 'No notes added.')}</p>

    <div style="margin-top:16px; display:flex; gap:8px;">
      <button type="button" class="btn btn-primary" onclick="editPersonFromDetails(${p.id})">Edit Person</button>
      <button type="button" class="btn btn-danger" onclick="deletePersonFromDetails(${p.id})">Delete</button>
    </div>
  `;
  modal.classList.remove('hidden');
}

async function openLinkedPerson(targetId) {
  const people = await getAll('people');
  const tasks = await getAll('tasks');
  const events = await getAll('events');
  const person = people.find(p => p.id == targetId);
  if (person) {
    showPersonDetails(person, people, tasks, events);
  }
}

async function editPersonFromDetails(id) {
  document.getElementById('person-details-modal').classList.add('hidden');
  const people = await getAll('people');
  const p = people.find(item => item.id == id);
  if (p) editItem('people', p);
}

async function deletePersonFromDetails(id) {
  if (confirm('Delete this person?')) {
    await deleteItem('people', id);
    document.getElementById('person-details-modal').classList.add('hidden');
    renderPeople();
  }
}

// --- LONG PRESS & EDIT / DELETE ---
function addLongPressHandler(element, callback) {
  let timer;
  element.addEventListener('touchstart', (e) => {
    timer = setTimeout(() => {
      e.preventDefault();
      callback();
    }, 600);
  });
  element.addEventListener('touchend', () => clearTimeout(timer));
  element.addEventListener('touchmove', () => clearTimeout(timer));
  element.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    callback();
  });
}

function openActionModal(storeName, item) {
  selectedLongPressItem = { storeName, item };
  const label = storeName === 'dayLogs' ? 'log entry' : storeName.slice(0, -1);
  document.getElementById('action-modal-title').textContent = `Manage ${label}`;
  const dupBtn = document.getElementById('action-duplicate-btn');
  if (dupBtn) {
    dupBtn.classList.toggle('hidden', storeName !== 'reminders');
  }
  document.getElementById('action-modal').classList.remove('hidden');
}

async function handleLongPressDuplicate() {
  if (!selectedLongPressItem) return;
  const { storeName, item } = selectedLongPressItem;
  document.getElementById('action-modal').classList.add('hidden');
  selectedLongPressItem = null;
  if (storeName === 'reminders') {
    await duplicateReminderItem(item);
  }
}

async function handleLongPressDelete() {
  if (!selectedLongPressItem) return;
  const { storeName, item } = selectedLongPressItem;

  if (storeName === 'dayLogs') {
    const existing = await getDayLog(item.date);
    const entries = normalizeDayLogEntries(existing).filter(entry => entry.id !== item.id);
    const secDateKey = getSecondaryCalendarKey(parseLocalDate(item.date));
    await putDayLogRecord({ date: item.date, secDateKey, entries });
    if (document.getElementById('day-log-entries-list')) {
      renderDayLogEntriesList(item.date, entries);
    }
    document.getElementById('action-modal').classList.add('hidden');
    selectedLongPressItem = null;
    renderJournal();
    return;
  }

  await deleteItem(storeName, item.id);
  document.getElementById('action-modal').classList.add('hidden');
  selectedLongPressItem = null;
  renderAll();
}

function handleLongPressEdit() {
  if (!selectedLongPressItem) return;
  const { storeName, item } = selectedLongPressItem;
  document.getElementById('action-modal').classList.add('hidden');

  if (storeName === 'dayLogs') {
    if (activeTab === 'journal') {
      journalSelectedDateStr = item.date;
      renderJournal();
    }
    openNewDayLogInput(item.text, item.id, item.date, item.label || '');
    return;
  }

  editItem(storeName, item);
}

function editItem(storeName, item) {
  if (storeName === 'tasks') {
    document.getElementById('task-id').value = item.id;
    document.getElementById('task-title').value = item.title;
    document.getElementById('task-assigned').value = item.assigned || '';
    const assignedPerson = (window.cachedPeople || []).find(p => p.id == item.assigned);
    document.getElementById('task-assigned-search').value = assignedPerson ? assignedPerson.name : '';
    document.getElementById('task-project').value = item.project;
    document.getElementById('task-deadline-type').value = item.deadlineType || 'date';
    updateTaskDeadlineInput();
    document.getElementById('task-deadline-val').value = item.deadline;
  } else if (storeName === 'events') {
    document.getElementById('event-id').value = item.id;
    document.getElementById('event-type').value = item.type;
    document.getElementById('event-date').value = item.date;
    selectedEventPersons = Array.isArray(item.persons) ? [...item.persons] : [];
    renderEventPersonTags();
  } else if (storeName === 'reminders') {
    document.getElementById('reminder-id').value = item.id;
    document.getElementById('reminder-title').value = item.title;
    document.getElementById('reminder-start-date').value = item.startDate || '';
    if (document.getElementById('reminder-end-date')) {
      document.getElementById('reminder-end-date').value = item.endDate || DEFAULT_REMINDER_END_DATE;
    }
    const routineCb = document.getElementById('reminder-routine');
    if (routineCb) routineCb.checked = Boolean(item.routine);
    document.getElementById('reminder-aspect').value = item.aspect;
    document.getElementById('reminder-weeks-interval').value = item.weeksInterval || 1;
    const activeDays = Array.isArray(item.days) ? item.days : [];
    document.querySelectorAll('.day-chip').forEach(chip => {
      const dayVal = parseInt(chip.dataset.day, 10);
      chip.classList.toggle('selected', activeDays.includes(dayVal));
    });
  } else if (storeName === 'people') {
    editingPersonPhoto = item.photo || null;
    document.getElementById('person-id').value = item.id;
    document.getElementById('person-serial-code').value = item.code;
    document.getElementById('person-name').value = item.name;
    document.getElementById('person-notes').value = item.notes || '';
    const preview = document.getElementById('person-photo-preview');
    preview.innerHTML = item.photo
      ? `<img src="${item.photo}" alt="Photo preview" onclick="openFullPhotoModal('${item.photo.replace(/'/g, "\'")}', '${escapeHtml(item.name).replace(/'/g, "\'")}')">`
      : '';

    const pContainer = document.getElementById('phones-container');
    pContainer.innerHTML = '';
    if (item.phones) item.phones.forEach(ph => addDynamicField('phones-container', 'phone', ph));

    const eContainer = document.getElementById('emails-container');
    eContainer.innerHTML = '';
    if (item.emails) item.emails.forEach(em => addDynamicField('emails-container', 'email', em));

    const rContainer = document.getElementById('relationships-container');
    rContainer.innerHTML = '';
    if (item.relationships) item.relationships.forEach(r => addRelationshipField(r.targetId, r.relName));
  }
}

// --- SETTINGS & FOLDER AUTO/MANUAL BACKUP ---
function renderSettingsDropdowns() {
  const pSelect = document.getElementById('settings-delete-project-select');
  pSelect.innerHTML = customProjects.filter(p => p !== 'Default Tasks').map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('') || '<option value="">No custom projects</option>';

  const aSelect = document.getElementById('settings-delete-aspect-select');
  aSelect.innerHTML = customAspects.filter(a => a !== 'Daily').map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('') || '<option value="">No custom aspects</option>';
}

function deleteSelectedProject() {
  const pSelect = document.getElementById('settings-delete-project-select');
  const val = pSelect.value;
  if (val) {
    customProjects = customProjects.filter(p => p !== val);
    if (currentProject === val) currentProject = 'All';
    renderSettingsDropdowns();
    renderTasks();
  }
}

function deleteSelectedAspect() {
  const aSelect = document.getElementById('settings-delete-aspect-select');
  const val = aSelect.value;
  if (val) {
    customAspects = customAspects.filter(a => a !== val);
    if (currentAspect === val) currentAspect = 'Daily';
    renderSettingsDropdowns();
    renderReminders();
  }
}

async function buildFullBackupPayload() {
  return {
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    customProjects,
    customAspects,
    tasks: await getAll('tasks'),
    events: await getAll('events'),
    reminders: await getAll('reminders'),
    people: await getAll('people'),
    dayLogs: await getAll('dayLogs')
  };
}

async function applyBackupPayload(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid backup data');
  if (Array.isArray(data.customProjects) && data.customProjects.length) {
    customProjects = [...new Set(['Default Tasks', ...data.customProjects])];
  }
  if (Array.isArray(data.customAspects) && data.customAspects.length) {
    customAspects = [...new Set(['Daily', ...data.customAspects])];
  }
  if (Array.isArray(data.tasks)) {
    for (const item of data.tasks) await saveItem('tasks', item);
  }
  if (Array.isArray(data.events)) {
    for (const item of data.events) await saveItem('events', item);
  }
  if (Array.isArray(data.reminders)) {
    for (const item of data.reminders) await saveItem('reminders', item);
  }
  if (Array.isArray(data.people)) {
    for (const item of data.people) await saveItem('people', item);
  }
  if (Array.isArray(data.dayLogs)) {
    for (const log of data.dayLogs) {
      if (log && log.date) {
        await putDayLogRecord({
          date: log.date,
          secDateKey: log.secDateKey || getSecondaryCalendarKey(parseLocalDate(log.date)),
          entries: normalizeDayLogEntries(log)
        });
      }
    }
  }
  renderAll();
}

async function verifyDirPermission(handle, mode = 'readwrite') {
  if (!handle || !handle.queryPermission) return true;
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (handle.requestPermission && (await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

async function initBackupSystem() {
  const savedHandle = await getMeta('backupDirHandle');
  if (savedHandle) {
    backupDirHandle = savedHandle;
  }
  await refreshBackupStatusUI();
  await runDailyAutoBackupIfNeeded();
}

async function refreshBackupStatusUI() {
  const folderStatus = document.getElementById('backup-folder-status');
  const lastRunStatus = document.getElementById('backup-last-run-status');
  if (!folderStatus || !lastRunStatus) return;

  if (backupDirHandle && backupDirHandle.name) {
    folderStatus.textContent = `Backup folder: ${backupDirHandle.name} (${BACKUP_FILENAME})`;
  } else if (window.showDirectoryPicker) {
    folderStatus.textContent = 'No backup folder selected.';
  } else {
    folderStatus.textContent = 'Folder picker not supported in this browser; using file download/picker fallback.';
  }

  const lastAutoDate = await getMeta('lastAutoBackupDate');
  lastRunStatus.textContent = `Last daily auto-backup: ${lastAutoDate || 'Never'}`;
}

async function selectBackupFolder() {
  if (!window.showDirectoryPicker) {
    alert('Directory selection is not supported in this browser. Use Push Backup or Update Data from Backup.');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    backupDirHandle = handle;
    await setMeta('backupDirHandle', handle);
    await refreshBackupStatusUI();
    await pushBackupToFolder(true);
  } catch (err) {
    if (err && err.name !== 'AbortError') {
      alert('Could not select backup folder.');
    }
  }
}

async function pushBackupToFolder(isAuto = false) {
  const payload = await buildFullBackupPayload();
  const jsonText = JSON.stringify(payload, null, 2);

  if (backupDirHandle && await verifyDirPermission(backupDirHandle, 'readwrite')) {
    try {
      const fileHandle = await backupDirHandle.getFileHandle(BACKUP_FILENAME, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(jsonText);
      await writable.close();
      if (!isAuto) alert(`Backup pushed to ${backupDirHandle.name}/${BACKUP_FILENAME}`);
      return true;
    } catch (err) {
      if (!isAuto) alert('Failed to write backup to folder.');
      return false;
    }
  }

  if (!isAuto) {
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = BACKUP_FILENAME;
    a.click();
    URL.revokeObjectURL(url);
  }
  return false;
}

async function runDailyAutoBackupIfNeeded() {
  const todayStr = toIsoDateStr(getTodayLocal());
  const lastAutoDate = await getMeta('lastAutoBackupDate');
  if (lastAutoDate === todayStr) return;

  if (backupDirHandle && await verifyDirPermission(backupDirHandle, 'readwrite')) {
    const ok = await pushBackupToFolder(true);
    if (ok) {
      await setMeta('lastAutoBackupDate', todayStr);
      await refreshBackupStatusUI();
    }
  }
}

async function updateDataFromBackup() {
  if (!confirm('Update app data from backup? This may overwrite existing records.')) return;
  if (backupDirHandle && await verifyDirPermission(backupDirHandle, 'read')) {
    try {
      const fileHandle = await backupDirHandle.getFileHandle(BACKUP_FILENAME, { create: false });
      const file = await fileHandle.getFile();
      const text = await file.text();
      await applyBackupPayload(JSON.parse(text));
      alert('Data updated from backup folder!');
      return;
    } catch (err) {
      alert(`Could not read ${BACKUP_FILENAME} from selected folder.`);
      return;
    }
  }

  const fallbackInput = document.getElementById('fallback-backup-file-input');
  if (fallbackInput) {
    fallbackInput.value = '';
    fallbackInput.click();
  }
}

async function handleFallbackBackupFileSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    await applyBackupPayload(JSON.parse(text));
    alert('Data updated from backup file!');
  } catch (err) {
    alert('Invalid backup JSON file.');
  }
}

function downloadSample(type) {
  let sampleData = [];
  if (type === 'tasks') {
    sampleData = [{ title: 'Sample Task', project: 'Default Tasks', deadlineType: 'date', deadline: '2026-12-31', completed: false }];
  } else if (type === 'events') {
    sampleData = [{ persons: ['John Doe'], type: 'Birthday', date: '2026-05-15' }];
  } else if (type === 'reminders') {
    sampleData = [{ title: 'Sample Reminder', startDate: '2026-01-01', aspect: 'Daily', weeksInterval: 1, days: [1, 3, 5] }];
  } else if (type === 'people') {
    sampleData = [{ code: 'P00001', name: 'John Doe', phones: ['1234567890'], emails: ['john@example.com'], notes: 'Sample note' }];
  }

  const blob = new Blob([JSON.stringify(sampleData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sample_${type}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// --- SEARCH PICKERS ---
function setupTaskPersonSearch() {
  const searchInput = document.getElementById('task-assigned-search');
  const resultsDiv = document.getElementById('task-assigned-results');

  if (!searchInput || !resultsDiv) return;

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase().trim();
    const people = window.cachedPeople || [];
    const filtered = people.filter(p => p.name.toLowerCase().includes(query) || (p.code && p.code.toLowerCase().includes(query)));

    if (filtered.length === 0) {
      resultsDiv.innerHTML = '<div class="search-result-item text-muted">No matches</div>';
    } else {
      resultsDiv.innerHTML = filtered.map(p => `
        <div class="search-result-item" onclick="selectTaskPerson('${p.id}', '${p.name.replace(/'/g, "\'")}')">
          ${escapeHtml(p.name)} (${escapeHtml(p.code)})
        </div>
      `).join('');
    }
    resultsDiv.classList.remove('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.searchable-select-container')) {
      resultsDiv.classList.add('hidden');
    }
  });
}

function selectTaskPerson(id, name) {
  document.getElementById('task-assigned').value = id;
  document.getElementById('task-assigned-search').value = name;
  document.getElementById('task-assigned-results').classList.add('hidden');
}

function setupEventPersonSearch() {
  const searchInput = document.getElementById('event-person-search');
  const resultsDiv = document.getElementById('event-person-results');

  if (!searchInput || !resultsDiv) return;

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase().trim();
    const people = window.cachedPeople || [];
    const filtered = people.filter(p => p.name.toLowerCase().includes(query));

    if (filtered.length === 0) {
      resultsDiv.innerHTML = '<div class="search-result-item text-muted">No matches</div>';
    } else {
      resultsDiv.innerHTML = filtered.map(p => `
        <div class="search-result-item" onclick="addEventPersonTag('${p.name.replace(/'/g, "\'")}')">
          ${escapeHtml(p.name)} (${escapeHtml(p.code)})
        </div>
      `).join('');
    }
    resultsDiv.classList.remove('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.searchable-multi-select')) {
      resultsDiv.classList.add('hidden');
    }
  });
}

function addEventPersonTag(name) {
  if (!selectedEventPersons.includes(name)) {
    selectedEventPersons.push(name);
    renderEventPersonTags();
  }
  document.getElementById('event-person-search').value = '';
  document.getElementById('event-person-results').classList.add('hidden');
}

function removeEventPersonTag(name) {
  selectedEventPersons = selectedEventPersons.filter(n => n !== name);
  renderEventPersonTags();
}

function renderEventPersonTags() {
  const container = document.getElementById('event-selected-tags');
  if (!container) return;
  container.innerHTML = selectedEventPersons.map(n => `
    <span class="tag-chip">${escapeHtml(n)} <span class="remove-tag" onclick="removeEventPersonTag('${n.replace(/'/g, "\'")}')">&times;</span></span>
  `).join('');
}

// --- DAY LOGS & JOURNAL TIMELINE ---
function normalizeDayLogEntries(dayLog) {
  if (!dayLog) return [];
  if (Array.isArray(dayLog.entries)) {
    return dayLog.entries.map((entry, i) => ({
      id: entry.id || `entry-${i}`,
      text: entry.text || '',
      label: entry.label || 'General',
      createdAt: entry.createdAt || entry.updatedAt || Date.now(),
      updatedAt: entry.updatedAt || entry.createdAt || Date.now()
    }));
  }
  if (dayLog.notes) {
    return [{
      id: 'legacy-1',
      text: dayLog.notes,
      label: 'General',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }];
  }
  return [];
}

function formatEntryTime(ts) {
  const d = new Date(ts || Date.now());
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function renderDayLogEntriesList(dateStr, entries) {
  const listEl = document.getElementById('day-log-entries-list');
  if (!listEl) return;

  if (!entries.length) {
    listEl.innerHTML = '<div class="text-muted" style="font-size:13px; padding:4px 0;">No logs added for this day.</div>';
    return;
  }

  listEl.innerHTML = '';
  entries.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'day-log-entry';
    row.innerHTML = `
      <div class="day-log-entry-header">
        <span class="journal-label-badge">${escapeHtml(entry.label || 'General')}</span>
        <span class="text-muted" style="font-size:11px;">${escapeHtml(formatEntryTime(entry.createdAt))}</span>
      </div>
      <div>${escapeHtml(entry.text)}</div>
    `;
    addLongPressHandler(row, () => {
      openActionModal('dayLogs', {
        id: entry.id,
        date: dateStr,
        text: entry.text,
        label: entry.label || 'General'
      });
    });
    listEl.appendChild(row);
  });
}

async function toggleTaskFinishedFromDayModal(taskId, dayName, dateStr, dayEvents, dayReminders, targetDateObj) {
  const allTasks = await getAll('tasks');
  const t = allTasks.find(item => item.id == taskId);
  if (!t) return;
  t.completed = !t.completed;
  await saveItem('tasks', t);
  renderTasks();
  renderHome();
  await showDayDetails(dayName, dateStr, allTasks, dayEvents, dayReminders, targetDateObj);
}

function renderClickableTasksHtml(taskList, dayName, dateStr, dayEvents, dayReminders, targetDateObj) {
  if (!taskList.length) return '<p class="text-muted">None</p>';
  return taskList.map(t => `
    <div class="day-task-clickable ${t.completed ? 'completed' : ''}" onclick="toggleTaskFinishedFromDayModal(${t.id}, '${dayName.replace(/'/g, "\'")}', '${dateStr}', window._lastDayModalEvents || [], window._lastDayModalReminders || [], window._lastDayModalDateObj || null)">
      ${t.completed ? '✓ ' : '• '}<strong>${escapeHtml(t.title)}</strong> [${escapeHtml(t.project)}]
    </div>
  `).join('');
}

async function showDayDetails(dayName, dateStr, allOrDayTasks, events, reminders, targetDateObj = null) {
  const modal = document.getElementById('day-details-modal');
  const dateObj = targetDateObj ? parseLocalDate(targetDateObj) : parseLocalDate(dateStr);
  const secKey = getSecondaryCalendarKey(dateObj);
  const regKey = getRegularCalendarKey(dateObj);

  window._lastDayModalEvents = events;
  window._lastDayModalReminders = reminders;
  window._lastDayModalDateObj = dateObj;

  const allTasks = Array.isArray(allOrDayTasks) ? allOrDayTasks : await getAll('tasks');
  const dayOnlyTasks = allTasks.filter(t => t.deadline === dateStr);
  const weekStart = getStartOfWeek(dateObj, 0);
  const weekTasks = allTasks.filter(t => isTaskInWeek(t, weekStart));
  const monthTasks = allTasks.filter(t => isTaskInMonth(t, dateObj));
  const quarterTasks = allTasks.filter(t => isTaskInQuarter(t, dateObj));

  document.getElementById('day-modal-title').textContent = `${regKey} | ${dayName} | ${secKey}`;
  const body = document.getElementById('day-modal-body');

  const dayLog = await getDayLog(dateStr);
  const entries = normalizeDayLogEntries(dayLog);
  editingLogContext = null;

  let html = `<h4>Day Tasks</h4>`;
  html += renderClickableTasksHtml(dayOnlyTasks, dayName, dateStr, events, reminders, dateObj);

  html += `<h4 style="margin-top:10px;">Week Tasks</h4>`;
  html += renderClickableTasksHtml(weekTasks, dayName, dateStr, events, reminders, dateObj);

  html += `<h4 style="margin-top:10px;">Month Tasks</h4>`;
  html += renderClickableTasksHtml(monthTasks, dayName, dateStr, events, reminders, dateObj);

  html += `<h4 style="margin-top:10px;">Quarter Tasks</h4>`;
  html += renderClickableTasksHtml(quarterTasks, dayName, dateStr, events, reminders, dateObj);

  html += `<h4 style="margin-top:10px;">Events</h4>`;
  html += events.length ? events.map(ev => `<p>• ${escapeHtml(ev.type)}: ${escapeHtml(ev.persons ? ev.persons.join(', ') : '')}</p>`).join('') : '<p class="text-muted">None</p>';

  if (showReminderSummary) {
    html += `<h4 style="margin-top:10px;">Reminders</h4>`;
    html += reminders.length ? reminders.map(r => `<p>• ${escapeHtml(r.title)} (${escapeHtml(r.aspect)})</p>`).join('') : '<p class="text-muted">None</p>';
  }

  html += `
    <div class="day-log-box">
      <h4>Day Logs</h4>
      <div id="day-log-entries-list"></div>
      <div id="day-log-edit-form" class="hidden">
        <input type="text" id="day-log-label-input" placeholder="Custom label (e.g. Work, Health, Reflection)..." style="margin-top:6px;">
        <textarea id="day-log-input" class="day-log-textarea" placeholder="Write a log entry..."></textarea>
        <div class="day-log-actions">
          <button type="button" id="save-day-log-btn" class="btn btn-primary btn-sm" onclick="saveDayLogEntry('${dateStr}')">Save Log</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="cancelDayLogEdit()">Cancel</button>
        </div>
      </div>
      <button type="button" id="add-day-log-btn" class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick="openNewDayLogInput('', null, '${dateStr}', '')">+ Add Log</button>
    </div>
  `;

  body.innerHTML = html;
  renderDayLogEntriesList(dateStr, entries);
  modal.classList.remove('hidden');
}

function openNewDayLogInput(prefillText = '', logId = null, dateStr = null, prefillLabel = '') {
  editingLogContext = logId && dateStr ? { id: logId, date: dateStr } : null;
  const form = document.getElementById('day-log-edit-form');
  const labelInput = document.getElementById('day-log-label-input');
  const input = document.getElementById('day-log-input');
  const addBtn = document.getElementById('add-day-log-btn');
  if (!form || !input) return;

  if (labelInput) labelInput.value = prefillLabel || '';
  input.value = prefillText;
  form.classList.remove('hidden');
  if (addBtn) addBtn.classList.add('hidden');
  input.focus();
}

function cancelDayLogEdit() {
  editingLogContext = null;
  const form = document.getElementById('day-log-edit-form');
  const labelInput = document.getElementById('day-log-label-input');
  const input = document.getElementById('day-log-input');
  const addBtn = document.getElementById('add-day-log-btn');
  if (labelInput) labelInput.value = '';
  if (input) input.value = '';
  if (form) form.classList.add('hidden');
  if (addBtn) addBtn.classList.remove('hidden');
}

function putDayLogRecord(record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('dayLogs', 'readwrite');
    const req = tx.objectStore('dayLogs').put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function saveDayLogEntry(dateStr) {
  const labelInput = document.getElementById('day-log-label-input');
  const input = document.getElementById('day-log-input');
  const label = (labelInput && labelInput.value.trim()) ? labelInput.value.trim() : 'General';
  const text = input ? input.value.trim() : '';
  if (!text) return;

  const existing = await getDayLog(dateStr);
  const entries = normalizeDayLogEntries(existing);

  if (editingLogContext && editingLogContext.date === dateStr) {
    const idx = entries.findIndex(entry => entry.id === editingLogContext.id);
    if (idx !== -1) {
      entries[idx] = {
        ...entries[idx],
        text,
        label,
        updatedAt: Date.now()
      };
    }
  } else {
    entries.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text,
      label,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }

  const secDateKey = getSecondaryCalendarKey(parseLocalDate(dateStr));
  await putDayLogRecord({ date: dateStr, secDateKey, entries });

  cancelDayLogEdit();
  if (document.getElementById('day-log-entries-list')) {
    renderDayLogEntriesList(dateStr, entries);
  }
  renderJournal();
}

function getDayLog(dateStr) {
  return new Promise((resolve) => {
    if (!db || !db.objectStoreNames.contains('dayLogs')) {
      resolve(null);
      return;
    }
    const tx = db.transaction('dayLogs', 'readonly');
    const req = tx.objectStore('dayLogs').get(dateStr);
    req.onsuccess = () => resolve(req.result);
  });
}

function toggleJournalLabelFilter(label) {
  if (label === '__ALL__') {
    journalSelectedLabels = [];
    renderJournal();
    return;
  }
  if (journalSelectedLabels.includes(label)) {
    journalSelectedLabels = journalSelectedLabels.filter(l => l !== label);
  } else {
    journalSelectedLabels.push(label);
  }
  renderJournal();
}

async function renderJournal() {
  const stripEl = document.getElementById('journal-week-strip');
  const chipsEl = document.getElementById('journal-label-chips');
  const timelineEl = document.getElementById('journal-timeline-container');
  const headingEl = document.getElementById('journal-selected-day-heading');
  const datePicker = document.getElementById('journal-date-picker');
  if (!stripEl || !chipsEl || !timelineEl) return;

  const allLogs = await getAll('dayLogs');
  const logsByDate = new Map();
  const allLabelsSet = new Set();

  allLogs.forEach(rec => {
    const entries = normalizeDayLogEntries(rec);
    logsByDate.set(rec.date, entries);
    entries.forEach(en => {
      if (en.label) allLabelsSet.add(en.label);
    });
  });

  const selectedDate = parseLocalDate(journalSelectedDateStr || toIsoDateStr(getTodayLocal()));
  const selectedStr = toIsoDateStr(selectedDate);
  if (datePicker && datePicker.value !== selectedStr) {
    datePicker.value = selectedStr;
  }

  const weekStart = getStartOfWeek(selectedDate, 0);
  const shortDays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  stripEl.innerHTML = '';

  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const dStr = toIsoDateStr(d);
    const hasLogs = (logsByDate.get(dStr) || []).length > 0;
    const isSelected = dStr === selectedStr;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `journal-day-pill ${isSelected ? 'selected' : ''} ${hasLogs ? 'has-logs' : ''}`;
    btn.innerHTML = `
      <span class="j-dow">${shortDays[d.getDay()]}</span>
      <span class="j-num">${d.getDate()}</span>
      <span class="j-dot"></span>
    `;
    btn.addEventListener('click', () => {
      journalSelectedDateStr = dStr;
      renderJournal();
    });
    stripEl.appendChild(btn);
  }

  const labels = [...allLabelsSet].sort((a, b) => a.localeCompare(b));
  const isAllActive = journalSelectedLabels.length === 0;
  chipsEl.innerHTML = `
    <button type="button" class="chip ${isAllActive ? 'active' : ''}" onclick="toggleJournalLabelFilter('__ALL__')">All</button>
    ${labels.map(lbl => {
      const active = journalSelectedLabels.includes(lbl);
      return `<button type="button" class="chip ${active ? 'active' : ''}" onclick="toggleJournalLabelFilter('${lbl.replace(/'/g, "\'")}')">${escapeHtml(lbl)}</button>`;
    }).join('')}
  `;

  const todayStr = toIsoDateStr(getTodayLocal());
  if (headingEl) {
    headingEl.textContent = selectedStr === todayStr
      ? 'Today'
      : selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  let dayEntries = [...(logsByDate.get(selectedStr) || [])];
  dayEntries.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  if (journalSelectedLabels.length > 0) {
    dayEntries = dayEntries.filter(en => journalSelectedLabels.includes(en.label || 'General'));
  }

  if (journalSearchQuery) {
    dayEntries = dayEntries.filter(en =>
      (en.text || '').toLowerCase().includes(journalSearchQuery) ||
      (en.label || '').toLowerCase().includes(journalSearchQuery)
    );
  }

  timelineEl.innerHTML = '';
  if (!dayEntries.length) {
    timelineEl.innerHTML = '<div class="text-muted" style="font-size:13px; padding:6px 0;">No log entries match this day or filter.</div>';
    return;
  }

  dayEntries.forEach(en => {
    const itemEl = document.createElement('div');
    itemEl.className = 'journal-timeline-item';
    itemEl.innerHTML = `
      <div class="journal-timeline-node"></div>
      <div class="journal-timeline-time">${escapeHtml(formatEntryTime(en.createdAt))}</div>
      <div class="journal-entry-card">
        <div class="journal-entry-top">
          <span class="journal-label-badge">${escapeHtml(en.label || 'General')}</span>
        </div>
        <div class="journal-entry-text">${escapeHtml(en.text)}</div>
      </div>
    `;
    const cardEl = itemEl.querySelector('.journal-entry-card');
    addLongPressHandler(cardEl, () => {
      openActionModal('dayLogs', {
        id: en.id,
        date: selectedStr,
        text: en.text,
        label: en.label || 'General'
      });
    });
    timelineEl.appendChild(itemEl);
  });
}
