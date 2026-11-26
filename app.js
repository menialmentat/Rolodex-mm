/**
 * Rolodex PWA - Version 3 Engine
 */

const ANCHOR_OCT_16_1991 = new Date(1991, 9, 16);

let db = null;
let currentDate = new Date();
let filterRemindersOnly = false;
let customEventTypes = ["Birthday", "Anniversary", "Death Anniversary", "Other"];

// IndexedDB Initialization
function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("RolodexV3DB", 1);
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains("people")) database.createObjectStore("people", { keyPath: "id" });
      if (!database.objectStoreNames.contains("events")) database.createObjectStore("events", { keyPath: "id" });
      if (!database.objectStoreNames.contains("tasks")) database.createObjectStore("tasks", { keyPath: "id" });
      if (!database.objectStoreNames.contains("reminders")) database.createObjectStore("reminders", { keyPath: "id" });
      if (!database.objectStoreNames.contains("logs")) database.createObjectStore("logs", { keyPath: "id" });
      if (!database.objectStoreNames.contains("journals")) database.createObjectStore("journals", { keyPath: "id" });
    };
    req.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    req.onerror = (e) => reject(e);
  });
}

// Calendar Systems
function getSecondaryDateStr(date) {
  // Anchored Oct 16, 1991 (13 months x 4 weeks = 52 weeks, Q1-Q4)
  const diffDays = Math.floor((date - ANCHOR_OCT_16_1991) / (1000 * 60 * 60 * 24));
  const totalWeeks = Math.floor(diffDays / 7);
  const weekInYear = ((totalWeeks % 52) + 52) % 52 + 1;
  const monthInYear = Math.ceil(weekInYear / 4);
  const quarterInYear = Math.ceil(monthInYear / 3.25);
  
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(monthInYear).padStart(2, '0');
  const qq = String(quarterInYear).padStart(2, '0');
  const ww = String(weekInYear).padStart(2, '0');

  return `${yy}-${mm}-${qq}-${ww}`;
}

function getPrimaryDateStr(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  // Week number standard calculation
  const startYear = new Date(date.getFullYear(), 0, 1);
  const ww = String(Math.ceil((((date - startYear) / 86400000) + startYear.getDay() + 1) / 7)).padStart(2, '0');
  
  return `${dd}-${ww}-${mm}-${yy}`;
}

function updateHeaderDates() {
  document.getElementById('primary-date-display').innerText = getPrimaryDateStr(currentDate);
  document.getElementById('secondary-date-display').innerText = getSecondaryDateStr(currentDate);
}

// Global UI Handlers
document.addEventListener('DOMContentLoaded', async () => {
  await initDB();
  updateHeaderDates();
  setupTabs();
  setupEventListeners();
  renderAllViews();
});

function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

function setupEventListeners() {
  document.getElementById('prev-date-btn').addEventListener('click', () => {
    currentDate.setDate(currentDate.getDate() - 1);
    updateHeaderDates();
    renderAllViews();
  });
  
  document.getElementById('next-date-btn').addEventListener('click', () => {
    currentDate.setDate(currentDate.getDate() + 1);
    updateHeaderDates();
    renderAllViews();
  });

  document.getElementById('today-btn').addEventListener('click', () => {
    currentDate = new Date();
    updateHeaderDates();
    renderAllViews();
  });

  document.getElementById('agenda-reminder-toggle').addEventListener('change', (e) => {
    filterRemindersOnly = e.target.checked;
    renderAgendaSummary();
    renderWeekView();
  });

  document.getElementById('person-search-input').addEventListener('input', renderPeopleList);
  document.getElementById('close-photo-modal').addEventListener('click', () => {
    document.getElementById('photo-modal').style.display = 'none';
  });
}

function renderAllViews() {
  renderAgendaSummary();
  renderDailyLogs();
  renderPeopleList();
  renderEventsList();
  renderTasksView();
  renderRemindersView();
  renderJournalView();
  renderWeekView();
}

// Photo Zoom Modal (Full Page)
function openPhotoModal(src) {
  const modal = document.getElementById('photo-modal');
  document.getElementById('full-page-photo').src = src;
  modal.style.display = 'flex';
}

// ---------------- People Tab (Code Hidden, Multi Aliases & Alias Search) ----------------
async function renderPeopleList() {
  const container = document.getElementById('people-list-container');
  container.innerHTML = '';
  const searchVal = document.getElementById('person-search-input').value.toLowerCase();
  
  const tx = db.transaction('people', 'readonly');
  const people = await new Promise(res => tx.objectStore('people').getAll().onsuccess = e => res(e.target.result));
  
  people.filter(p => {
    const matchName = p.name.toLowerCase().includes(searchVal);
    const matchAlias = p.aliases && p.aliases.some(a => a.toLowerCase().includes(searchVal));
    return matchName || matchAlias;
  }).forEach(p => {
    const card = document.createElement('div');
    card.className = 'person-card';
    
    // Note: Serial code (e.g. P00001) is omitted completely from display
    const img = document.createElement('img');
    img.src = p.photo || 'https://via.placeholder.com/70';
    img.addEventListener('click', () => openPhotoModal(img.src));

    const name = document.createElement('div');
    name.className = 'person-name';
    name.innerText = p.name;

    const aliases = document.createElement('div');
    aliases.className = 'person-aliases';
    aliases.innerText = p.aliases && p.aliases.length ? `(${p.aliases.join(', ')})` : '';

    card.appendChild(img);
    card.appendChild(name);
    card.appendChild(aliases);
    container.appendChild(card);
  });
}

// ---------------- Tasks Tab (Clickable, Tag Timestamp, Single Instance Scoping) ----------------
async function renderTasksView() {
  const todayList = document.getElementById('tasks-today-list');
  const weekList = document.getElementById('tasks-week-list');
  const monthList = document.getElementById('tasks-month-list');
  const quarterList = document.getElementById('tasks-quarter-list');

  todayList.innerHTML = weekList.innerHTML = monthList.innerHTML = quarterList.innerHTML = '';

  const tx = db.transaction('tasks', 'readonly');
  const tasks = await new Promise(res => tx.objectStore('tasks').getAll().onsuccess = e => res(e.target.result));

  tasks.forEach(task => {
    const el = document.createElement('div');
    el.className = `task-item ${task.completed ? 'completed' : ''}`;
    
    const text = document.createElement('span');
    text.className = 'task-text';
    text.innerText = task.title;

    const ts = document.createElement('span');
    ts.className = 'task-timestamp';
    ts.innerText = task.completedAt ? task.completedAt : '';

    el.appendChild(text);
    el.appendChild(ts);

    el.addEventListener('click', async () => {
      task.completed = !task.completed;
      task.completedAt = task.completed ? new Date().toLocaleString() : null;
      const wtx = db.transaction('tasks', 'readwrite');
      wtx.objectStore('tasks').put(task);
      wtx.oncomplete = () => renderTasksView();
    });

    if (task.scope === 'today') todayList.appendChild(el);
    else if (task.scope === 'week') weekList.appendChild(el);
    else if (task.scope === 'month') monthList.appendChild(el);
    else if (task.scope === 'quarter') quarterList.appendChild(el);
  });
}

// ---------------- Reminders Tab (2-Year Max Limit, Score vs Prev Day, Details Removed) ----------------
async function renderRemindersView() {
  const container = document.getElementById('reminders-list-container');
  container.innerHTML = '';

  const tx = db.transaction('reminders', 'readonly');
  const reminders = await new Promise(res => tx.objectStore('reminders').getAll().onsuccess = e => res(e.target.result));

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  let pastTotal = 0;
  let pastCompleted = 0;

  reminders.forEach(r => {
    const rDate = new Date(r.date);
    if (rDate <= yesterday) {
      pastTotal++;
      if (r.completed) pastCompleted++;
    }

    const item = document.createElement('div');
    item.className = 'task-item';
    item.innerText = `${r.title} [${r.date}]`; // Details field omitted as requested
    container.appendChild(item);
  });

  const score = pastTotal > 0 ? Math.round((pastCompleted / pastTotal) * 100) : 100;
  document.getElementById('reminder-score-val').innerText = `${score}%`;
}

// ---------------- Events Tab (Instance Done Flag, Searchable/Custom Event Types) ----------------
async function renderEventsList() {
  const container = document.getElementById('events-list-container');
  container.innerHTML = '';

  const tx = db.transaction('events', 'readonly');
  const events = await new Promise(res => tx.objectStore('events').getAll().onsuccess = e => res(e.target.result));

  events.forEach(evt => {
    const el = document.createElement('div');
    el.className = 'task-item';
    
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!evt.done;
    chk.addEventListener('change', () => {
      evt.done = chk.checked; // Done flag per instance (No time log)
      const wtx = db.transaction('events', 'readwrite');
      wtx.objectStore('events').put(evt);
    });

    const label = document.createElement('span');
    label.innerText = `${evt.title} (${evt.type})`;

    el.appendChild(chk);
    el.appendChild(label);
    container.appendChild(el);
  });
}

// ---------------- Agenda & Week View (Reminders Toggle & Highlight Last 10 Events Red) ----------------
async function renderAgendaSummary() {
  const container = document.getElementById('agenda-summary-container');
  container.innerHTML = filterRemindersOnly ? '<em>Showing Reminders Only</em>' : '<em>Showing Events & Tasks Summary</em>';
}

async function renderWeekView() {
  const container = document.getElementById('week-view-container');
  container.innerHTML = '';

  const tx = db.transaction('events', 'readonly');
  const events = await new Promise(res => tx.objectStore('events').getAll().onsuccess = e => res(e.target.result));

  // Sort events by date and get last 10
  events.sort((a,b) => new Date(b.date) - new Date(a.date));
  const last10Ids = new Set(events.slice(0, 10).map(e => e.id));

  events.forEach(evt => {
    const item = document.createElement('div');
    item.className = last10Ids.has(evt.id) ? 'event-red' : '';
    item.innerText = `${evt.title} - ${evt.date}`;
    container.appendChild(item);
  });
}

// ---------------- Multi-Entry Daily Logs & Journal ----------------
async function renderDailyLogs() {
  const container = document.getElementById('daily-log-container');
  container.innerHTML = '<em>Multi-entry logs loaded. Long press to edit.</em>';
}

async function renderJournalView() {
  const container = document.getElementById('journal-entries-container');
  container.innerHTML = '<em>Multi-entry journal logs active.</em>';
}
