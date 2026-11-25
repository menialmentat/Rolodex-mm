// Database Controller
const DB_NAME = 'RolodexDB';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      ['tasks', 'events', 'reminders', 'people'].forEach((store) => {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id', autoIncrement: true });
        }
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function addRecord(storeName, data) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).add(data);
    tx.oncomplete = () => resolve();
  });
}

async function getAll(storeName) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
  });
}

// Tab Switcher
function switchTab(tabName) {
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  
  const view = document.getElementById('app-view');
  if (tabName === 'home') renderHome(view);
  else if (tabName === 'tasks') renderTasks(view);
  else if (tabName === 'events') renderEvents(view);
  else if (tabName === 'reminders') renderReminders(view);
  else if (tabName === 'people') renderPeople(view);
}

async function renderHome(container) {
  const tasks = await getAll('tasks');
  const events = await getAll('events');
  const reminders = await getAll('reminders');
  container.innerHTML = `
    <div class="card">
      <h3>Agenda Today</h3>
      <p>Tasks: ${tasks.length} pending</p>
      <p>Upcoming Events: ${events.length}</p>
      <p>Active Reminders: ${reminders.length}</p>
    </div>
  `;
}

async function renderTasks(container) {
  const people = await getAll('people');
  const tasks = await getAll('tasks');
  container.innerHTML = `
    <div class="card">
      <h3>New Task</h3>
      <input type="text" id="t-title" placeholder="Task Name">
      <select id="t-person">
        <option value="">Assign Person (Optional)</option>
        ${people.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
      </select>
      <button class="btn" onclick="saveTask()">Add Task</button>
    </div>
    <div class="card">
      <h3>Task List</h3>
      ${tasks.map(t => `<p>• ${t.title}</p>`).join('') || '<p>No tasks added yet.</p>'}
    </div>
  `;
}

async function saveTask() {
  const title = document.getElementById('t-title').value;
  const personId = document.getElementById('t-person').value;
  if (!title) return;
  await addRecord('tasks', { title, personId, createdAt: new Date() });
  switchTab('tasks');
}

async function renderEvents(container) {
  const events = await getAll('events');
  container.innerHTML = `
    <div class="card">
      <h3>New Event</h3>
      <input type="text" id="e-title" placeholder="Event Title">
      <button class="btn" onclick="saveEvent()">Add Event</button>
    </div>
    <div class="card">
      <h3>Scheduled Events</h3>
      ${events.map(e => `<p>📅 ${e.title}</p>`).join('') || '<p>No events scheduled.</p>'}
    </div>
  `;
}

async function saveEvent() {
  const title = document.getElementById('e-title').value;
  if (!title) return;
  await addRecord('events', { title, createdAt: new Date() });
  switchTab('events');
}

async function renderReminders(container) {
  const reminders = await getAll('reminders');
  container.innerHTML = `
    <div class="card">
      <h3>New Reminder</h3>
      <input type="text" id="r-title" placeholder="Reminder Description">
      <button class="btn" onclick="saveReminder()">Add Reminder</button>
    </div>
    <div class="card">
      <h3>Reminders List</h3>
      ${reminders.map(r => `<p>🔔 ${r.title}</p>`).join('') || '<p>No reminders yet.</p>'}
    </div>
  `;
}

async function saveReminder() {
  const title = document.getElementById('r-title').value;
  if (!title) return;
  await addRecord('reminders', { title, createdAt: new Date() });
  switchTab('reminders');
}

async function renderPeople(container) {
  const people = await getAll('people');
  container.innerHTML = `
    <div class="card">
      <h3>Add Person</h3>
      <input type="text" id="p-name" placeholder="Full Name">
      <input type="text" id="p-role" placeholder="Role / Relationship">
      <button class="btn" onclick="savePerson()">Save Person</button>
    </div>
    <div class="card">
      <h3>People Directory</h3>
      ${people.map(p => `<p>👤 <strong>${p.name}</strong> (${p.role})</p>`).join('') || '<p>No contacts added.</p>'}
    </div>
  `;
}

async function savePerson() {
  const name = document.getElementById('p-name').value;
  const role = document.getElementById('p-role').value;
  if (!name) return;
  await addRecord('people', { name, role });
  switchTab('people');
}

// Initial view
window.onload = () => renderHome(document.getElementById('app-view'));
