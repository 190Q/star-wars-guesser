# Star Wars Frame Guesser

A local, browser-based quiz game that extracts random frames from your Star Wars film collection and challenges you to identify the correct episode. The backend is a lightweight Flask server that pre-caches JPEG frames from your video files using FFmpeg; the frontend is a pure HTML/CSS/JS interface with a retro terminal aesthetic.

---

## Features

- **Frame extraction** - FFmpeg extracts frames at every second across all six episodes, storing them in a local disk cache (up to 10 000 frames by default).
- **Multi-threaded caching** - Three worker threads build the cache in the background so the game is playable within seconds of launch.
- **Smart cycling** - Already-seen frames are tracked across sessions; once all frames have been shown, the seen-set resets automatically.
- **Prefetching** - The next frame is fetched in the background while you answer the current one, keeping transitions instant.
- **Magnifier** - Click and hold on a frame to activate a circular magnifier lens for closer inspection.
- **Progress bar** - A visual indicator shows roughly where in the film the frame was taken from.
- **Session & lifetime stats** - Correct answers, total guesses, accuracy, and streak are tracked both for the current session and persistently across sessions (via `localStorage`).

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Python 3.9+ | Any recent version works. |
| FFmpeg & FFprobe | Must be installed and their paths recorded. Download from [ffmpeg.org](https://ffmpeg.org/download.html). |
| Star Wars film files | `.mp4` or `.mkv` files, each inside a folder named exactly `Star Wars Episode <Roman numeral> - <Title>` (see below). |

### Expected folder structure

```
MOVIES_DIR/
├── Star Wars Episode I - The Phantom Menace/
│   └── film.mkv or film.mp4
├── Star Wars Episode II - Attack of the Clones/
│   └── film.mkv or film.mp4
├── Star Wars Episode III - Revenge of the Sith/
│   └── film.mkv or film.mp4
├── Star Wars Episode IV - A New Hope/
│   └── film.mkv or film.mp4
├── Star Wars Episode V - The Empire Strikes Back/
│   └── film.mkv or film.mp4
└── Star Wars Episode VI - Return of the Jedi/
    └── film.mkv or film.mp4
```

The scanner uses a regex match on the folder name, so the naming convention must be followed precisely (case-insensitive).

---

## Installation

1. **Clone the repository**

    ```bash
    git clone <repo-url>
    cd <repo-folder>
    ```

2. **Install Python dependencies**

    ```bash
    pip install flask flask-cors python-dotenv
    ```

3. **Configure environment variables**

    Copy the example file and fill in your paths:

    ```bash
    cp .env.example .env
    ```

    Then edit `.env`:

    ```env
    MOVIES_DIR=C:\path\to\your\Star Wars movies
    FFMPEG=C:\path\to\ffmpeg.exe
    FFPROBE=C:\path\to\ffprobe.exe
    ```

    On Linux/macOS, FFmpeg is typically available system-wide (`/usr/bin/ffmpeg`).

---

## Running the application

```bash
python main.py
```

The server starts on `http://127.0.0.1:5000`. Open that address in your browser.

On first launch, the background workers will begin extracting frames from your video files. The game becomes playable as soon as the first frames are ready (usually within a few seconds). The cache is saved to `frames_cache/` and persists across restarts, so subsequent launches are near-instant.

---

## Configuration

The following constants at the top of `main.py` can be adjusted to taste:

| Constant | Default | Description |
|----------|---------|-------------|
| `NUM_WORKERS` | `3` | Number of parallel FFmpeg extraction threads. |
| `SEGMENT_STEP` | `1` | Interval in seconds between extracted frames. Increase to reduce cache size. |
| `MAX_CACHE_SIZE` | `10000` | Maximum number of JPEG frames stored on disk. |

---

## Project structure

```
.
├── index.html        # Application markup
├── style.css         # Retro terminal styling
├── scripts.js        # Frontend logic (API calls, game state, magnifier)
├── main.py           # Flask backend (frame extraction, caching, API)
├── .env.example      # Environment variable template
├── .gitignore
└── frames_cache/     # Auto-generated - JPEG frames + index.json + seen.json
```

---

## API reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/movies` | `GET` | Returns the list of detected episodes (`episode`, `title`, `label`). |
| `/api/random-frame` | `GET` | Returns a random unseen frame as a base64-encoded JPEG along with its episode metadata and timestamp. |

---

## Notes & known limitations

- The application is intended for **local use only** with films you own. Do not expose the server to the public internet.
- The magnifier works by rendering a zoomed CSS `background-image` over the frame container; it is not available on touch screens.
- Lifetime statistics are stored in the browser's `localStorage` and are therefore tied to the specific browser profile used.
- If all 10 000 cached frames have been seen, the seen-set resets automatically and the cycle begins again from the full cache.