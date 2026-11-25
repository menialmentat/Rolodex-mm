// Main JavaScript Application File for Rolodex PWA
// Features: IndexedDB, Service Worker, Swipe Tabs, Tab-based Data Import/Export

const DB_NAME = 'RolodexDB';
const DB_VERSION = 1;
let db = null;

// Application State
let activeTab = 'home';
let currentWeekOffset = 0; // 0 = current week
let currentProject = 'All';
let currentAspect = 'Daily';
let selectedLongPressItem = null;

// Initialize Database
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
    };
  });
}

// Database Helpers
function getAll(storeName) {
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
  });
}

function saveItem(storeName, item) {
  return new Promise((resolve) => {
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

// App Initialization
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

// Global UI Event Listeners
function setupEventListeners() {
  // Settings Modal
  document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.remove('hidden');
  });
  document.getElementById('close-settings-modal').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
  });

  // Export Data
  document.getElementById('export-data-btn').addEventListener('click', exportData);
  document.getElementById('import-data-btn').addEventListener('click', importData);

  // Sample Downloads
  document.querySelectorAll('.sample-btn').forEach(btn => {
    btn.addEventListener('click', (e) => downloadSample(e.target.dataset.type));
  });

  // Home Navigation
  document.getElementById('prev-week-btn').addEventListener('click', () => { currentWeekOffset--; renderHome(); });
  document.getElementById('next-week-btn').addEventListener('click', () => { currentWeekOffset++; renderHome(); });
  document.getElementById('reset-week-btn').addEventListener('click', () => { currentWeekOffset = 0; renderHome(); });
  document.getElementById('close-day-modal').addEventListener('click', () => {
    document.getElementById('day-details-modal').classList.add('hidden');
  });

  // Task Form & Dynamic Input
  document.getElementById('task-deadline-type').addEventListener('change', updateTaskDeadlineInput);
  document.getElementById('task-form').addEventListener('submit', handleTaskSubmit);
  document.getElementById('add-project-btn').addEventListener('click', addProjectPrompt);

  // Event Form
  document.getElementById('event-form').addEventListener('submit', handleEventSubmit);

  // Reminder Form
  document.getElementById('reminder-form').addEventListener('submit', handleReminderSubmit);
  document.querySelectorAll('.day-chip').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('selected'));
  });
  document.getElementById('add-aspect-btn').addEventListener('click', addAspectPrompt);

  // Person Form Dynamic Fields
  document.getElementById('add-phone-btn').addEventListener('click', () => addDynamicField('phones-container', 'phone', ''));
  document.getElementById('add-email-btn').addEventListener('click', () => addDynamicField('emails-container', 'email', ''));
  document.getElementById('add-relationship-btn').addEventListener('click', () => addRelationshipField());
  document.getElementById('person-form').addEventListener('submit', handlePersonSubmit);
  document.getElementById('close-person-modal').addEventListener('click', () => {
    document.getElementById('person-details-modal').classList.add('hidden');
  });

  // Action Modal (Long Press Options)
  document.getElementById('action-cancel-btn').addEventListener('click', () => {
    document.getElementById('action-modal').classList.add('hidden');
  });
  document.getElementById('action-delete-btn').addEventListener('click', handleLongPressDelete);
  document.getElementById('action-edit-btn').addEventListener('click', handleLongPressEdit);
}

// Tab Navigation Logic
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

// ==========================================
// HOME TAB LOGIC
// ==========================================
async function renderHome() {
  const tasks = await getAll('tasks');
  const events = await getAll('events');
  const reminders = await getAll('reminders');

  // Agenda Summary
  renderAgendaSummary(tasks, events, reminders);

  // Week View Calculation
  const today = new Date();
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
    const dateStr = dayDate.toISOString().split('T')[0];

    const isToday = dayDate.toDateString() === today.toDateString();
    
    // Filter items for this day
    const dayTasks = tasks.filter(t => t.deadline === dateStr);
    const dayEvents = events.filter(e => isEventOnDate(e, dayDate));
    const dayReminders = reminders.filter(r => isReminderOnDate(r, dayDate));

    const row = document.createElement('div');
    row.className = `day-row ${isToday ? 'today-highlight' : ''}`;
    row.innerHTML = `
      <div class="day-title">${dayNames[i]} (${dayDate.getMonth()+1}/${dayDate.getDate()})</div>
      <div class="day-counts">Tasks: ${dayTasks.length} | Events: ${dayEvents.length} | Reminders: ${dayReminders.length}</div>
    `;
    row.addEventListener('click', () => showDayDetails(dayNames[i], dateStr, dayTasks, dayEvents, dayReminders));
    weekDaysContainer.appendChild(row);
  }
}

function getStartOfWeek(d, weekOffset = 0) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (weekOffset * 7);
  return new Date(date.setDate(diff));
}

function renderAgendaSummary(tasks, events, reminders) {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const todayItems = events.filter(e => isEventOnDate(e, today));
  const weekItems = events.filter(e => isEventInWeek(e, today));
  const monthItems = events.filter(e => isEventInMonth(e, today));
  const quarterItems = events.filter(e => isEventInQuarter(e, today));

  renderAgendaList('agenda-today', todayItems);
  renderAgendaList('agenda-week', weekItems);
  renderAgendaList('agenda-month', monthItems);
  renderAgendaList('agenda-quarter', quarterItems);
}

function renderAgendaList(containerId, items) {
  const container = document.getElementById(containerId);
  if (items.length === 0) {
    container.innerHTML = '<div class="agenda-item text-muted">No events</div>';
    return;
  }
  container.innerHTML = items.map(item => `
    <div class="agenda-item">• <strong>${item.type}</strong>: ${item.persons ? item.persons.join(', ') : 'Event'} (${item.date})</div>
  `).join('');
}

function showDayDetails(dayName, dateStr, tasks, events, reminders) {
  const modal = document.getElementById('day-details-modal');
  document.getElementById('day-modal-title').textContent = `${dayName} (${dateStr})`;
  const body = document.getElementById('day-modal-body');
  
  let html = `<h4>Tasks</h4>`;
  html += tasks.length ? tasks.map(t => `<p>• ${t.title} [${t.project}]</p>`).join('') : '<p class="text-muted">None</p>';
  
  html += `<h4 style="margin-top:10px;">Events</h4>`;
  html += events.length ? events.map(e => `<p>• ${e.type}: ${e.persons ? e.persons.join(', ') : ''}</p>`).join('') : '<p class="text-muted">None</p>';
  
  html += `<h4 style="margin-top:10px;">Reminders</h4>`;
  html += reminders.length ? reminders.map(r => `<p>• ${r.title} (${r.aspect})</p>`).join('') : '<p class="text-muted">None</p>';

  body.innerHTML = html;
  modal.classList.remove('hidden');
}

// ==========================================
// TASKS TAB LOGIC
// ==========================================
async function renderTasks() {
  const tasks = await getAll('tasks');
  const people = await getAll('people');

  // Populate Assigned Person Dropdown
  const assignedSelect = document.getElementById('task-assigned');
  assignedSelect.innerHTML = '<option value="">Unassigned</option>' + 
    people.map(p => `<option value="${p.id}">${p.name}</option>`).join('');

  // Extract Projects
  const projects = ['All', 'Default Tasks', ...new Set(tasks.map(t => t.project).filter(Boolean))];
  const chipsContainer = document.getElementById('project-chips');
  chipsContainer.innerHTML = projects.map(p => `
    <div class="chip ${currentProject === p ? 'active' : ''}" onclick="selectProject('${p}')">${p}</div>
  `).join('');

  const projectSelect = document.getElementById('task-project');
  projectSelect.innerHTML = projects.filter(p => p !== 'All').map(p => `<option value="${p}">${p}</option>`).join('');

  // Filter Tasks
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
    
    // Tap once to toggle completed status
    item.addEventListener('click', async () => {
      t.completed = !t.completed;
      await saveItem('tasks', t);
      renderTasks();
    });

    // Long press for options
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
  if (id) task.id = parseInt(id);
  await saveItem('tasks', task);
  document.getElementById('task-form').reset();
  document.getElementById('task-id').value = '';
  renderTasks();
}

function selectProject(p) {
  currentProject = p;
  renderTasks();
}

function addProjectPrompt() {
  const name = prompt('Enter new project name:');
  if (name) {
    currentProject = name;
    renderTasks();
  }
}

// ==========================================
// EVENTS TAB LOGIC
// ==========================================
async function renderEvents() {
  const events = await getAll('events');
  const people = await getAll('people');

  // Multi-person selection check list
  const personsContainer = document.getElementById('event-persons-select');
  personsContainer.innerHTML = people.map(p => `
    <label class="multi-select-item">
      <input type="checkbox" name="event-person" value="${p.name}"> ${p.name}
    </label>
  `).join('') || '<div class="text-muted">No people added yet</div>';

  // Filter events for Current Quarter (with 3-day lead in)
  const now = new Date();
  const currentQuarterEvents = events.filter(e => isEventInQuarterWithLead(e, now));

  const eventsList = document.getElementById('events-list');
  eventsList.innerHTML = '';

  currentQuarterEvents.forEach(e => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div>
        <div class="item-title">${e.type} - ${e.persons ? e.persons.join(', ') : 'Event'}</div>
        <div class="item-details">Recurring Date: ${e.date}</div>
      </div>
    `;
    addLongPressHandler(item, () => openActionModal('events', e));
    eventsList.appendChild(item);
  });
}

async function handleEventSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('event-id').value;
  const checkedPersons = Array.from(document.querySelectorAll('input[name="event-person"]:checked')).map(cb => cb.value);
  const eventObj = {
    persons: checkedPersons,
    type: document.getElementById('event-type').value,
    date: document.getElementById('event-date').value,
  };
  if (id) eventObj.id = parseInt(id);
  await saveItem('events', eventObj);
  document.getElementById('event-form').reset();
  document.getElementById('event-id').value = '';
  renderEvents();
  renderHome();
}

function isEventOnDate(e, targetDate) {
  if (!e.date) return false;
  const eDate = new Date(e.date);
  return eDate.getMonth() === targetDate.getMonth() && eDate.getDate() === targetDate.getDate();
}

function isEventInWeek(e, today) {
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    if (isEventOnDate(e, d)) return true;
  }
  return false;
}

function isEventInMonth(e, today) {
  if (!e.date) return false;
  const eDate = new Date(e.date);
  return eDate.getMonth() === today.getMonth();
}

function isEventInQuarter(e, today) {
  if (!e.date) return false;
  const eDate = new Date(e.date);
  const currentQ = Math.floor(today.getMonth() / 3);
  const eventQ = Math.floor(eDate.getMonth() / 3);
  return currentQ === eventQ;
}

function isEventInQuarterWithLead(e, today) {
  if (!e.date) return false;
  const leadStart = new Date(today);
  leadStart.setDate(leadStart.getDate() - 3);
  
  const eDate = new Date(e.date);
  const currentQ = Math.floor(today.getMonth() / 3);
  const eventQ = Math.floor(eDate.getMonth() / 3);
  
  return (currentQ === eventQ) || (eDate >= leadStart && eDate <= today);
}

// ==========================================
// REMINDERS TAB LOGIC
// ==========================================
async function renderReminders() {
  const reminders = await getAll('reminders');
  
  const aspects = ['Daily', ...new Set(reminders.map(r => r.aspect).filter(Boolean))];
  const chipsContainer = document.getElementById('aspect-chips');
  chipsContainer.innerHTML = aspects.map(a => `
    <div class="chip ${currentAspect === a ? 'active' : ''}" onclick="selectAspect('${a}')">${a}</div>
  `).join('');

  const aspectSelect = document.getElementById('reminder-aspect');
  aspectSelect.innerHTML = aspects.map(a => `<option value="${a}">${a}</option>`).join('');

  const filteredReminders = reminders.filter(r => r.aspect === currentAspect);
  const remindersList = document.getElementById('reminders-list');
  remindersList.innerHTML = '';

  filteredReminders.forEach(r => {
    const daysStr = r.days ? r.days.map(d => ['S','M','T','W','T','F','S'][d]).join(', ') : 'All';
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div>
        <div class="item-title">${r.title}</div>
        <div class="item-details">Aspect: ${r.aspect} | Every ${r.weeksInterval} wk(s) on: ${daysStr}</div>
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
    currentAspect = name;
    renderReminders();
  }
}

async function handleReminderSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('reminder-id').value;
  const selectedDays = Array.from(document.querySelectorAll('.day-chip.selected')).map(chip => parseInt(chip.dataset.day));
  const reminder = {
    title: document.getElementById('reminder-title').value,
    aspect: document.getElementById('reminder-aspect').value || 'Daily',
    weeksInterval: document.getElementById('reminder-weeks-interval').value || 1,
    days: selectedDays
  };
  if (id) reminder.id = parseInt(id);
  await saveItem('reminders', reminder);
  document.getElementById('reminder-form').reset();
  document.querySelectorAll('.day-chip').forEach(c => c.classList.remove('selected'));
  document.getElementById('reminder-id').value = '';
  renderReminders();
}

function isReminderOnDate(r, date) {
  if (!r.days || r.days.length === 0) return true;
  return r.days.includes(date.getDay());
}

// ==========================================
// PEOPLE TAB LOGIC
// ==========================================
async function renderPeople() {
  const people = await getAll('people');
  const tasks = await getAll('tasks');
  const events = await getAll('events');

  // Sort contacts alphabetically
  people.sort((a, b) => a.name.localeCompare(b.name));

  const peopleList = document.getElementById('people-list');
  peopleList.innerHTML = '';

  people.forEach(p => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div class="person-card-header">
        ${p.photo ? `<img src="${p.photo}" class="photo-avatar">` : `<div class="photo-avatar">👤</div>`}
        <div>
          <div class="item-title">${p.name} (${p.code})</div>
          <div class="item-details">${p.phones ? p.phones.join(', ') : 'No phone'}</div>
        </div>
      </div>
    `;
    
    // Tap person to open detail modal
    item.addEventListener('click', () => showPersonDetails(p, people, tasks, events));
    addLongPressHandler(item, () => openActionModal('people', p));
    peopleList.appendChild(item);
  });

  // Update Relationships Dropdown Options
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

  // Handle Photo
  const photoInput = document.getElementById('person-photo-input');
  let photoData = null;
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

  if (id) person.id = parseInt(id);

  await saveItem('people', person);
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
  let num = parseInt(lastCode.slice(1)) + 1;
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
  const personEvents = events.filter(e => e.persons && e.persons.includes(p.name));

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
      ${p.photo ? `<img src="${p.photo}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;">` : `<div style="font-size:40px;">👤</div>`}
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
    ${personEvents.length ? personEvents.map(e => `<p>• ${e.type} (${e.date})</p>`).join('') : '<p class="text-muted">None</p>'}

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

// ==========================================
// LONG PRESS & CONTEXT ACTION HANDLERS
// ==========================================
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
  document.getElementById('action-modal-title').textContent = `Manage ${storeName.slice(0, -1)}`;
  document.getElementById('action-modal').classList.remove('hidden');
}

async function handleLongPressDelete() {
  if (selectedLongPressItem) {
    await deleteItem(selectedLongPressItem.storeName, selectedLongPressItem.item.id);
    document.getElementById('action-modal').classList.add('hidden');
    renderAll();
  }
}

function handleLongPressEdit() {
  if (selectedLongPressItem) {
    document.getElementById('action-modal').classList.add('hidden');
    editItem(selectedLongPressItem.storeName, selectedLongPressItem.item);
  }
}

function editItem(storeName, item) {
  if (storeName === 'tasks') {
    document.getElementById('task-id').value = item.id;
    document.getElementById('task-title').value = item.title;
    document.getElementById('task-assigned').value = item.assigned || '';
    document.getElementById('task-project').value = item.project;
    document.getElementById('task-deadline-type').value = item.deadlineType || 'date';
    updateTaskDeadlineInput();
    document.getElementById('task-deadline-val').value = item.deadline;
  } else if (storeName === 'events') {
    document.getElementById('event-id').value = item.id;
    document.getElementById('event-type').value = item.type;
    document.getElementById('event-date').value = item.date;
  } else if (storeName === 'reminders') {
    document.getElementById('reminder-id').value = item.id;
    document.getElementById('reminder-title').value = item.title;
    document.getElementById('reminder-aspect').value = item.aspect;
    document.getElementById('reminder-weeks-interval').value = item.weeksInterval || 1;
  } else if (storeName === 'people') {
    document.getElementById('person-id').value = item.id;
    document.getElementById('person-serial-code').value = item.code;
    document.getElementById('person-name').value = item.name;
    document.getElementById('person-notes').value = item.notes || '';
    
    // Fill dynamic fields
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

// ==========================================
// IMPORT & EXPORT SETTINGS LOGIC
// ==========================================
async function exportData() {
  const target = document.getElementById('export-tab-select').value;
  let data = {};
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
  a.download = `rolodex_backup_${target}_${new Date().toISOString().split('T')[0]}.json`;
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
    sampleData = [{ title: 'Sample Reminder', aspect: 'Daily', weeksInterval: 1, days: [1, 3, 5] }];
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
