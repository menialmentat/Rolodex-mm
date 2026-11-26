// Rolodex PWA - Version 3 Updated Codebase
const DB_NAME = 'RolodexDB';
const DB_VERSION = 2;
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

// Secondary Calendar Helper (Anchored to October 16, 1991) -> WW-QQ-MM-YY
function getSecondaryCalendarKey(dateObj) {
  const d = parseLocalDate(dateObj);
  const anchorMonth = 9; // October (0-indexed)
  const anchorDay = 16;
  const year = d.getFullYear();

  let anchorThisYear = new Date(year, anchorMonth, anchorDay);
  let personalYearNum = year - 1991;

  if (d < anchorThisYear) {
    personalYearNum -= 1;
    anchorThisYear = new Date(year - 1, anchorMonth, anchorDay);
  }

  const diffTime = d - anchorThisYear;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  let weekNum = Math.floor(diffDays / 7) + 1;

  let monthNum = Math.ceil(weekNum / 4);
  let quarterNum = Math.ceil(weekNum / 13);

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
  await initDB();
  registerServiceWorker();
  setupTabNavigation();
  setupEventListeners();
  renderAll();
});

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.error('SW reg error:', err));
  }
}

function setupEventListeners() {
  document.getElementById('settings-btn').addEventListener('click', () => {
    renderSettingsDropdowns();
    document.getElementById('settings-modal').classList.remove('hidden');
  });
  document.getElementById('close-settings-modal').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
  });

  document.getElementById('export-data-btn').addEventListener('click', exportData);
  document.getElementById('import-data-btn').addEventListener('click', importData);

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
  document.getElementById('person-form').addEventListener('submit', handlePersonSubmit);
  document.getElementById('close-person-modal').addEventListener('click', () => {
    document.getElementById('person-details-modal').classList.add('hidden');
  });

  document.getElementById('settings-delete-project-btn').addEventListener('click', deleteSelectedProject);
  document.getElementById('settings-delete-aspect-btn').addEventListener('click', deleteSelectedAspect);

  document.getElementById('action-cancel-btn').addEventListener('click', () => {
    document.getElementById('action-modal').classList.add('hidden');
  });
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
}

async function renderHome() {
  const tasks = await getAll('tasks');
  const events = await getAll('events');
  const reminders = await getAll('reminders');

  renderAgendaSummary(tasks, events, reminders);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
    const dayEvents = events.filter(e => isEventOnDate(e, dayDate));
    const dayReminders = reminders.filter(r => isReminderOnDate(r, dayDate));

    const regKey = getRegularCalendarKey(dayDate);
    const secKey = getSecondaryCalendarKey(dayDate);

    const summaryText = showReminderSummary
      ? (dayReminders.length
          ? `Reminders (${dayReminders.length}): ${dayReminders.map(r => r.title).join(', ')}`
          : 'Reminders: None')
      : `Tasks: ${dayTasks.length} | Events: ${dayEvents.length} | Reminders: ${dayReminders.length}`;

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
    row.addEventListener('click', () => showDayDetails(dayNames[i], dateStr, dayTasks, dayEvents, dayReminders));
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

function renderAgendaSummary(tasks, events, reminders) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = getStartOfWeek(today, currentWeekOffset);

  if (showReminderSummary) {
    renderAgendaList('agenda-today', reminders.filter(r => isReminderOnDate(r, today)), 'reminder');
    renderAgendaList('agenda-week', reminders.filter(r => isReminderInWeek(r, weekStart)), 'reminder');
    renderAgendaList('agenda-month', reminders.filter(r => isReminderInMonth(r, today)), 'reminder');
    renderAgendaList('agenda-quarter', reminders.filter(r => isReminderInQuarter(r, today)), 'reminder');
  } else {
    renderAgendaList('agenda-today', events.filter(e => isEventOnDate(e, today)), 'event');
    renderAgendaList('agenda-week', events.filter(e => isEventInWeek(e, today)), 'event');
    renderAgendaList('agenda-month', events.filter(e => isEventInMonth(e, today)), 'event');
    renderAgendaList('agenda-quarter', events.filter(e => isEventInQuarter(e, today)), 'event');
  }
}

function renderAgendaList(containerId, items, mode = 'event') {
  const container = document.getElementById(containerId);
  if (items.length === 0) {
    container.innerHTML = `<div class="agenda-item text-muted">No ${mode}s</div>`;
    return;
  }
  if (mode === 'reminder') {
    container.innerHTML = items.map(item => `
      <div class="agenda-item">• <strong>${item.title}</strong> (${item.aspect || 'Daily'})</div>
    `).join('');
  } else {
    container.innerHTML = items.map(item => `
      <div class="agenda-item">• <strong>${item.type}</strong>: ${item.persons ? item.persons.join(', ') : 'Event'} (${item.date})</div>
    `).join('');
  }
}

async function renderTasks() {
  const tasks = await getAll('tasks');
  const people = await getAll('people');
  window.cachedPeople = people;

  const setProjects = [...new Set(['Default Tasks', ...tasks.map(t => t.project).filter(Boolean), ...customProjects])];
  customProjects = setProjects;

  const chipsContainer = document.getElementById('project-chips');
  chipsContainer.innerHTML = ['All', ...customProjects].map(p => `
    <div class="chip ${currentProject === p ? 'active' : ''}" onclick="selectProject('${p.replace(/'/g, "\'")}')">${p}</div>
  `).join('');

  const projectSelect = document.getElementById('task-project');
  projectSelect.innerHTML = customProjects.map(p => `<option value="${p}">${p}</option>`).join('');

  const filteredTasks = currentProject === 'All' ? tasks : tasks.filter(t => t.project === currentProject);
  const tasksList = document.getElementById('tasks-list');
  tasksList.innerHTML = '';

  filteredTasks.forEach(t => {
    const person = people.find(p => p.id == t.assigned);
    const item = document.createElement('div');
    item.className = `list-item ${t.completed ? 'completed' : ''}`;
    item.innerHTML = `
      <div>
        <div class="item-title">${t.title}</div>
        <div class="item-details">Project: ${t.project} | Assigned: ${person ? person.name : 'None'} | Deadline: ${t.deadline}</div>
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

async function renderEvents() {
  const events = await getAll('events');
  const people = await getAll('people');
  window.cachedPeople = people;

  const now = new Date();
  const currentQuarterEvents = events.filter(e => isEventInQuarterWithLead(e, now));

  const eventsList = document.getElementById('events-list');
  eventsList.innerHTML = '';

  currentQuarterEvents.forEach(ev => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div>
        <div class="item-title">${ev.type} - ${ev.persons ? ev.persons.join(', ') : 'Event'}</div>
        <div class="item-details">Recurring Date: ${ev.date}</div>
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

async function renderReminders() {
  const reminders = await getAll('reminders');
  const setAspects = [...new Set(['Daily', ...reminders.map(r => r.aspect).filter(Boolean), ...customAspects])];
  customAspects = setAspects;

  const chipsContainer = document.getElementById('aspect-chips');
  chipsContainer.innerHTML = customAspects.map(a => `
    <div class="chip ${currentAspect === a ? 'active' : ''}" onclick="selectAspect('${a.replace(/'/g, "\'")}')">${a}</div>
  `).join('');

  const aspectSelect = document.getElementById('reminder-aspect');
  aspectSelect.innerHTML = customAspects.map(a => `<option value="${a}">${a}</option>`).join('');

  const filteredReminders = reminders.filter(r => r.aspect === currentAspect);
  const remindersList = document.getElementById('reminders-list');
  remindersList.innerHTML = '';

  filteredReminders.forEach(r => {
    const daysStr = r.days && r.days.length ? r.days.map(d => ['S','M','T','W','T','F','S'][d]).join(', ') : 'All';
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div>
        <div class="item-title">${r.title}</div>
        <div class="item-details">Start: ${r.startDate || 'N/A'} | Aspect: ${r.aspect} | Every ${r.weeksInterval || 1} wk(s) on: ${daysStr}</div>
      </div>
    `;
    addLongPressHandler(item, () => openActionModal('reminders', r));
    remindersList.appendChild(item);
  });
}

function selectAspect(a) {
  currentAspect = a;
  renderReminders();
}

function addAspectPrompt() {
  const name = prompt('Enter new Aspect / List name:');
  if (name) {
    if (!customAspects.includes(name)) customAspects.push(name);
    currentAspect = name;
    renderReminders();
  }
}

async function handleReminderSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('reminder-id').value;
  const selectedDays = Array.from(document.querySelectorAll('.day-chip.selected')).map(chip => parseInt(chip.dataset.day, 10));
  const reminder = {
    title: document.getElementById('reminder-title').value,
    startDate: document.getElementById('reminder-start-date').value,
    aspect: document.getElementById('reminder-aspect').value || 'Daily',
    weeksInterval: parseInt(document.getElementById('reminder-weeks-interval').value, 10) || 1,
    days: selectedDays
  };
  if (id) reminder.id = parseInt(id, 10);
  await saveItem('reminders', reminder);
  document.getElementById('reminder-form').reset();
  document.querySelectorAll('.day-chip').forEach(c => c.classList.remove('selected'));
  document.getElementById('reminder-id').value = '';
  renderReminders();
}

function isReminderOnDate(r, date) {
  const target = parseLocalDate(date);
  if (r.startDate) {
    const start = parseLocalDate(r.startDate);
    if (target < start) return false;
    const interval = Math.max(1, parseInt(r.weeksInterval, 10) || 1);
    if (interval > 1) {
      const diffDays = Math.floor((target - start) / (1000 * 60 * 60 * 24));
      const weeksDiff = Math.floor(diffDays / 7);
      if (weeksDiff % interval !== 0) return false;
    }
  }
  if (!r.days || r.days.length === 0) return true;
  return r.days.includes(target.getDay());
}

async function renderPeople() {
  const people = await getAll('people');
  const tasks = await getAll('tasks');
  const events = await getAll('events');

  people.sort((a, b) => a.name.localeCompare(b.name));

  const peopleList = document.getElementById('people-list');
  peopleList.innerHTML = '';

  people.forEach(p => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div class="person-card-header">
        ${p.photo ? `<img src="${p.photo}" class="photo-avatar" alt="${p.name}">` : `<div class="photo-avatar">👤</div>`}
        <div>
          <div class="item-title">${p.name} (${p.code})</div>
        </div>
      </div>
    `;

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
    <input type="text" name="${name}" value="${value}" placeholder="Enter ${name}...">
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
      ${people.map(p => `<option value="${p.id}" ${p.id == targetId ? 'selected' : ''}>${p.name}</option>`).join('')}
    </select>
    <input type="text" name="rel-name" value="${relName}" placeholder="Relationship (e.g. Spouse)">
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

  const phones = Array.from(document.querySelectorAll('input[name="phone"]')).map(i => i.value).filter(Boolean);
  const emails = Array.from(document.querySelectorAll('input[name="email"]')).map(i => i.value).filter(Boolean);

  const relTargets = document.querySelectorAll('select[name="rel-target"]');
  const relNames = document.querySelectorAll('input[name="rel-name"]');
  const relationships = [];
  relTargets.forEach((sel, idx) => {
    if (sel.value) {
      relationships.push({ targetId: sel.value, relName: relNames[idx].value || 'Related' });
    }
  });

  const person = {
    code,
    name: document.getElementById('person-name').value,
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
      return target ? `<p>• ${r.relName}: <span class="rel-link" onclick="openLinkedPerson(${target.id})">${target.name}</span></p>` : '';
    }).join('');
  } else {
    relHtml = '<p class="text-muted">None</p>';
  }

  body.innerHTML = `
    <div style="text-align:center; margin-bottom:12px;">
      ${p.photo ? `<img src="${p.photo}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;" alt="${p.name}">` : `<div style="font-size:40px;">👤</div>`}
      <h2>${p.name} (${p.code})</h2>
    </div>
    <h4>Phone Numbers</h4>
    ${p.phones && p.phones.length ? p.phones.map(ph => `<p>• ${ph}</p>`).join('') : '<p class="text-muted">None</p>'}

    <h4 style="margin-top:8px;">Email Addresses</h4>
    ${p.emails && p.emails.length ? p.emails.map(em => `<p>• ${em}</p>`).join('') : '<p class="text-muted">None</p>'}

    <h4 style="margin-top:8px;">Relationships</h4>
    ${relHtml}

    <h4 style="margin-top:8px;">Associated Tasks</h4>
    ${personTasks.length ? personTasks.map(t => `<p>• ${t.title} (${t.deadline})</p>`).join('') : '<p class="text-muted">None</p>'}

    <h4 style="margin-top:8px;">Associated Events</h4>
    ${personEvents.length ? personEvents.map(ev => `<p>• ${ev.type} (${ev.date})</p>`).join('') : '<p class="text-muted">None</p>'}

    <h4 style="margin-top:8px;">Notes</h4>
    <p>${p.notes || 'No notes added.'}</p>

    <div style="margin-top:16px; display:flex; gap:8px;">
      <button class="btn btn-primary" onclick="editPersonFromDetails(${p.id})">Edit Person</button>
      <button class="btn btn-danger" onclick="deletePersonFromDetails(${p.id})">Delete</button>
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
  document.getElementById('action-modal').classList.remove('hidden');
}

async function handleLongPressDelete() {
  if (!selectedLongPressItem) return;
  const { storeName, item } = selectedLongPressItem;

  if (storeName === 'dayLogs') {
    const existing = await getDayLog(item.date);
    const entries = normalizeDayLogEntries(existing).filter(entry => entry.id !== item.id);
    const secDateKey = getSecondaryCalendarKey(parseLocalDate(item.date));
    await putDayLogRecord({ date: item.date, secDateKey, entries });
    renderDayLogEntriesList(item.date, entries);
    document.getElementById('action-modal').classList.add('hidden');
    selectedLongPressItem = null;
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
    openNewDayLogInput(item.text, item.id, item.date);
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

function renderSettingsDropdowns() {
  const pSelect = document.getElementById('settings-delete-project-select');
  pSelect.innerHTML = customProjects.filter(p => p !== 'Default Tasks').map(p => `<option value="${p}">${p}</option>`).join('') || '<option value="">No custom projects</option>';

  const aSelect = document.getElementById('settings-delete-aspect-select');
  aSelect.innerHTML = customAspects.filter(a => a !== 'Daily').map(a => `<option value="${a}">${a}</option>`).join('') || '<option value="">No custom aspects</option>';
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

async function exportData() {
  const target = document.getElementById('export-tab-select').value;
  const data = {};
  if (target === 'all') {
    data.tasks = await getAll('tasks');
    data.events = await getAll('events');
    data.reminders = await getAll('reminders');
    data.people = await getAll('people');
  } else {
    data[target] = await getAll(target);
  }

  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rolodex_backup_${target}_${toIsoDateStr(new Date())}.json`;
  a.click();
}

async function importData() {
  const target = document.getElementById('import-tab-select').value;
  const fileInput = document.getElementById('import-file-input');
  if (!fileInput.files.length) {
    alert('Please select a JSON file to import.');
    return;
  }

  const file = fileInput.files[0];
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    if (target === 'all') {
      if (data.tasks) for (const item of data.tasks) await saveItem('tasks', item);
      if (data.events) for (const item of data.events) await saveItem('events', item);
      if (data.reminders) for (const item of data.reminders) await saveItem('reminders', item);
      if (data.people) for (const item of data.people) await saveItem('people', item);
    } else if (data[target] || Array.isArray(data)) {
      const list = data[target] || data;
      for (const item of list) await saveItem(target, item);
    }
    alert('Data imported successfully!');
    document.getElementById('settings-modal').classList.add('hidden');
    renderAll();
  } catch (err) {
    alert('Invalid JSON file format.');
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
}

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
          ${p.name} (${p.code})
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
          ${p.name} (${p.code})
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
    <span class="tag-chip">${n} <span class="remove-tag" onclick="removeEventPersonTag('${n.replace(/'/g, "\'")}')">&times;</span></span>
  `).join('');
}

function normalizeDayLogEntries(dayLog) {
  if (!dayLog) return [];
  if (Array.isArray(dayLog.entries)) return dayLog.entries;
  if (dayLog.notes) {
    return [{ id: 'legacy-1', text: dayLog.notes, updatedAt: Date.now() }];
  }
  return [];
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
    row.textContent = entry.text;
    addLongPressHandler(row, () => {
      openActionModal('dayLogs', {
        id: entry.id,
        date: dateStr,
        text: entry.text
      });
    });
    listEl.appendChild(row);
  });
}

async function showDayDetails(dayName, dateStr, tasks, events, reminders) {
  const modal = document.getElementById('day-details-modal');
  const dateObj = parseLocalDate(dateStr);
  const secKey = getSecondaryCalendarKey(dateObj);
  const regKey = getRegularCalendarKey(dateObj);

  document.getElementById('day-modal-title').textContent = `${regKey} | ${dayName} | ${secKey}`;
  const body = document.getElementById('day-modal-body');

  const dayLog = await getDayLog(dateStr);
  const entries = normalizeDayLogEntries(dayLog);
  editingLogContext = null;

  let html = `<h4>Tasks</h4>`;
  html += tasks.length ? tasks.map(t => `<p>• ${t.title} [${t.project}]</p>`).join('') : '<p class="text-muted">None</p>';

  html += `<h4 style="margin-top:10px;">Events</h4>`;
  html += events.length ? events.map(ev => `<p>• ${ev.type}: ${ev.persons ? ev.persons.join(', ') : ''}</p>`).join('') : '<p class="text-muted">None</p>';

  html += `<h4 style="margin-top:10px;">Reminders</h4>`;
  html += reminders.length ? reminders.map(r => `<p>• ${r.title} (${r.aspect})</p>`).join('') : '<p class="text-muted">None</p>';

  html += `
    <div class="day-log-box">
      <h4>Day Logs</h4>
      <div id="day-log-entries-list"></div>
      <div id="day-log-edit-form" class="hidden">
        <textarea id="day-log-input" class="day-log-textarea" placeholder="Write a log entry..."></textarea>
        <div class="day-log-actions">
          <button type="button" id="save-day-log-btn" class="btn btn-primary btn-sm" onclick="saveDayLogEntry('${dateStr}')">Save Log</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="cancelDayLogEdit()">Cancel</button>
        </div>
      </div>
      <button type="button" id="add-day-log-btn" class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick="openNewDayLogInput()">+ Add Log</button>
    </div>
  `;

  body.innerHTML = html;
  renderDayLogEntriesList(dateStr, entries);
  modal.classList.remove('hidden');
}

function openNewDayLogInput(prefillText = '', logId = null, dateStr = null) {
  editingLogContext = logId && dateStr ? { id: logId, date: dateStr } : null;
  const form = document.getElementById('day-log-edit-form');
  const input = document.getElementById('day-log-input');
  const addBtn = document.getElementById('add-day-log-btn');
  if (!form || !input) return;

  input.value = prefillText;
  form.classList.remove('hidden');
  if (addBtn) addBtn.classList.add('hidden');
  input.focus();
}

function cancelDayLogEdit() {
  editingLogContext = null;
  const form = document.getElementById('day-log-edit-form');
  const input = document.getElementById('day-log-input');
  const addBtn = document.getElementById('add-day-log-btn');
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
  const input = document.getElementById('day-log-input');
  const text = input ? input.value.trim() : '';
  if (!text) return;

  const existing = await getDayLog(dateStr);
  const entries = normalizeDayLogEntries(existing);

  if (editingLogContext && editingLogContext.date === dateStr) {
    const idx = entries.findIndex(entry => entry.id === editingLogContext.id);
    if (idx !== -1) {
      entries[idx] = { ...entries[idx], text, updatedAt: Date.now() };
    }
  } else {
    entries.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text,
      updatedAt: Date.now()
    });
  }

  const secDateKey = getSecondaryCalendarKey(parseLocalDate(dateStr));
  await putDayLogRecord({ date: dateStr, secDateKey, entries });

  cancelDayLogEdit();
  renderDayLogEntriesList(dateStr, entries);
}

function getDayLog(dateStr) {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains('dayLogs')) {
      resolve(null);
      return;
    }
    const tx = db.transaction('dayLogs', 'readonly');
    const req = tx.objectStore('dayLogs').get(dateStr);
    req.onsuccess = () => resolve(req.result);
  });
}
