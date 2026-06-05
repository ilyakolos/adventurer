from flask import Flask, render_template, request, jsonify, send_from_directory
import sqlite3, os, uuid, urllib.request, json
from datetime import datetime

app = Flask(
    __name__,
    static_folder="static",
    template_folder="templates"
)
DB = "traveler.db"
UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

@app.route("/")
def home():
    return render_template("index.html")

# ← Встав сюди свій ключ з openweathermap.org
WEATHER_API_KEY = "44107aeb2d533980aab680c1abfd1dff"

def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS pins (
            id       TEXT PRIMARY KEY,
            lat      REAL, lng REAL,
            title    TEXT,
            note     TEXT,
            color    TEXT DEFAULT '#00f5ff',
            created  TEXT
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS photos (
            id       TEXT PRIMARY KEY,
            pin_id   TEXT,
            filename TEXT,
            caption  TEXT
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS routes (
            id       TEXT PRIMARY KEY,
            name     TEXT,
            color    TEXT DEFAULT '#00f5ff',
            created  TEXT
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS route_pins (
            route_id TEXT,
            pin_id   TEXT,
            order_n  INTEGER
        )""")
        conn.commit()

# ── PINS ─────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/gallery")
def gallery():
    return render_template("gallery.html")

@app.route("/api/pins", methods=["GET"])
def get_pins():
    with get_db() as conn:
        pins = [dict(r) for r in conn.execute("SELECT * FROM pins ORDER BY created DESC")]
        for p in pins:
            photos = conn.execute("SELECT * FROM photos WHERE pin_id=?", (p["id"],)).fetchall()
            p["photos"] = [dict(ph) for ph in photos]
    return jsonify(pins)

@app.route("/api/pins", methods=["POST"])
def add_pin():
    d = request.json
    pid = str(uuid.uuid4())[:8]
    with get_db() as conn:
        conn.execute("INSERT INTO pins VALUES (?,?,?,?,?,?,?)",
            (pid, d["lat"], d["lng"], d.get("title","Нова точка"),
             d.get("note",""), d.get("color","#00f5ff"),
             datetime.now().strftime("%Y-%m-%d %H:%M")))
        conn.commit()
    return jsonify({"id": pid})

@app.route("/api/pins/<pid>", methods=["PUT"])
def update_pin(pid):
    d = request.json
    with get_db() as conn:
        conn.execute("UPDATE pins SET title=?, note=?, color=? WHERE id=?",
            (d.get("title"), d.get("note"), d.get("color"), pid))
        conn.commit()
    return jsonify({"ok": True})

@app.route("/api/pins/<pid>", methods=["DELETE"])
def delete_pin(pid):
    with get_db() as conn:
        conn.execute("DELETE FROM photos WHERE pin_id=?", (pid,))
        conn.execute("DELETE FROM route_pins WHERE pin_id=?", (pid,))
        conn.execute("DELETE FROM pins WHERE id=?", (pid,))
        conn.commit()
    return jsonify({"ok": True})

# ── PHOTOS ────────────────────────────────────────────────────
@app.route("/api/pins/<pid>/photos", methods=["POST"])
def add_photo(pid):
    file = request.files.get("photo")
    caption = request.form.get("caption", "")
    if not file:
        return jsonify({"error": "no file"}), 400
    fid = str(uuid.uuid4())[:8]
    ext = file.filename.rsplit(".", 1)[-1].lower()
    fname = f"{fid}.{ext}"
    file.save(os.path.join(UPLOAD_FOLDER, fname))
    with get_db() as conn:
        conn.execute("INSERT INTO photos VALUES (?,?,?,?)", (fid, pid, fname, caption))
        conn.commit()
    return jsonify({"id": fid, "filename": fname})

@app.route("/api/photos/<fid>", methods=["DELETE"])
def delete_photo(fid):
    with get_db() as conn:
        row = conn.execute("SELECT filename FROM photos WHERE id=?", (fid,)).fetchone()
        if row:
            try: os.remove(os.path.join(UPLOAD_FOLDER, row["filename"]))
            except: pass
        conn.execute("DELETE FROM photos WHERE id=?", (fid,))
        conn.commit()
    return jsonify({"ok": True})

@app.route("/api/all-photos")
def all_photos():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT ph.id, ph.filename, ph.caption, p.title as pin_title, p.color
            FROM photos ph JOIN pins p ON ph.pin_id = p.id
            ORDER BY ph.rowid DESC
        """).fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/uploads/<filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

# ── WEATHER ───────────────────────────────────────────────────
@app.route("/api/weather")
def weather():
    lat = request.args.get("lat")
    lng = request.args.get("lng")
    if not lat or not lng:
        return jsonify({"error": "no coords"}), 400
    if WEATHER_API_KEY == "YOUR_API_KEY_HERE":
        return jsonify({"error": "no key", "mock": True,
                        "temp": 18, "feels": 16, "desc": "Ясно", "icon": "01d", "humidity": 55, "wind": 3.2})
    try:
        url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lng}&appid={WEATHER_API_KEY}&units=metric&lang=uk"
        with urllib.request.urlopen(url, timeout=5) as r:
            data = json.loads(r.read())
        return jsonify({
            "temp":     round(data["main"]["temp"]),
            "feels":    round(data["main"]["feels_like"]),
            "desc":     data["weather"][0]["description"],
            "icon":     data["weather"][0]["icon"],
            "humidity": data["main"]["humidity"],
            "wind":     data["wind"]["speed"],
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── SEARCH ────────────────────────────────────────────────────
@app.route("/api/search")
def search_place():
    q = request.args.get("q", "")
    if not q:
        return jsonify([])
    try:
        url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(q)}&format=json&limit=5"
        req = urllib.request.Request(url, headers={"User-Agent": "WANDR/1.0"})
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read())
        return jsonify([{"name": d["display_name"], "lat": float(d["lat"]), "lng": float(d["lon"])} for d in data])
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── ROUTES ────────────────────────────────────────────────────
@app.route("/api/routes", methods=["GET"])
def get_routes():
    with get_db() as conn:
        routes = [dict(r) for r in conn.execute("SELECT * FROM routes ORDER BY created DESC")]
        for route in routes:
            rps = conn.execute(
                "SELECT p.* FROM pins p JOIN route_pins rp ON p.id=rp.pin_id WHERE rp.route_id=? ORDER BY rp.order_n",
                (route["id"],)
            ).fetchall()
            route["pins"] = [dict(p) for p in rps]
    return jsonify(routes)

@app.route("/api/routes", methods=["POST"])
def add_route():
    d = request.json
    rid = str(uuid.uuid4())[:8]
    with get_db() as conn:
        conn.execute("INSERT INTO routes VALUES (?,?,?,?)",
            (rid, d.get("name","Новий маршрут"), d.get("color","#00f5ff"),
             datetime.now().strftime("%Y-%m-%d %H:%M")))
        for i, pid in enumerate(d.get("pin_ids", [])):
            conn.execute("INSERT INTO route_pins VALUES (?,?,?)", (rid, pid, i))
        conn.commit()
    return jsonify({"id": rid})

@app.route("/api/routes/<rid>", methods=["DELETE"])
def delete_route(rid):
    with get_db() as conn:
        conn.execute("DELETE FROM route_pins WHERE route_id=?", (rid,))
        conn.execute("DELETE FROM routes WHERE id=?", (rid,))
        conn.commit()
    return jsonify({"ok": True})

import urllib.parse

if __name__ == "__main__":
    init_db()
    app.run(debug=True)