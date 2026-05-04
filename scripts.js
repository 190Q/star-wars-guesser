const API = "http://127.0.0.1:5000/api";

const STORAGE_KEY = "sw-guesser-lifetime";

// Approximate movie durations in seconds (used for the visual progress bar)
const EPISODE_DURATIONS = {
    "I": 8160, "II": 8520, "III": 8400,
    "IV": 7260, "V": 7440, "VI": 7860,
};

function loadLifetime() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch {}
    return { correct: 0, total: 0, bestStreak: 0 };
}

function saveLifetime(lt) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lt));
}

const state = {
    correct: 0,
    total: 0,
    streak: 0,
    currentEpisode: null,
    answered: false,
    allMovies: [],
    lifetime: loadLifetime(),
    prefetchedFrame: null,
};

const elCorrect    = document.getElementById("score-correct");
const elTotal      = document.getElementById("score-total");
const elAccuracy   = document.getElementById("score-accuracy");
const elStreak     = document.getElementById("score-streak");
const elLtCorrect  = document.getElementById("lt-correct");
const elLtTotal    = document.getElementById("lt-total");
const elLtAccuracy = document.getElementById("lt-accuracy");
const elLtBest     = document.getElementById("lt-best-streak");
const elFrameImg   = document.getElementById("frame-img");
const elPlaceholder= document.getElementById("frame-placeholder");
const elResultBanner = document.getElementById("result-banner");
const elResultIcon = document.getElementById("result-icon");
const elResultText = document.getElementById("result-text");
const elResultAnswer = document.getElementById("result-answer");
const elChoicesGrid = document.getElementById("choices-grid");
const elBtnNext         = document.getElementById("btn-next");
const elLoading          = document.getElementById("loading-overlay");
const elFrameContainer   = document.getElementById("frame-container");
const elProgressFill     = document.getElementById("frame-progress-fill");
const elProgressThumb    = document.getElementById("frame-progress-thumb");
const elProgress         = document.getElementById("frame-progress");
function updateScore() {
    elCorrect.textContent = state.correct;
    elTotal.textContent   = state.total;
    elStreak.textContent  = state.streak;
    if (state.total === 0) {
        elAccuracy.textContent = "-";
    } else {
        elAccuracy.textContent = Math.round((state.correct / state.total) * 100) + "%";
    }

    const lt = state.lifetime;
    elLtCorrect.textContent = lt.correct;
    elLtTotal.textContent   = lt.total;
    elLtBest.textContent    = lt.bestStreak;
    if (lt.total === 0) {
        elLtAccuracy.textContent = "-";
    } else {
        elLtAccuracy.textContent = Math.round((lt.correct / lt.total) * 100) + "%";
    }
}

function showLoading(visible) {
    elLoading.classList.toggle("hidden", !visible);
}

function buildChoiceButtons(movies) {
    elChoicesGrid.innerHTML = "";
    movies.forEach(movie => {
        const btn = document.createElement("button");
        btn.className = "choice-btn";
        btn.dataset.episode = movie.episode;
        btn.innerHTML = `
            <span class="ep-num">EPISODE ${movie.episode}</span>
            <span class="ep-title">${movie.title.toUpperCase()}</span>
        `;
        btn.addEventListener("click", () => handleGuess(movie.episode, btn));
        elChoicesGrid.appendChild(btn);
    });
}

function handleGuess(guessedEpisode, clickedBtn) {
    if (state.answered) return;
    state.answered = true;
    state.total++;

    const isCorrect = guessedEpisode === state.currentEpisode;
    if (isCorrect) {
        state.correct++;
        state.streak++;
        state.lifetime.correct++;
    } else {
        state.streak = 0;
    }
    state.lifetime.total++;
    if (state.streak > state.lifetime.bestStreak) {
        state.lifetime.bestStreak = state.streak;
    }
    saveLifetime(state.lifetime);

    updateScore();

    document.querySelectorAll(".choice-btn").forEach(btn => {
        btn.disabled = true;
        if (btn.dataset.episode === state.currentEpisode) {
            btn.classList.add(isCorrect ? "correct" : "reveal");
        }
    });

    if (!isCorrect) {
        clickedBtn.classList.add("wrong");
    }

    const correctMovie = state.allMovies.find(m => m.episode === state.currentEpisode);
    const correctLabel = correctMovie ? `EPISODE ${correctMovie.episode} - ${correctMovie.title.toUpperCase()}` : state.currentEpisode;

    elResultBanner.className = "result-banner " + (isCorrect ? "correct" : "wrong");
    elResultIcon.textContent = isCorrect ? "✓" : "✗";
    elResultText.textContent = isCorrect ? "CORRECT -" : "WRONG -";
    elResultAnswer.textContent = correctLabel;
    elResultBanner.classList.remove("hidden");
    elProgress.classList.remove("hidden");

    elBtnNext.disabled = false;
}

function prefetchFrame() {
    state.prefetchedFrame = fetch(`${API}/random-frame`).then(r => r.json()).catch(() => null);
}

async function loadNextFrame() {
    if (state.allMovies.length === 0) {
        try {
            const resp = await fetch(`${API}/movies`);
            state.allMovies = await resp.json();
            buildChoiceButtons(state.allMovies);
        } catch {
            alert("Could not connect to the backend server. Make sure app.py is running.");
            return;
        }
    }

    state.answered = false;
    elResultBanner.classList.add("hidden");
    elProgress.classList.add("hidden");
    elBtnNext.disabled = true;
    elBtnNext.classList.remove("start-mode");

    document.querySelectorAll(".choice-btn").forEach(btn => {
        btn.disabled = true;
        btn.classList.remove("correct", "wrong", "reveal");
    });

    // Use prefetched frame if available, otherwise fetch now
    let data = null;
    if (state.prefetchedFrame) {
        showLoading(true);
        data = await state.prefetchedFrame;
        state.prefetchedFrame = null;
    }
    if (!data || data.error) {
        showLoading(true);
        try {
            const resp = await fetch(`${API}/random-frame`);
            data = await resp.json();
        } catch {
            alert("Failed to load frame.");
            showLoading(false);
            return;
        }
    }

    state.currentEpisode = data.episode;

    // Update the visual-only progress bar
    const duration = EPISODE_DURATIONS[data.episode] || 7800;
    const pct = Math.min(100, Math.max(0, (data.timestamp / duration) * 100));
    elProgressFill.style.width  = pct + "%";
    elProgressThumb.style.left  = pct + "%";

    elFrameImg.src = `data:image/jpeg;base64,${data.frame}`;
    elFrameImg.classList.remove("hidden");
    elPlaceholder.classList.add("hidden");
    showLoading(false);

    document.querySelectorAll(".choice-btn").forEach(btn => {
        btn.disabled = false;
    });

    // Immediately start prefetching the next frame
    prefetchFrame();
}

// Magnifier
const MAGNIFIER_ZOOM = 2.5;
const MAGNIFIER_SIZE = 160;

const elLens = document.createElement('div');
elLens.className = 'magnifier-lens';
elFrameContainer.appendChild(elLens);

let magnifierActive = false;

function updateLens(e) {
    const rect = elFrameContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (x < 0 || x > rect.width || y < 0 || y > rect.height) {
        elLens.style.display = 'none';
        return;
    }

    elLens.style.display = 'block';
    elLens.style.left = (x - MAGNIFIER_SIZE / 2) + 'px';
    elLens.style.top  = (y - MAGNIFIER_SIZE / 2) + 'px';
    elLens.style.backgroundSize     = `${rect.width * MAGNIFIER_ZOOM}px ${rect.height * MAGNIFIER_ZOOM}px`;
    elLens.style.backgroundPosition = `${-(x * MAGNIFIER_ZOOM - MAGNIFIER_SIZE / 2)}px ${-(y * MAGNIFIER_ZOOM - MAGNIFIER_SIZE / 2)}px`;
}

elFrameImg.addEventListener('mousedown', (e) => {
    if (elFrameImg.classList.contains('hidden')) return;
    e.preventDefault();
    magnifierActive = true;
    elLens.style.backgroundImage = `url("${elFrameImg.src}")`;
    updateLens(e);
});

window.addEventListener('mousemove', (e) => {
    if (magnifierActive) updateLens(e);
});

window.addEventListener('mouseup', () => {
    magnifierActive = false;
    elLens.style.display = 'none';
});

async function init() {
    try {
        const resp = await fetch(`${API}/movies`);
        state.allMovies = await resp.json();
        buildChoiceButtons(state.allMovies);
    } catch {
        elPlaceholder.querySelector(".placeholder-text").textContent = "BACKEND OFFLINE";
    }

    updateScore();
    elBtnNext.disabled = false;
    elBtnNext.classList.add("start-mode");
    elBtnNext.querySelector(".btn-label").textContent = "START GAME";
    elBtnNext.addEventListener("click", () => {
        elBtnNext.querySelector(".btn-label").textContent = "NEXT FRAME";
        loadNextFrame();
    }, { once: true });

    elBtnNext.addEventListener("click", () => {
        if (!elBtnNext.disabled && elBtnNext.querySelector(".btn-label").textContent === "NEXT FRAME") {
            loadNextFrame();
        }
    });
}

init();