# SLICK — Project Context for Claude Code

## What this is

SLICK is a web-based on-call handover tool. It replaces ad-hoc Slack threads with a structured per-shift Scrum board. Multiple people can be on-call simultaneously — each gets their own To-Do / Doing / Done board. Incomplete tasks carry over when a new shift starts. Ended shifts are browsable in a read-only timeline.

**Live:** [slick-iceye.azurewebsites.net](https://slick-iceye.azurewebsites.net/)
**Repo:** [Doug-Vo/ICEYE-SLICK](https://github.com/Doug-Vo/ICEYE-SLICK)

## Stack

- **Backend**: Python / Flask (`app.py`), MongoDB via PyMongo
- **Frontend**: Vanilla JS (`static/js/main.js`), custom CSS variables (`static/css/style.css`), SortableJS via CDN for drag-and-drop
- **Templates**: Jinja2 with `{% include %}` partials under `templates/partials/`
- **No build step** — Tailwind was removed; all styles are in `style.css` using CSS custom properties

## File map

```
app.py                          Flask routes + MongoDB logic
requirements.txt                flask, pymongo, python-dotenv, gunicorn
Dockerfile / .dockerignore      Container build
.github/workflows/azure-deploy.yml  CI/CD to Azure Web App via ACR
templates/
  index.html                    Thin shell — only includes partials
  partials/
    _header.html                Logo + GitHub pill, timeline pills, theme toggle, shift actions
    _banners.html               Handover banner + view-mode banner (no back button — pill-driven nav)
    _board.html                 Three Scrum columns (board-wrap + col-todo/doing/done)
    _calendar.html              Floating 📅 button (bottom-right) + fixed calendar panel
    _modals.html                Five modals: task detail, start shift, end shift, new task, confirm
static/
  css/style.css                 All styles; :root (light) and html.dark override variables
  js/main.js                    All frontend logic
```

## MongoDB

Database: `slick`. Two collections:

- `shifts` — one document per shift; fields: `on_call_person`, `started_at`, `ended_at`, `end_handover_notes`, `status` (`active` | `ended`)
- `tasks` — fields: `shift_id`, `title`, `status` (`todo`|`doing`|`done`), `priority` (`high`|`medium`|`low`), `due_time` (ISO string or null), `notes[]`, `carried_over` (bool), `carried_over_from` (string), `created_at`, `updated_at`

## Key behaviours

### Shift lifecycle — multi-shift

- **Multiple shifts can be `active` simultaneously** — one per on-call person.
- `GET /api/shifts/active` returns an **array** of all active shifts (sorted `started_at` ascending).
- **Start Shift** does NOT end other active shifts. It finds the most recently ended shift, copies its `todo`/`doing` tasks into the new shift with `carried_over: True`, and returns the previous shift's `end_handover_notes` for the banner.
- **End Shift** requires `shift_id` in the POST body — it only ends that specific shift. The frontend sends `viewingShift._id`.
- After ending, the frontend navigates to another active shift if one exists, otherwise shows the just-ended shift read-only.

### Task carry-over

- Only `todo` and `doing` tasks carry over — done tasks stay on the old shift for timeline integrity.
- `carried_over_from` preserves the **original** creator across multiple carry-overs (Newt→Alice→Bob still shows "from Newt").
- Carried-over tasks show "↩ from Alice" in indigo on the card.
- `POST /api/tasks` accepts an optional `shift_id` in the body — the frontend always sends it so tasks go to the correct person's shift.

### Navigation — all pill-driven

- The header timeline has two sections: **On-call** (green `● LIVE` pills) and **Completed** (coloured history pills), separated by a vertical divider.
- Clicking any pill calls `selectShift(shift)` — the single navigation function for both active and ended shifts.
- Active shifts → editable board, sortable enabled, no view-mode banner, "End Shift" visible.
- Ended shifts → read-only board, sortable disabled, view-mode banner shown, "End Shift" hidden.
- There is no "Back to live" button — click an On-call pill to return.
- On page load, `boot()` auto-selects `activeShifts[0]` (oldest active shift).

### Frontend state

- `activeShifts[]` — all currently active shift objects (from `/api/shifts/active`)
- `viewingShift` — the shift whose board is currently displayed (active or ended)
- `isViewingActive()` — returns true if `viewingShift._id` is in `activeShifts`; drives read/write mode everywhere
- `selectShift(shift)` — central nav: fetches tasks, toggles sortable, manages banners, re-renders timeline + actions
- `refreshShifts()` — fetches `/api/shifts/active`, updates `activeShifts`, re-renders shift actions

### Timeline

- `GET /api/shifts` returns the last 6 **ended** shifts, newest first.
- The frontend reverses the array so oldest is leftmost, newest is rightmost (within the Completed section).

### Handover banner

- Yellow/amber banner shown when there are handover notes from the previous shift.
- Theme-aware colours: dark mode uses amber; light mode uses dark brown on pale yellow.
- When viewing an active shift: shows the most recently ended shift's notes.
- When viewing a history shift: shows that shift's own `end_handover_notes`.
- `applyTheme()` calls `_paintBanner()` so the banner repaints immediately on theme toggle.

### Calendar

- Floating fixed panel, bottom-right corner (`#cal-float-btn` + `#calendar-panel`).
- Renders a monthly grid. Days with due tasks get an indigo heat colour (opacity scales with count).
- Hover tooltip shows task titles for that day.
- Reflects whichever tasks are currently loaded (any viewed shift).

### Theme

- Dark is the default. `html.dark` class is toggled; CSS vars swap.
- Preference persisted to `localStorage` key `slick-theme`.
- `applyTheme()` also sets `color-scheme` on datetime inputs and repaints the handover banner.

### Modal dirty tracking

- The task detail modal has a single **Save** button for title + due time changes.
- It starts disabled (`opacity: 0.4`). `markModalDirty()` is wired to `oninput` on both fields.
- On save, the snapshot (`modalOrigTitle`, `modalOrigDue`) is refreshed and button resets to disabled.
- Priority auto-saves immediately on button click (no Save required).
- Modal only opens when `isViewingActive()` — blocked in read-only history view.

### Column subsections

- Within each column, tasks are grouped into labelled sections: Overdue / Due Today / Within 3 Days / This Week / Later / No due date.
- Section labels have class `section-label` and `pointer-events: none`.
- SortableJS uses `filter: '.section-label'` to skip them during drag.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGO_URI` | Yes | MongoDB connection string (Atlas or local) |
| `WEBSITES_PORT` | Azure only | Must be `5000` so Azure routes traffic correctly |

## What NOT to change without understanding

- `GET /api/shifts/active` returns an **array**, not a single object — the frontend expects this.
- `POST /api/shifts/end` requires `shift_id` in the request body — it will 400 without it.
- `POST /api/tasks` should include `shift_id` in the body — without it, the backend falls back to `find_one({"status": "active"})` which is ambiguous when multiple shifts are active.
- `start_shift` looks for `status: "ended"` when finding the previous shift for carry-over — intentional, the previous person ends their shift before the new person starts.
- `formatTimestamp` guards with `isNaN(d.getTime())` — null/missing timestamps must not render "Invalid Date".
- The board columns use CSS `flex: 1; height: 100%` — do not add `overflow: visible` or the column scroll breaks.
- `carried_over_from` uses `task.get("carried_over_from") or prev_shift.get("on_call_person", "")` — the `or` is intentional to preserve the original creator across chains.
