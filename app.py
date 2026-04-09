from flask import Flask, jsonify, request, render_template
from pymongo import MongoClient
from bson import ObjectId
from datetime import datetime, timezone
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

client = MongoClient(os.environ.get("MONGO_URI"))
db = client["slick"]
shifts_col = db["shifts"]
tasks_col = db["tasks"]


def serialize(doc):
    doc["_id"] = str(doc["_id"])
    if "shift_id" in doc and isinstance(doc["shift_id"], ObjectId):
        doc["shift_id"] = str(doc["shift_id"])
    return doc


# ─── Pages ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


# ─── Shifts ───────────────────────────────────────────────────────────────────

@app.route("/api/shifts/active")
def get_active_shift():
    shift = shifts_col.find_one({"status": "active"})
    return jsonify(serialize(shift) if shift else None)


@app.route("/api/shifts")
def get_shifts():
    """Last 6 ended shifts for the timeline (newest first)."""
    shifts = list(shifts_col.find({"status": "ended"}).sort("ended_at", -1).limit(6))
    return jsonify([serialize(s) for s in shifts])


@app.route("/api/shifts/start", methods=["POST"])
def start_shift():
    data = request.json or {}

    # End any currently active shift (safety — shouldn't normally be one if
    # the user properly hit End Shift first, but guard against edge cases)
    shifts_col.update_many(
        {"status": "active"},
        {"$set": {"status": "ended", "ended_at": datetime.now(timezone.utc)}}
    )

    # Find the most recently ended shift to carry tasks from
    prev_shift = shifts_col.find_one({"status": "ended"}, sort=[("ended_at", -1)])

    now = datetime.now(timezone.utc)
    shift = {
        "on_call_person": data.get("on_call_person", ""),
        "started_at": now,
        "ended_at": None,
        "end_handover_notes": "",
        "status": "active",
    }
    result = shifts_col.insert_one(shift)
    new_shift_id = result.inserted_id

    # Carry over only incomplete tasks (todo / doing) from the previous shift
    prev_tasks = []
    if prev_shift:
        prev_tasks = list(tasks_col.find({
            "shift_id": prev_shift["_id"],
            "status": {"$in": ["todo", "doing"]},
        }))
        for task in prev_tasks:
            tasks_col.insert_one({
                "shift_id": new_shift_id,
                "title": task["title"],
                "status": task["status"],
                "priority": task["priority"],
                "due_time": task.get("due_time"),
                "notes": task.get("notes", []),
                "created_at": now,
                "updated_at": now,
                "carried_over": True,
                "carried_over_from": task.get("carried_over_from") or prev_shift.get("on_call_person", ""),
            })

    shift["_id"] = str(new_shift_id)
    shift["carried_over_count"] = len(prev_tasks)

    # Pass previous shift's handover notes so the frontend can show the banner
    if prev_shift:
        shift["prev_handover_notes"] = prev_shift.get("end_handover_notes", "")
        shift["prev_on_call_person"] = prev_shift.get("on_call_person", "")

    return jsonify(shift), 201


@app.route("/api/shifts/end", methods=["POST"])
def end_shift():
    data = request.json or {}
    shift = shifts_col.find_one_and_update(
        {"status": "active"},
        {"$set": {
            "status": "ended",
            "ended_at": datetime.now(timezone.utc),
            "end_handover_notes": data.get("end_handover_notes", ""),
        }},
        return_document=True,
    )
    if shift:
        return jsonify(serialize(shift))
    return jsonify({"error": "No active shift"}), 404


# ─── Tasks ────────────────────────────────────────────────────────────────────

@app.route("/api/tasks")
def get_tasks():
    shift_id = request.args.get("shift_id")
    if shift_id:
        # Timeline view: fetch tasks for a specific past shift
        try:
            tasks = list(tasks_col.find({"shift_id": ObjectId(shift_id)}))
        except Exception:
            return jsonify([])
    else:
        shift = shifts_col.find_one({"status": "active"})
        if not shift:
            return jsonify([])
        tasks = list(tasks_col.find({"shift_id": shift["_id"]}))
    return jsonify([serialize(t) for t in tasks])


@app.route("/api/tasks", methods=["POST"])
def create_task():
    data = request.json or {}
    shift = shifts_col.find_one({"status": "active"})
    if not shift:
        return jsonify({"error": "No active shift"}), 400
    now = datetime.now(timezone.utc)
    task = {
        "shift_id": shift["_id"],
        "title": data.get("title", "Untitled task"),
        "status": data.get("status", "todo"),
        "priority": data.get("priority", "medium"),
        "due_time": data.get("due_time") or None,
        "notes": [],
        "created_at": now,
        "updated_at": now,
        "carried_over": False,
    }
    result = tasks_col.insert_one(task)
    task["_id"] = str(result.inserted_id)
    task["shift_id"] = str(task["shift_id"])
    return jsonify(task), 201


@app.route("/api/tasks/<task_id>", methods=["PUT"])
def update_task(task_id):
    data = request.json or {}
    allowed = {"status", "priority", "title", "due_time"}
    update = {k: v for k, v in data.items() if k in allowed}
    update["updated_at"] = datetime.now(timezone.utc)
    task = tasks_col.find_one_and_update(
        {"_id": ObjectId(task_id)},
        {"$set": update},
        return_document=True,
    )
    if task:
        return jsonify(serialize(task))
    return jsonify({"error": "Task not found"}), 404


@app.route("/api/tasks/<task_id>/notes", methods=["POST"])
def add_note(task_id):
    data = request.json or {}
    note = {
        "content": data.get("content", ""),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    task = tasks_col.find_one_and_update(
        {"_id": ObjectId(task_id)},
        {"$push": {"notes": note}, "$set": {"updated_at": datetime.now(timezone.utc)}},
        return_document=True,
    )
    if task:
        return jsonify(serialize(task))
    return jsonify({"error": "Task not found"}), 404


@app.route("/api/tasks/<task_id>", methods=["DELETE"])
def delete_task(task_id):
    tasks_col.delete_one({"_id": ObjectId(task_id)})
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(debug=True)
