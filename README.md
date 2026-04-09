# SLICK — On-Call Handover Board

A lightweight on-call handover tool built around a Scrum-style board (To-Do / Doing / Done) per shift. Tasks carry over between shifts, support due dates, timestamped notes, and priority levels. Includes a shift timeline, heatmap calendar, and light/dark mode.

---

## Features

- **Scrum board** — three columns per shift with drag-and-drop
- **Task grouping** — cards grouped by due date (Overdue / Today / Within 3 days / This week / Later)
- **Due time** — overdue tasks highlight red; same-day shows time, future shows date
- **Notes** — timestamped notes per task
- **Priority** — High / Medium / Low with colour-coded badges
- **Shift carry-over** — incomplete tasks copy to the next shift with "↩ carried from Alice" label
- **Handover notes** — left when ending a shift; shown to the next person as a dismissible banner
- **Shift timeline** — last 6 ended shifts in the navbar; click any to view their frozen board
- **Calendar heatmap** — floating bottom-right calendar with task due-date density; hover to preview tasks
- **Light / dark mode** — toggle in the header, persisted via localStorage

---

## Stack

| Layer    | Tech                                              |
|----------|---------------------------------------------------|
| Backend  | Python 3.12, Flask, Gunicorn                      |
| Database | MongoDB (PyMongo)                                 |
| Frontend | Vanilla JS, CSS variables, SortableJS CDN         |
| Deploy   | Docker → Azure Container Registry → Azure Web App |

---

## Local Setup

### Prerequisites

- Python 3.12+
- MongoDB (local or Atlas)

### Install

```bash
git clone <repo-url>
cd ICEYE
pip install -r requirements.txt
```

### Environment

Create `.env` in the project root:

```env
MONGO_URI=mongodb://localhost:27017
```

### Run

```bash
python app.py
```

Open [http://localhost:5000](http://localhost:5000).

---

## Docker

### Build and run locally

```bash
docker build -t slick .
docker run -p 5000:5000 -e MONGO_URI="mongodb://host.docker.internal:27017" slick
```

---

## Deployment — Azure Web App (Container)

### Azure Prerequisites

- Azure CLI installed and logged in (`az login`)
- An Azure Container Registry (ACR)
- An Azure Web App configured for Docker containers

### One-time Azure setup

```bash
# Create resource group
az group create --name slick-rg --location northeurope

# Create Azure Container Registry
az acr create --resource-group slick-rg --name <your-acr-name> --sku Basic --admin-enabled true

# Create App Service plan (Linux)
az appservice plan create --name slick-plan --resource-group slick-rg --is-linux --sku B1

# Create Web App
az webapp create \
  --resource-group slick-rg \
  --plan slick-plan \
  --name <your-app-name> \
  --deployment-container-image-name <your-acr-name>.azurecr.io/slick:latest
```

### Set environment variables on Azure

```bash
az webapp config appsettings set \
  --resource-group slick-rg \
  --name <your-app-name> \
  --settings \
    MONGO_URI="<your-mongodb-atlas-connection-string>" \
    WEBSITES_PORT=5000
```

### CI/CD via GitHub Actions

Add the following secrets to your GitHub repository (**Settings → Secrets and variables → Actions**):

| Secret | Value |
|--------|-------|
| `ACR_LOGIN_SERVER` | `<your-acr-name>.azurecr.io` |
| `ACR_USERNAME` | ACR admin username (Azure Portal → ACR → Access keys) |
| `ACR_PASSWORD` | ACR admin password |
| `AZURE_WEBAPP_NAME` | Your Web App name |
| `AZURE_WEBAPP_PUBLISH_PROFILE` | Publish profile XML (download from Azure Portal → Web App → Get publish profile) |

Every push to `main` will build the Docker image, push to ACR, and deploy automatically.

---

## Project Structure

```text
ICEYE/
├── app.py                        # Flask app + all API routes
├── requirements.txt
├── Dockerfile
├── .dockerignore
├── .env                          # Not committed — set MONGO_URI here
├── README.md
├── CLAUDE.md                     # Project context for Claude Code
├── .github/
│   └── workflows/
│       └── azure-deploy.yml      # CI/CD pipeline
├── templates/
│   ├── index.html                # Main page (includes partials)
│   └── partials/
│       ├── _header.html
│       ├── _banners.html
│       ├── _board.html
│       ├── _calendar.html
│       └── _modals.html
└── static/
    ├── css/
    │   └── style.css
    └── js/
        └── main.js
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/shifts/active` | Get the currently active shift |
| GET | `/api/shifts` | Last 6 ended shifts (for timeline) |
| POST | `/api/shifts/start` | Start a new shift |
| POST | `/api/shifts/end` | End the active shift + store handover notes |
| GET | `/api/tasks` | Tasks for active shift (or `?shift_id=` for past) |
| POST | `/api/tasks` | Create a task |
| PUT | `/api/tasks/<id>` | Update title / status / priority / due_time |
| POST | `/api/tasks/<id>/notes` | Add a timestamped note |
| DELETE | `/api/tasks/<id>` | Delete a task |

---

## MongoDB Schema

### shifts

```json
{
  "on_call_person": "Alice",
  "started_at": "ISODate",
  "ended_at": "ISODate | null",
  "end_handover_notes": "string",
  "status": "active | ended"
}
```

### tasks

```json
{
  "shift_id": "ObjectId",
  "title": "string",
  "status": "todo | doing | done",
  "priority": "high | medium | low",
  "due_time": "ISODate | null",
  "notes": [{ "content": "string", "timestamp": "ISODate" }],
  "carried_over": true,
  "carried_over_from": "Alice",
  "created_at": "ISODate",
  "updated_at": "ISODate"
}
```
