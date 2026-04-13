/* ═══════════════════════════════════════════════════════════════════════════
   SLICK — main.js
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── State ──────────────────────────────────────────────────────────────────

let activeShifts   = [];   // all currently active shift objects
let tasks          = [];
let currentTaskId  = null;
let newTaskColumn  = "todo";
let viewingShift   = null; // shift currently shown (active or ended)
let sortables      = [];
let confirmResolve = null;
let bannerData     = null;
let bannerHidden   = false;
let modalOrigTitle = "";
let modalOrigDue   = "";
let calendarOpen   = false;
let calMonth       = new Date(); // first day of displayed month

calMonth.setDate(1);

// ─── Boot ───────────────────────────────────────────────────────────────────

async function boot() {
  initTheme();
  await refreshShifts();
  await loadTimeline();
  if (activeShifts.length > 0) await selectShift(activeShifts[0]);
  initSortable();
}

// ═══════════════════════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════════════════════

function initTheme() {
  const saved = localStorage.getItem("slick-theme") || "dark";
  applyTheme(saved);
}

function toggleTheme() {
  applyTheme(document.documentElement.classList.contains("dark") ? "light" : "dark");
}

function applyTheme(mode) {
  const html = document.documentElement;
  const btn  = document.getElementById("theme-btn");
  if (mode === "dark") {
    html.classList.add("dark");
    if (btn) btn.textContent = "☀️";
    document.querySelectorAll("input[type=datetime-local]")
      .forEach(el => el.style.colorScheme = "dark");
  } else {
    html.classList.remove("dark");
    if (btn) btn.textContent = "🌙";
    document.querySelectorAll("input[type=datetime-local]")
      .forEach(el => el.style.colorScheme = "light");
  }
  localStorage.setItem("slick-theme", mode);
  // Repaint banner so its inline colors reflect the new theme
  if (bannerData) _paintBanner();
}

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOM CONFIRM
// ═══════════════════════════════════════════════════════════════════════════

function showConfirm(message, okLabel = "Confirm") {
  return new Promise(resolve => {
    confirmResolve = resolve;
    document.getElementById("confirm-message").textContent = message;
    document.getElementById("confirm-ok-btn").textContent = okLabel;
    showModal("confirm-modal");
  });
}
function resolveConfirm(value) {
  hideModal("confirm-modal");
  if (confirmResolve) { confirmResolve(value); confirmResolve = null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function showModal(id) { document.getElementById(id).style.display = "flex"; }
function hideModal(id) { document.getElementById(id).style.display = "none"; }

// ═══════════════════════════════════════════════════════════════════════════
// SHIFT
// ═══════════════════════════════════════════════════════════════════════════

async function refreshShifts() {
  const res = await fetch("/api/shifts/active");
  activeShifts = await res.json();
  renderShiftActions();
}

function isViewingActive() {
  if (!viewingShift) return false;
  return activeShifts.some(s => s._id === viewingShift._id);
}

function renderShiftActions() {
  const el = document.getElementById("shift-actions");
  const viewingActive = isViewingActive();
  let html = "";

  if (viewingActive && viewingShift) {
    const started = new Date(viewingShift.started_at).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    html += `
      <div style="display:flex; align-items:center; gap:10px">
        <div style="text-align:right; display:none" class="sm-show">
          <p style="font-size:13px; font-weight:600; color:var(--t1)">${escHtml(viewingShift.on_call_person)}</p>
          <p style="font-size:11px; color:var(--t3)">${started}</p>
        </div>
        <button onclick="openEndModal()"
          style="padding:8px 16px; font-size:14px; font-weight:600; border-radius:10px;
                 background:#b91c1c; color:#fee2e2; border:none; cursor:pointer">
          End Shift
        </button>
      </div>`;
  }

  html += `
    <button onclick="openStartModal()"
      style="padding:8px 16px; font-size:14px; font-weight:600; border-radius:10px;
             background:#4f46e5; color:#fff; border:none; cursor:pointer">
      Start Shift
    </button>`;

  el.innerHTML = html;

  ["add-todo", "add-doing", "add-done"].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.style.visibility = viewingActive ? "visible" : "hidden";
  });
}

// ─── Start Shift ────────────────────────────────────────────────────────────

function openStartModal()  { document.getElementById("start-name").value = ""; showModal("start-modal"); setTimeout(() => document.getElementById("start-name").focus(), 50); }
function closeStartModal() { hideModal("start-modal"); }

async function confirmStartShift() {
  const name = document.getElementById("start-name").value.trim();
  if (!name) { document.getElementById("start-name").focus(); return; }
  closeStartModal();

  const res = await fetch("/api/shifts/start", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ on_call_person: name }),
  });
  const data = await res.json();

  await refreshShifts();
  await loadTimeline();
  playStartAnimation();

  // Auto-select the newly created shift
  const newShift = activeShifts.find(s => s._id === data._id) || activeShifts[0];
  if (newShift) await selectShift(newShift);

  if (data.prev_handover_notes) renderHandoverBanner(data.prev_on_call_person, data.prev_handover_notes);
  else clearHandoverBanner();
}

// ─── End Shift ──────────────────────────────────────────────────────────────

function openEndModal()  { document.getElementById("end-handover").value = ""; showModal("end-modal"); setTimeout(() => document.getElementById("end-handover").focus(), 50); }
function closeEndModal() { hideModal("end-modal"); }

async function confirmEndShift() {
  const notes = document.getElementById("end-handover").value.trim();
  closeEndModal();
  if (!viewingShift) return;

  await fetch("/api/shifts/end", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shift_id: viewingShift._id, end_handover_notes: notes }),
  });

  await refreshShifts();
  await loadTimeline();

  // Navigate: prefer another active shift; else show the just-ended shift
  if (activeShifts.length > 0) {
    await selectShift(activeShifts[0]);
  } else {
    const endedRes = await fetch("/api/shifts");
    const ended = await endedRes.json();
    if (ended.length > 0) {
      await selectShift(ended[0]);
    } else {
      viewingShift = null;
      tasks = [];
      renderBoard(false);
      renderShiftActions();
    }
  }
}

// ─── Start animation ────────────────────────────────────────────────────────

function playStartAnimation() {
  [
    { sel: ".col-done",  cls: "glow-done"  },
    { sel: ".col-doing", cls: "glow-doing" },
    { sel: ".col-todo",  cls: "glow-todo"  },
  ].forEach(({ sel, cls }, i) => {
    setTimeout(() => {
      const el = document.querySelector(sel);
      el.classList.add(cls);
      setTimeout(() => el.classList.remove(cls), 750);
    }, i * 300);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDOVER BANNER
// ═══════════════════════════════════════════════════════════════════════════

function renderHandoverBanner(person, notes) {
  bannerData = { person, notes };
  bannerHidden = false;
  _paintBanner();
}

function _paintBanner() {
  const el = document.getElementById("handover-banner");
  if (!bannerData) { el.style.display = "none"; el.innerHTML = ""; return; }

  const isDark = document.documentElement.classList.contains("dark");
  const labelColor  = isDark ? "#fbbf24" : "#92400e";
  const textColor   = isDark ? "#fde68a" : "#78350f";
  const btnColor    = isDark ? "#fbbf24" : "#92400e";
  const border      = isDark ? "#92400e"           : "#d97706";
  const bg          = isDark ? "rgba(120,53,15,0.15)" : "rgba(251,191,36,0.12)";
  const hiddenLabel = isDark ? "#a57f00" : "#78350f";
  const hiddenBg    = isDark ? "rgba(120,90,0,0.08)" : "rgba(251,191,36,0.07)";
  const hiddenBorder= isDark ? "rgba(161,132,0,0.3)" : "rgba(180,120,0,0.25)";

  if (bannerHidden) {
    el.style.cssText = `margin:12px 24px 0; border-radius:10px; padding:8px 16px; display:flex; align-items:center; justify-content:space-between; border:1px solid ${hiddenBorder}; background:${hiddenBg}`;
    el.innerHTML = `
      <p style="font-size:13px; color:${hiddenLabel}">
        Handover from <strong>${escHtml(bannerData.person)}</strong> — hidden
      </p>
      <button onclick="toggleBanner()" style="font-size:13px; font-weight:600; color:${btnColor}; background:none; border:none; cursor:pointer; margin-left:12px">Show</button>`;
  } else {
    el.style.cssText = `margin:12px 24px 0; border-radius:12px; padding:14px 18px; border:1px solid ${border}; background:${bg}`;
    el.innerHTML = `
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px">
        <div>
          <p style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:${labelColor}; margin-bottom:6px">Handover from ${escHtml(bannerData.person)}</p>
          <p style="font-size:14px; white-space:pre-wrap; color:${textColor}">${escHtml(bannerData.notes)}</p>
        </div>
        <button onclick="toggleBanner()" style="font-size:13px; font-weight:600; color:${btnColor}; background:none; border:none; cursor:pointer; flex-shrink:0">Hide</button>
      </div>`;
  }
}

function toggleBanner() { bannerHidden = !bannerHidden; _paintBanner(); }

function clearHandoverBanner() {
  bannerData = null;
  bannerHidden = false;
  const el = document.getElementById("handover-banner");
  el.style.display = "none"; el.innerHTML = ""; el.style.cssText = "";
}

// ═══════════════════════════════════════════════════════════════════════════
// TIMELINE
// ═══════════════════════════════════════════════════════════════════════════

const PILL_STYLES = [
  "background:#1e1b38; border-color:#4f46e5; color:#a5b4fc",
  "background:#1a2535; border-color:#1d4ed8; color:#93c5fd",
  "background:#1e2a28; border-color:#0f766e; color:#5eead4",
  "background:#2a2218; border-color:#b45309; color:#fcd34d",
  "background:#2a1e1e; border-color:#b91c1c; color:#fca5a5",
  "background:#1f1e2a; border-color:#7c3aed; color:#c4b5fd",
];

async function loadTimeline() {
  const res = await fetch("/api/shifts");
  renderTimeline(await res.json());
}

function renderTimeline(shifts) {
  const row = document.getElementById("timeline-row");

  // On-call pills (active shifts)
  const activePillsHtml = activeShifts.map(s => {
    const isSelected = viewingShift && viewingShift._id === s._id;
    const ring = isSelected ? "box-shadow:0 0 0 2px #4ade80;" : "";
    return `
      <button class="timeline-pill" onclick="selectShift(${JSON.stringify(s).replace(/"/g, '&quot;')})"
        style="background:#052e16; border-color:#16a34a; color:#86efac; ${ring}"
        title="Active — ${escHtml(s.on_call_person)}">
        <span style="font-size:9px; color:#4ade80; line-height:1">●</span>
        <span style="font-weight:600">${escHtml(s.on_call_person)}</span>
        <span style="opacity:0.6; font-size:10px; font-weight:700; letter-spacing:0.05em">LIVE</span>
      </button>`;
  }).join("");

  // Completed pills (ended shifts, newest rightmost)
  const ordered = [...shifts].reverse();
  const historyPillsHtml = ordered.map((s, i) => {
    const style = PILL_STYLES[i % PILL_STYLES.length];
    const date = new Date(s.ended_at || s.started_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const isSelected = viewingShift && viewingShift._id === s._id;
    const ring = isSelected ? "box-shadow:0 0 0 2px #fff;" : "";
    return `
      <button class="timeline-pill" onclick="selectShift(${JSON.stringify(s).replace(/"/g, '&quot;')})"
        style="${style}; ${ring}" title="${escHtml(s.end_handover_notes || 'No handover notes')}">
        <span style="font-weight:600">${escHtml(s.on_call_person)}</span>
        <span style="opacity:0.5; font-size:11px">${date}</span>
      </button>`;
  }).join("");

  if (!activeShifts.length && !ordered.length) {
    row.innerHTML = `<span style="font-size:13px; color:var(--t3); font-style:italic">No shifts yet</span>`;
    return;
  }

  const activeLabel   = activeShifts.length
    ? `<span style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.07em; color:#4ade80; flex-shrink:0">On-call</span>`
    : "";
  const completedLabel = ordered.length
    ? `<span style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.07em; color:var(--t3); flex-shrink:0">Completed</span>`
    : "";
  const divider = activeShifts.length && ordered.length
    ? `<div style="width:1px; height:28px; background:var(--br); flex-shrink:0; margin:0 4px"></div>`
    : "";

  row.innerHTML = `${activeLabel}${activePillsHtml}${divider}${completedLabel}${historyPillsHtml}`;
}

async function selectShift(shift) {
  viewingShift = shift;
  const res = await fetch(`/api/tasks?shift_id=${shift._id}`);
  tasks = await res.json();
  const readOnly = !isViewingActive();
  renderBoard(readOnly);
  setSortableEnabled(!readOnly);

  if (readOnly) {
    const endedAt = new Date(shift.ended_at).toLocaleString(undefined,
      { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
    document.getElementById("view-banner-text").textContent =
      `Viewing ${shift.on_call_person}'s shift — ended ${endedAt}`;
    document.getElementById("view-banner").classList.add("show");
    if (shift.end_handover_notes) renderHandoverBanner(shift.on_call_person, shift.end_handover_notes);
    else clearHandoverBanner();
  } else {
    document.getElementById("view-banner").classList.remove("show");
    const endedRes = await fetch("/api/shifts");
    const ended = await endedRes.json();
    if (ended.length && ended[0].end_handover_notes)
      renderHandoverBanner(ended[0].on_call_person, ended[0].end_handover_notes);
    else clearHandoverBanner();
  }

  loadTimeline();
  renderShiftActions();
  renderCalendar();
}

// ═══════════════════════════════════════════════════════════════════════════
// BOARD + GROUPING
// ═══════════════════════════════════════════════════════════════════════════

async function refreshTasks() {
  if (!viewingShift) { tasks = []; renderBoard(false); return; }
  const res = await fetch(`/api/tasks?shift_id=${viewingShift._id}`);
  tasks = await res.json();
  renderBoard(!isViewingActive());
  renderCalendar();
}

// Group tasks into due-date buckets
function groupByDue(taskList) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const in3Days = new Date(startOfToday); in3Days.setDate(startOfToday.getDate() + 3);
  const in7Days = new Date(startOfToday); in7Days.setDate(startOfToday.getDate() + 7);

  const groups = { overdue:[], today:[], soon:[], week:[], later:[], none:[] };
  taskList.forEach(t => {
    if (!t.due_time) { groups.none.push(t); return; }
    const d = new Date(t.due_time);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (day < startOfToday)                            groups.overdue.push(t);
    else if (day.getTime() === startOfToday.getTime()) groups.today.push(t);
    else if (day <= in3Days)                           groups.soon.push(t);
    else if (day <= in7Days)                           groups.week.push(t);
    else                                               groups.later.push(t);
  });
  return groups;
}

function renderColumnContent(taskList, readOnly) {
  const g = groupByDue(taskList);
  const sections = [
    { key: "overdue", label: "⚠️ Overdue",       color: "#f87171" },
    { key: "today",   label: "📅 Due Today",      color: "#fb923c" },
    { key: "soon",    label: "⏳ Within 3 Days",  color: "#fbbf24" },
    { key: "week",    label: "📆 This Week",       color: "#34d399" },
    { key: "later",   label: "Later",              color: "var(--t3)" },
    { key: "none",    label: "No due date",        color: "var(--t3)" },
  ];
  let html = "";
  sections.forEach(({ key, label, color }) => {
    const group = g[key];
    if (!group.length) return;
    html += `
      <div class="section-label">
        <span style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.07em; color:${color}">${label}</span>
        <div class="section-label-line" style="background:${color}"></div>
        <span style="font-size:11px; font-weight:600; color:${color}">${group.length}</span>
      </div>`;
    html += group.map(t => renderCard(t, readOnly)).join("");
  });
  return html || `<p style="font-size:13px; color:var(--t3); font-style:italic; padding:8px 4px">No tasks yet</p>`;
}

function renderBoard(readOnly = false) {
  ["todo", "doing", "done"].forEach(status => {
    const col = document.getElementById(`col-${status}`);
    col.innerHTML = renderColumnContent(tasks.filter(t => t.status === status), readOnly);
  });
}

function renderCard(task, readOnly = false) {
  const label = { high: "High", medium: "Med", low: "Low" }[task.priority] || "Med";
  const now   = new Date();
  const dueDate = task.due_time ? new Date(task.due_time) : null;
  const isOverdue = dueDate && dueDate < now && task.status !== "done";

  let dueHtml = "";
  if (dueDate) {
    const isSameDay = dueDate.toDateString() === now.toDateString();
    const dueStr = isSameDay
      ? dueDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : dueDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    dueHtml = isOverdue
      ? `<p style="font-size:13px; font-weight:600; color:#f87171; margin-top:6px">⏰ Overdue · ${dueStr}</p>`
      : `<p style="font-size:13px; color:#38bdf8; margin-top:6px">⏰ Due ${dueStr}</p>`;
  }

  const carriedLabel = task.carried_over
    ? `<p style="font-size:11px; color:#818cf8; margin-top:4px">↩ from ${escHtml(task.carried_over_from || "prev shift")}</p>`
    : "";

  const overdueClass = isOverdue ? "task-overdue" : "";
  const carriedClass = task.carried_over ? "carried-in" : "";
  const clickAttr = !readOnly ? `onclick="openTaskModal('${task._id}')"` : `style="cursor:default"`;

  return `
    <div class="task-card priority-${task.priority} ${overdueClass} ${carriedClass}"
         data-id="${task._id}" ${clickAttr}>
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-bottom:4px">
        <p style="font-size:15px; font-weight:600; color:var(--t1); line-height:1.4; word-break:break-word; flex:1">
          ${escHtml(task.title)}
        </p>
        <span class="badge-${task.priority}"
          style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:5px; flex-shrink:0">
          ${label}
        </span>
      </div>
      ${carriedLabel}
      ${dueHtml}
      ${task.notes && task.notes.length
        ? `<p style="font-size:12px; color:var(--t3); margin-top:5px">${task.notes.length} note${task.notes.length > 1 ? "s" : ""}</p>`
        : ""}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// SORTABLE
// ═══════════════════════════════════════════════════════════════════════════

function initSortable() {
  sortables = ["todo", "doing", "done"].map(status =>
    Sortable.create(document.getElementById(`col-${status}`), {
      group: "tasks",
      animation: 180,
      ghostClass: "sortable-ghost",
      dragClass: "sortable-drag",
      filter: ".section-label",
      onMove: evt => !evt.related.classList.contains("section-label"),
      onEnd(evt) {
        const taskId = evt.item.dataset.id;
        const newStatus = evt.to.id.replace("col-", "");
        if (evt.from !== evt.to) updateTaskStatus(taskId, newStatus);
      },
    })
  );
}

function setSortableEnabled(enabled) { sortables.forEach(s => s.option("disabled", !enabled)); }

async function updateTaskStatus(taskId, status) {
  const res = await fetch(`/api/tasks/${taskId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const updated = await res.json();
  tasks = tasks.map(t => t._id === taskId ? updated : t);
  renderCalendar();
}

// ═══════════════════════════════════════════════════════════════════════════
// NEW TASK MODAL
// ═══════════════════════════════════════════════════════════════════════════

function openNewTaskModal(column) {
  if (!isViewingActive()) return;
  newTaskColumn = column;
  document.getElementById("new-task-title").value = "";
  document.getElementById("new-task-priority").value = "medium";
  document.getElementById("new-task-due").value = "";
  showModal("new-task-modal");
  setTimeout(() => document.getElementById("new-task-title").focus(), 50);
}
function closeNewTaskModal() { hideModal("new-task-modal"); }

async function confirmNewTask() {
  const title = document.getElementById("new-task-title").value.trim();
  if (!title) return;
  const priority = document.getElementById("new-task-priority").value;
  const dueRaw = document.getElementById("new-task-due").value;
  const due_time = dueRaw ? new Date(dueRaw).toISOString() : null;
  closeNewTaskModal();

  const res = await fetch("/api/tasks", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, priority, status: newTaskColumn, due_time,
      shift_id: viewingShift ? viewingShift._id : null }),
  });
  tasks.push(await res.json());
  renderBoard(false);
  renderCalendar();
}

// ═══════════════════════════════════════════════════════════════════════════
// TASK DETAIL MODAL
// ═══════════════════════════════════════════════════════════════════════════

function openTaskModal(taskId) {
  if (!isViewingActive()) return;
  currentTaskId = taskId;
  const task = tasks.find(t => t._id === taskId);
  if (!task) return;

  document.getElementById("modal-title").value = task.title;
  document.getElementById("modal-note-input").value = "";
  setModalPriority(task.priority, false);
  renderModalNotes(task.notes);

  const dueInput = document.getElementById("modal-due");
  if (task.due_time) {
    const d = new Date(task.due_time);
    dueInput.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  } else { dueInput.value = ""; }

  // Apply color-scheme for datetime picker
  const isDark = document.documentElement.classList.contains("dark");
  dueInput.style.colorScheme = isDark ? "dark" : "light";

  modalOrigTitle = task.title;
  modalOrigDue   = dueInput.value;
  resetSaveButton();
  showModal("task-modal");
}
function closeModal() { hideModal("task-modal"); currentTaskId = null; }

// ── Dirty tracking ───────────────────────────────────────────────────────────

function markModalDirty() {
  const isDirty = document.getElementById("modal-title").value !== modalOrigTitle
               || document.getElementById("modal-due").value   !== modalOrigDue;
  const btn = document.getElementById("modal-save");
  btn.disabled = !isDirty;
  btn.style.opacity = isDirty ? "1" : "0.4";
  btn.style.cursor  = isDirty ? "pointer" : "not-allowed";
}
function resetSaveButton() {
  const btn = document.getElementById("modal-save");
  btn.disabled = true; btn.style.opacity = "0.4"; btn.style.cursor = "not-allowed";
}

async function saveModalChanges() {
  if (!currentTaskId) return;
  const title  = document.getElementById("modal-title").value.trim();
  const dueRaw = document.getElementById("modal-due").value;
  const update = {};
  if (title) update.title = title;
  if (dueRaw !== modalOrigDue) update.due_time = dueRaw ? new Date(dueRaw).toISOString() : null;

  const res = await fetch(`/api/tasks/${currentTaskId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  const updated = await res.json();
  tasks = tasks.map(t => t._id === currentTaskId ? updated : t);

  // Refresh snapshot
  modalOrigTitle = updated.title;
  const d = updated.due_time ? new Date(updated.due_time) : null;
  modalOrigDue = d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16) : "";
  resetSaveButton();
  renderBoard(false);
  renderCalendar();
}

function clearModalDue() {
  document.getElementById("modal-due").value = "";
  markModalDirty();
}

// ── Modal helpers ─────────────────────────────────────────────────────────────

function renderModalNotes(notes) {
  const el = document.getElementById("modal-notes");
  if (!notes || !notes.length) {
    el.innerHTML = `<p style="font-size:14px; color:var(--t3); font-style:italic">No notes yet.</p>`;
    return;
  }
  el.innerHTML = notes.slice().reverse().map(n => `
    <div style="background:var(--input-bg); border-radius:10px; padding:12px 14px; border:1px solid var(--br)">
      <p style="font-size:12px; color:var(--t3); margin-bottom:4px">${formatTimestamp(n.timestamp)}</p>
      <p style="font-size:14px; color:var(--t1); white-space:pre-wrap">${escHtml(n.content)}</p>
    </div>`).join("");
}

function setModalPriority(priority, persist = true) {
  document.querySelectorAll(".priority-btn").forEach(btn => {
    btn.style.outline = btn.dataset.p === priority ? "2px solid white" : "none";
    btn.style.outlineOffset = "2px";
  });
  if (persist && currentTaskId) {
    fetch(`/api/tasks/${currentTaskId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority }),
    }).then(r => r.json()).then(updated => {
      tasks = tasks.map(t => t._id === currentTaskId ? updated : t);
      renderBoard(false);
    });
  }
}

async function submitNote() {
  const input   = document.getElementById("modal-note-input");
  const content = input.value.trim();
  if (!content || !currentTaskId) return;
  const res = await fetch(`/api/tasks/${currentTaskId}/notes`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const updated = await res.json();
  tasks = tasks.map(t => t._id === currentTaskId ? updated : t);
  input.value = "";
  input.style.height = "auto";
  renderModalNotes(updated.notes);
  renderBoard(false);
}

async function deleteCurrentTask() {
  if (!currentTaskId) return;
  if (!await showConfirm("Delete this task?", "Delete")) return;
  await fetch(`/api/tasks/${currentTaskId}`, { method: "DELETE" });
  tasks = tasks.filter(t => t._id !== currentTaskId);
  closeModal();
  renderBoard(false);
  renderCalendar();
}

// ═══════════════════════════════════════════════════════════════════════════
// CALENDAR + LAYOUT ANIMATION
// ═══════════════════════════════════════════════════════════════════════════

function toggleCalendar() {
  calendarOpen = !calendarOpen;
  const panel = document.getElementById("calendar-panel");
  const btn   = document.getElementById("cal-float-btn");
  panel.classList.toggle("open", calendarOpen);
  btn.classList.toggle("active", calendarOpen);
  if (calendarOpen) renderCalendar();
}

function prevMonth() { calMonth.setMonth(calMonth.getMonth() - 1); renderCalendar(); }
function nextMonth() { calMonth.setMonth(calMonth.getMonth() + 1); renderCalendar(); }

function renderCalendar() {
  if (!calendarOpen) return;

  document.getElementById("cal-month-label").textContent =
    calMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const year  = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const today = new Date();

  // Build task-per-day map
  const tasksByDay = {};
  tasks.forEach(t => {
    if (!t.due_time) return;
    const d = new Date(t.due_time);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!tasksByDay[key]) tasksByDay[key] = [];
    tasksByDay[key].push(t);
  });

  // Build cell array: Mon-based grid
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const monFirst = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev  = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = 0; i < monFirst; i++)
    cells.push({ d: new Date(year, month-1, daysInPrev - monFirst + i + 1), other: true });
  for (let i = 1; i <= daysInMonth; i++)
    cells.push({ d: new Date(year, month, i), other: false });
  const trailing = (7 - (cells.length % 7)) % 7;
  for (let i = 1; i <= trailing; i++)
    cells.push({ d: new Date(year, month+1, i), other: true });

  const grid = document.getElementById("cal-grid");
  grid.innerHTML = cells.map(cell => {
    const key   = `${cell.d.getFullYear()}-${cell.d.getMonth()}-${cell.d.getDate()}`;
    const dayTasks = tasksByDay[key] || [];
    const count = dayTasks.length;
    const isToday = cell.d.toDateString() === today.toDateString();

    const heat = count === 0 ? "transparent"
               : count === 1 ? "rgba(99,102,241,0.25)"
               : count === 2 ? "rgba(99,102,241,0.55)"
               :               "rgba(99,102,241,0.85)";
    const textColor = count >= 3 ? "#fff" : "var(--t1)";
    const tooltip   = dayTasks.length ? `data-tooltip="${escHtml(dayTasks.map(t => t.title).join("\n"))}"` : "";
    const todayStyle = isToday ? "box-shadow:0 0 0 2px #6366f1;" : "";

    return `
      <div class="cal-cell ${cell.other ? "cal-other-month" : ""} ${count ? "has-tasks" : ""}"
           style="background:${heat}; color:${textColor}; ${todayStyle}"
           ${tooltip}
           onmouseenter="showCalTooltip(event,this)" onmouseleave="hideCalTooltip()">
        <span style="font-weight:${isToday ? '700' : '500'}; color:${isToday ? '#818cf8' : 'inherit'}">${cell.d.getDate()}</span>
        ${count ? `<span style="font-size:10px; margin-top:2px; opacity:0.85">${count}</span>` : ""}
      </div>`;
  }).join("");
}

function showCalTooltip(event, el) {
  const raw = el.dataset.tooltip;
  if (!raw) return;
  const tip = document.getElementById("cal-tooltip");
  tip.innerHTML = raw.split("\n").map(l => `<div style="padding:2px 0">• ${escHtml(l)}</div>`).join("");
  tip.style.display = "block";
  _positionTooltip(event.clientX, event.clientY, tip);
}
function hideCalTooltip() {
  document.getElementById("cal-tooltip").style.display = "none";
}
function _positionTooltip(x, y, tip) {
  tip.style.left = Math.min(x + 12, window.innerWidth  - 260) + "px";
  tip.style.top  = Math.min(y - 10, window.innerHeight - 160) + "px";
}
document.addEventListener("mousemove", e => {
  const tip = document.getElementById("cal-tooltip");
  if (tip && tip.style.display !== "none") _positionTooltip(e.clientX, e.clientY, tip);
});

// ═══════════════════════════════════════════════════════════════════════════
// KEYBOARD
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  closeModal();
  closeStartModal();
  closeEndModal();
  closeNewTaskModal();
  resolveConfirm(false);
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function formatTimestamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
}

// ─── Init ────────────────────────────────────────────────────────────────────
boot();
