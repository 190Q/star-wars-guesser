import os
import re
import random
import subprocess
import base64
import json
import threading
from collections import deque
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder=".")
CORS(app)

MOVIES_DIR = os.environ["MOVIES_DIR"]
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frames_cache")
INDEX_FILE = os.path.join(CACHE_DIR, "index.json")
SEEN_FILE = os.path.join(CACHE_DIR, "seen.json")

EPISODE_NAMES = {
    "I":   "The Phantom Menace",
    "II":  "Attack of the Clones",
    "III": "Revenge of the Sith",
    "IV":  "A New Hope",
    "V":   "The Empire Strikes Back",
    "VI":  "Return of the Jedi",
}

FFMPEG  = os.environ["FFMPEG"]
FFPROBE = os.environ["FFPROBE"]

NUM_WORKERS = 3
SEGMENT_STEP = 1
MAX_CACHE_SIZE = 10000  # maximum number of frames to keep on disk

_movies_cache = None
_duration_cache = {}

# Cache state
_cache_index = []        # [{episode, title, label, timestamp, file}, ...]
_cache_lock = threading.Lock()
_cached_files = set()    # filenames already on disk
_served_files = set()  # every frame ever shown
_ready_event = threading.Event()



def get_video_duration(filepath):
    if filepath in _duration_cache:
        return _duration_cache[filepath]
    result = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration",
         "-of", "json", filepath],
        capture_output=True, text=True,
    )
    dur = float(json.loads(result.stdout)["format"]["duration"])
    _duration_cache[filepath] = dur
    return dur

def extract_frame_to_file(filepath, timestamp, out_path):
    """Extract a single JPEG frame directly to out_path. Returns True on success."""
    subprocess.run(
        [FFMPEG, "-y", "-ss", str(timestamp), "-i", filepath,
         "-frames:v", "1", "-an", "-sn",
         "-vf", "scale=960:-1", "-q:v", "4", out_path],
        capture_output=True,
    )
    return os.path.exists(out_path) and os.path.getsize(out_path) > 0

def scan_movies():
    global _movies_cache
    if _movies_cache is not None:
        return _movies_cache
    movies = []
    pattern = re.compile(r"Star Wars Episode ([IVX]+) - (.+)", re.IGNORECASE)
    for folder in os.scandir(MOVIES_DIR):
        if not folder.is_dir():
            continue
        match = pattern.match(folder.name)
        if not match:
            continue
        episode_num = match.group(1).upper()
        movie_title = match.group(2).strip()
        for entry in os.scandir(folder.path):
            if entry.is_file() and os.path.splitext(entry.name)[1].lower() in (".mp4", ".mkv"):
                movies.append({
                    "episode": episode_num,
                    "title": movie_title,
                    "path": entry.path,
                    "label": f"Episode {episode_num} - {movie_title}",
                })
                break
    movies.sort(key=lambda m: list(EPISODE_NAMES.keys()).index(m["episode"])
                if m["episode"] in EPISODE_NAMES else 99)
    _movies_cache = movies
    return movies

def _load_cache():
    """Load existing cached frames and seen-set from disk."""
    global _served_files
    os.makedirs(CACHE_DIR, exist_ok=True)
    if os.path.exists(INDEX_FILE):
        with open(INDEX_FILE, "r") as f:
            entries = json.load(f)
        for entry in entries:
            fpath = os.path.join(CACHE_DIR, entry["file"])
            # Skip if file missing or already added
            if os.path.exists(fpath) and entry["file"] not in _cached_files:
                _cache_index.append(entry)
                _cached_files.add(entry["file"])
        if _cache_index:
            _ready_event.set()
    if os.path.exists(SEEN_FILE):
        with open(SEEN_FILE, "r") as f:
            _served_files = set(json.load(f))
    # Drop any seen entries that no longer exist in the index
    _served_files &= _cached_files
    print(f"[cache] {len(_cache_index)} frames cached, {len(_served_files)} already seen.")

def _save_index():
    with open(INDEX_FILE, "w") as f:
        json.dump(_cache_index, f)

def _save_seen():
    with open(SEEN_FILE, "w") as f:
        json.dump(list(_served_files), f)

def _cache_worker(targets):
    """Extract frames for the given (movie, timestamp, filename) targets."""
    for movie, timestamp, fname in targets:
        with _cache_lock:
            if len(_cache_index) >= MAX_CACHE_SIZE:
                break
        out_path = os.path.join(CACHE_DIR, fname)
        if not extract_frame_to_file(movie["path"], timestamp, out_path):
            continue
        entry = {
            "episode": movie["episode"],
            "title": movie["title"],
            "label": movie["label"],
            "timestamp": round(timestamp),
            "file": fname,
        }
        with _cache_lock:
            if len(_cache_index) >= MAX_CACHE_SIZE:
                break
            _cache_index.append(entry)
            _cached_files.add(fname)
            _ready_event.set()
            # Save index every 10 frames
            if len(_cache_index) % 10 == 0:
                _save_index()
                print(f"[cache] {len(_cache_index)} frames cached.")
    # Final save
    with _cache_lock:
        _save_index()

def _start_cache_build():
    """Build list of frames to extract and split across workers."""
    movies = scan_movies()
    targets = []
    for movie in movies:
        try:
            duration = get_video_duration(movie["path"])
        except Exception:
            continue
        margin = min(300, duration * 0.1)
        t = margin
        while t < duration - margin:
            fname = f"{movie['episode']}_{int(t)}.jpg"
            if fname not in _cached_files:
                targets.append((movie, t, fname))
            t += SEGMENT_STEP
    random.shuffle(targets)
    # Trim targets so the total cache never exceeds MAX_CACHE_SIZE
    with _cache_lock:
        already_cached = len(_cache_index)
    remaining = max(0, MAX_CACHE_SIZE - already_cached)
    targets = targets[:remaining]
    if not targets:
        print("[cache] All frames already cached (limit reached).")
        return
    print(f"[cache] {len(targets)} frames to extract ({already_cached} already cached, limit {MAX_CACHE_SIZE}).")
    # Split targets across workers
    chunk_size = (len(targets) + NUM_WORKERS - 1) // NUM_WORKERS
    for i in range(NUM_WORKERS):
        chunk = targets[i * chunk_size : (i + 1) * chunk_size]
        if chunk:
            threading.Thread(target=_cache_worker, args=(chunk,), daemon=True).start()

# ── routes ───────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(".", "index.html")

@app.route("/api/movies")
def api_movies():
    movies = scan_movies()
    return jsonify([{"episode": m["episode"], "title": m["title"], "label": m["label"]} for m in movies])

@app.route("/api/random-frame")
def api_random_frame():
    _ready_event.wait(timeout=30)
    with _cache_lock:
        n = len(_cache_index)
        if n == 0:
            return jsonify({"error": "No frames available yet"}), 503
        available = [i for i in range(n) if _cache_index[i]["file"] not in _served_files]
        if not available:
            print("[cache] All frames seen - cycling back to the start.")
            _served_files.clear()
            _save_seen()
            available = list(range(n))
        idx = random.choice(available)
        entry = _cache_index[idx]
        _served_files.add(entry["file"])
        _save_seen()
    # Read JPEG from disk (fast)
    with open(os.path.join(CACHE_DIR, entry["file"]), "rb") as f:
        frame_b64 = base64.b64encode(f.read()).decode("utf-8")

    return jsonify({
        "episode": entry["episode"],
        "title": entry["title"],
        "label": entry["label"],
        "timestamp": entry["timestamp"],
        "frame": frame_b64,
    })

@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(".", filename)


_load_cache()
threading.Thread(target=_start_cache_build, daemon=True).start()

app.run(host="127.0.0.1", port=5000, debug=False)
