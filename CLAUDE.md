# SLICK — Project Context for Claude Code

## What this is

SLICK is a web-based on-call handover tool. It replaces ad-hoc Slack threads with a structured per-shift Scrum board. Each person on call gets a To-Do / Doing / Done board, leaves handover notes when they finish, and the next person's incomplete tasks carry over automatically.

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
    _header.html                Logo, shift timeline pills, theme toggle, shift actions
    _banners.html               Handover banner + view-mode banner
    _board.html                 Three Scrum columns (board-wrap + col-todo/doing/done)
    _calendar.html              Floating 📅 button (bottom-right) + fixed calendar panel
    _modals.html                Five modals: task detail, start shift, end shift, new task, confirm
static/
  css/style.css                 All styles; :root (light) and html.dark override variables
  js/main.js                    All frontend logic (~750 lines)
```

## MongoDB

Database: `slick`. Two collections:

- `shifts` — one document per shift; fields: `on_call_person`, `started_at`, `ended_at`, `end_handover_notes`, `status` (`active` | `ended`)
- `tasks` — fields: `shift_id`, `title`, `status` (`todo`|`doing`|`done`), `priority` (`high`|`medium`|`low`), `due_time` (ISO string or null), `notes[]`, `carried_over` (bool), `carried_over_from` (string), `created_at`, `updated_at`

## Key behaviours

**Shift lifecycle**
- Only one shift can be `active` at a time.
- **End Shift** stores `end_handover_notes` on the shift document, marks it `ended`.
- **Start Shift** looks for the most recently ended shift, copies its `todo` and `done` tasks into the new shift with `carried_over: True` and `carried_over_from: <name>`. Done tasks are NOT carried over.
- The previous shift's `end_handover_notes` are returned in the start-shift API response so the frontend can show the yellow banner.

**Task carry-over**
- Only `todo` and `doing` tasks carry over — intentional, done tasks stay on the old shift.
- Carried-over tasks show "↩ carried over from Alice" in indigo on the card.

**Timeline**
- `GET /api/shifts` returns the last 6 **ended** shifts, newest first.
- The frontend reverses the array so oldest is leftmost, newest is rightmost.
- Clicking a pill calls `viewShift()` which fetches that shift's tasks via `GET /api/tasks?shift_id=<id>` and renders the board read-only. SortableJS is disabled in view mode.

**Calendar**
- Floating fixed panel, bottom-right corner (`#cal-float-btn` + `#calendar-panel`).
- Renders a monthly grid. Days with due tasks get an indigo heat colour (opacity scales with count).
- Hover tooltip shows task titles for that day.
- The calendar reflects whichever tasks are currently loaded (live shift or viewed shift).

**Theme**
- Light is the default. `html.dark` class is toggled; CSS vars swap.
- Preference persisted to `localStorage` key `slick-theme`.
- The `applyTheme()` function also sets `color-scheme` on datetime inputs.

**Modal dirty tracking**
- The task detail modal has a single **Save** button for title + due time changes.
- It starts disabled (`opacity: 0.4`). `markModalDirty()` is wired to `oninput` on both fields.
- On save, the snapshot (`modalOrigTitle`, `modalOrigDue`) is refreshed and button resets to disabled.
- Priority auto-saves immediately on button click (no Save required).

**Column subsections**
- Within each column, tasks are grouped into labelled sections: Overdue / Due Today / Within 3 Days / This Week / Later / No due date.
- Section labels have class `section-label` and `pointer-events: none`.
- SortableJS uses `filter: '.section-label'` to skip them during drag.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGO_URI` | Yes | MongoDB connection string (Atlas or local) |
| `WEBSITES_PORT` | Azure only | Must be `5000` so Azure routes traffic correctly |

## What NOT to change without understanding

- The `start_shift` route looks for `status: "ended"` (not `"active"`) when finding the previous shift — this is intentional because the user ends their shift before the next person starts.
- `formatTimestamp` guards with `isNaN(d.getTime())` — old notes stored with Python's `datetime.isoformat()` including `+00:00` offset parse fine, but null/missing timestamps must not render "Invalid Date".
- The board columns use CSS `flex: 1; height: 100%` — do not add `overflow: visible` or the column scroll breaks.
