(function () {
    "use strict";

    // ==========================
    // Config & Constants
    // ==========================
    const BASE_GRID = 15;                // Reference for visual scaling
    const TILE = 30;                     // Logical tile size (do not change on grid growth)
    const FOOD_FX_MS = 500;              // Food spawn effect duration
    const EAT_FX_MS = 360;               // Wave ring duration after eating
    const SHAKE_MS = 150;               // Screen shake duration on death
    const SSAA = 1.5;                  // Super-sampling factor for crisper rendering

    const HS_KEY = 'snake_highscores_v1';
    const LAST_KEY = 'snake_last_entry_id_v1';

    // ==========================
    // Canvas & HiDPI
    // ==========================
    const canvas = document.getElementById("game");
    const ctx = canvas.getContext("2d");

    function setupHiDPI(g) {
        const dpr = Math.max(1, (window.devicePixelRatio || 1));
        const ratio = dpr * SSAA; // super-sampled internal resolution
        const gridSize = g || BASE_GRID;
        const cssW = gridSize * TILE;
        const cssH = gridSize * TILE;
        canvas.style.width = cssW + "px";
        canvas.style.height = cssH + "px";
        canvas.width = Math.round(cssW * ratio);
        canvas.height = Math.round(cssH * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
    }

    window.addEventListener("resize", () => setupHiDPI(state.grid));

    // ==========================
    // Utilities
    // ==========================
    function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }
    function clamp01(v){ return Math.max(0, Math.min(1, v)); }

    function now() { return performance.now(); }
    function posKey(x, y) { return x + "," + y; }

    function formatTime(ms) {
        const total = Math.max(0, Math.round(ms));
        const m = Math.floor(total / 60000);
        const s = Math.floor((total % 60000) / 1000);
        const cs = Math.floor((total % 1000) / 10);
        const mm = String(m).padStart(2, '0');
        const ss = String(s).padStart(2, '0');
        const cc = String(cs).padStart(2, '0');
        return `${mm}:${ss}.${cc}`;
    }

    // ==========================
    // Persistent Storage (Highscores)
    // ==========================
    function loadHighscores() {
        try { return JSON.parse(localStorage.getItem(HS_KEY)) || []; }
        catch { return []; }
    }

    function saveHighscores(list) {
        localStorage.setItem(HS_KEY, JSON.stringify(list));
    }

    function addHighscore({ score, timeMs }) {
        const id = Date.now();
        const entry = { id, score, timeMs, date: id };
        const list = loadHighscores();
        list.push(entry);
        list.sort((a,b) => {
            if (b.score !== a.score) return b.score - a.score; // higher score first
            return a.timeMs - b.timeMs; // faster time wins on tie
        });
        const trimmed = list.slice(0,5);
        saveHighscores(trimmed);
        try { localStorage.setItem(LAST_KEY, String(id)); } catch {}
        return trimmed;
    }

    function loadLastId() {
        try { return Number(localStorage.getItem(LAST_KEY)) || 0; }
        catch { return 0; }
    }

    // ==========================
    // Game State
    // ==========================
    const state = {
        grid: BASE_GRID,         // current grid size
        stepMs: 150 * (15 / BASE_GRID),
        snake: [],
        dir: { x: 1, y: 0 },
        queuedDirs: [],
        food: null,
        score: 0,
        lastStepAt: 0,
        gameOver: false,
        ateOnLastStep: false,
        runStartAt: 0,
        endedAt: null,
        started: false,
        // FX
        foodFxAt: null,
        eatWave: null,
        // UI flags
        menuPopulated: false,
        welcomePopulated: false,
        // O(1) occupancy + shake
        occupied: new Set(),
        shakeUntil: null,
    };

    // ==========================
    // Input Handling
    // ==========================
    // Queue a direction if it's not an instant reverse and no duplicates
    function queueDir(nd) {
        if (!nd) return;
        const last = state.queuedDirs.length ? state.queuedDirs[state.queuedDirs.length - 1] : state.dir;
        if (last.x + nd.x === 0 && last.y + nd.y === 0) return; // prevent instant reverse
        if (last.x === nd.x && last.y === nd.y) return; // prevent duplicate same direction
        if (state.queuedDirs.length >= 2) return; // cap queued directions to 2
        state.queuedDirs.push(nd);
    }

    function onKeyDown(e) {
        const k = e.key.toLowerCase();
        let nd = null;
        // Toggle fullscreen on 'f'
        if (k === 'f') {
            const root = document.documentElement;
            if (!document.fullscreenElement && root.requestFullscreen) {
                root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
            } else if (document.exitFullscreen) {
                document.exitFullscreen().catch(() => {});
            }
            e.preventDefault();
            return;
        }
        if (k === "arrowup" || k === "w") nd = { x: 0, y: -1 };
        else if (k === "arrowdown" || k === "s") nd = { x: 0, y: 1 };
        else if (k === "arrowleft" || k === "a") nd = { x: -1, y: 0 };
        else if (k === "arrowright" || k === "d") nd = { x: 1, y: 0 };
        else if ([" ", "spacebar", "space", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k) && (state.gameOver || !state.started)) {
            e.preventDefault();
            resetGame();
            return;
        }
        if (!nd) return;

        queueDir(nd);
        e.preventDefault();
    }

    function onPlayClick(e) {
        const btn = e.target.closest('#playBtn');
        if (!btn) return;
        resetGame();
    }

    // ==========================
    // Touch (Mobile Swipe) Handling
    // ==========================
    let touchStartX = null;
    let touchStartY = null;

    function onTouchStart(e) {
        if (!e.changedTouches || e.changedTouches.length === 0) return;
        const t = e.changedTouches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        e.preventDefault();
    }

    function onTouchMove(e) {
        if (e.cancelable) e.preventDefault();
    }

    function onTouchEnd(e) {
        if (!e.changedTouches || e.changedTouches.length === 0) return;
        const t = e.changedTouches[0];
        if (touchStartX === null || touchStartY === null) return;
        const dx = t.clientX - touchStartX;
        const dy = t.clientY - touchStartY;

        const THRESH = 24; // roughly a quick thumb flick

        let nd = null;
        if (Math.abs(dx) < THRESH && Math.abs(dy) < THRESH) {
            if (state.gameOver || !state.started) {
                resetGame();
            }
            if (e.cancelable) e.preventDefault();
            touchStartX = touchStartY = null;
            return;
        }

        if (Math.abs(dx) > Math.abs(dy)) {
            nd = (dx > 0) ? { x: 1, y: 0 } : { x: -1, y: 0 };
        } else {
            nd = (dy > 0) ? { x: 0, y: 1 } : { x: 0, y: -1 };
        }

        queueDir(nd);
        if (e.cancelable) e.preventDefault();
        touchStartX = touchStartY = null;
    }

    // ==========================
    // Game Lifecycle
    // ==========================
    function resetGame() {
        state.grid = 8;
        state.stepMs = 150 * (15 / state.grid);
        state.snake = [ { x: 3, y: 3 }, { x: 2, y: 3 }, { x: 1, y: 3 } ];
        state.dir = { x: 1, y: 0 };
        state.queuedDirs = [];
        // rebuild occupied set
        state.occupied = new Set();
        state.snake.forEach(p => state.occupied.add(posKey(p.x, p.y)));
        state.food = spawnFood();
        state.score = 0;
        state.lastStepAt = 0;
        state.gameOver = false;
        state.ateOnLastStep = false;
        state.runStartAt = now();
        state.endedAt = null;
        state.menuPopulated = false;
        state.started = true;
        state.welcomePopulated = false;
        state.foodFxAt = now();
        state.eatWave = null;
        state.shakeUntil = null;
        setupHiDPI(state.grid);
    }

    function spawnFood() {
        while (true) {
            const x = (Math.random() * state.grid) | 0;
            const y = (Math.random() * state.grid) | 0;
            if (!state.occupied || !state.occupied.has(posKey(x, y))) {
                const pos = { x, y };
                state.foodFxAt = now();
                return pos;
            }
        }
    }

    // ==========================
    // Update Step
    // ==========================
    function consumeDirectionQueue() {
        if (state.queuedDirs.length) {
            state.dir = state.queuedDirs.shift();
        }
    }

    function nextHead() {
        const head = state.snake[0];
        return { x: head.x + state.dir.x, y: head.y + state.dir.y };
    }

    function isWallCollision(nx, ny) {
        return nx < 0 || ny < 0 || nx >= state.grid || ny >= state.grid;
    }

    function isSelfCollision(nx, ny, willEat) {
        if (!state.occupied) return false;
        const tail = state.snake[state.snake.length - 1];
        const hits = state.occupied.has(posKey(nx, ny));
        if (!willEat && tail && tail.x === nx && tail.y === ny) return false;
        return hits;
    }

    function growGridIfNeeded() {
        if (state.snake.length >= state.grid ** 2 * 0.4 && state.grid < 36) {
            state.grid += 2;
            state.stepMs = 150 * (15 / state.grid);
            state.snake.forEach(p => { p.x += 1; p.y += 1; });
            // rebuild occupied because positions changed
            state.occupied = new Set();
            state.snake.forEach(p => state.occupied.add(posKey(p.x, p.y)));
            setupHiDPI(state.grid);
        }
    }

    function applyEatEffects(cx, cy) {
        const start = now();
        state.eatWave = { x: cx, y: cy, start };
    }

    function step() {
        state.ateOnLastStep = false;
        consumeDirectionQueue();

        const { x: nx, y: ny } = nextHead();
        const willEat = (nx === state.food.x && ny === state.food.y);

        if (isWallCollision(nx, ny) || isSelfCollision(nx, ny, willEat)) {
            state.gameOver = true;
            state.endedAt = now();
            state.shakeUntil = state.endedAt + SHAKE_MS;
            return;
        }

        // move head
        state.snake.unshift({ x: nx, y: ny });
        if (state.occupied) state.occupied.add(posKey(nx, ny));

        if (willEat) {
            state.score += 1;
            growGridIfNeeded();

            // effects
            const cx = state.food.x * TILE + TILE / 2;
            const cy = state.food.y * TILE + TILE / 2;
            applyEatEffects(cx, cy);

            state.food = spawnFood();
            state.ateOnLastStep = true; // keep tail still this frame
        } else {
            const tail = state.snake.pop();
            if (state.occupied && tail) state.occupied.delete(posKey(tail.x, tail.y));
        }
    }

    // ==========================
    // UI (Menu / HUD)
    // ==========================
    function $(sel) { return document.querySelector(sel); }

    function populateWelcomeIfNeeded() {
        if (state.started || state.welcomePopulated) return;
        const menu = $('#menu');
        if (!menu) return;
        const summaryEl = menu.querySelector('.summary');
        const hsEl = menu.querySelector('.highscores');
        const btn = $('#playBtn');
        menu.querySelector('h1').textContent = 'SNAKE';
        if (summaryEl) {
            summaryEl.innerHTML = `
                <div class="label">Controls</div><div>Arrows / WASD</div>
                <div class="label">Start</div><div>Press Play or Space</div>
            `;
        }
        if (hsEl) {
            const hs = loadHighscores();
            const lastId = loadLastId();
            const items = hs.map((e, i) => {
                const rank = `#${i+1}`;
                const cls = e.id === lastId ? ' class="current"' : '';
                return `<li${cls}><div>${rank} — ${e.score}</div><div class="meta">${formatTime(e.timeMs)}</div></li>`;
            }).join('');
            hsEl.innerHTML = `<ol>${items}</ol>`;
        }
        if (btn) btn.textContent = 'Play';
        state.welcomePopulated = true;
    }

    function populateMenuIfNeeded() {
        if (!state.gameOver || state.menuPopulated) return;
        const menu = $('#menu');
        if (!menu) return;

        const duration = (state.endedAt ?? now()) - state.runStartAt;
        const hs = addHighscore({ score: state.score, timeMs: duration });

        const summaryEl = menu.querySelector('.summary');
        if (summaryEl) {
            summaryEl.innerHTML = `
                <div class="label">Score</div><div>${state.score}</div>
                <div class="label">Time</div><div>${formatTime(duration)}</div>
            `;
        }

        const hsEl = menu.querySelector('.highscores');
        if (hsEl) {
            const lastId = loadLastId();
            const items = hs.map((e, i) => {
                const rank = `#${i+1}`;
                const cls = e.id === lastId ? ' class="current"' : '';
                return `<li${cls}><div>${rank} — ${e.score}</div><div class="meta">${formatTime(e.timeMs)}</div></li>`;
            }).join('');
            hsEl.innerHTML = `<ol>${items}</ol>`;
        }

        const btn = $('#playBtn');
        if (btn) btn.textContent = 'Play Again';

        state.menuPopulated = true;
    }

    function setGameTransform(gameEl, menuEl) {
        // compute optional shake translate
        let shakePrefix = "";
        if (state.shakeUntil && now() < state.shakeUntil) {
            const tLeft = state.shakeUntil - now();
            const p = Math.max(0, Math.min(1, tLeft / SHAKE_MS));
            const amp = 4 * p; // max ~4px, easing out
            const dx = (Math.random() * 2 - 1) * amp;
            const dy = (Math.random() * 2 - 1) * amp;
            shakePrefix = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) `;
        }

        if (!state.started) {
            populateWelcomeIfNeeded();
            gameEl.style.transition = 'filter 5s, transform 20s';
            gameEl.style.filter = 'blur(2px) opacity(1)';
            gameEl.style.transform = shakePrefix + 'scale(0)';
            menuEl.style.filter = 'blur(0)';
            menuEl.style.opacity = 1;
            return;
        }

        if (state.gameOver) {
            populateMenuIfNeeded();
            gameEl.style.transition = 'filter 5s, transform 20s';
            gameEl.style.filter = 'blur(2px) opacity(0.5)';
            gameEl.style.transform = shakePrefix + `scale(${(BASE_GRID / state.grid) * 0.9})`;
            menuEl.style.filter = 'blur(0)';
            menuEl.style.opacity = 1;
            return;
        }

        // playing
        gameEl.style.transition = 'filter 0s, transform 2s';
        gameEl.style.filter = 'blur(0) opacity(1)';
        gameEl.style.transform = shakePrefix + `scale(${BASE_GRID / state.grid})`;
        menuEl.style.filter = 'blur(10px)';
        menuEl.style.opacity = 0;
    }

    // ==========================
    // Rendering
    // ==========================
    function clearBoard() {
        ctx.clearRect(0, 0, state.grid * TILE, state.grid * TILE);
    }

    function drawGrid() {
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i <= state.grid; i++) {
            ctx.moveTo(i * TILE + 0.5, 0);
            ctx.lineTo(i * TILE + 0.5, state.grid * TILE);
            ctx.moveTo(0, i * TILE + 0.5);
            ctx.lineTo(state.grid * TILE, i * TILE + 0.5);
        }
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.stroke();
        ctx.restore();
    }

    function drawRoundedRect(x, y, w, h, radius) {
        const r = Math.min(radius, w / 2, h / 2);
        const x2 = x + w, y2 = y + h;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x2 - r, y);
        ctx.quadraticCurveTo(x2, y, x2, y + r);
        ctx.lineTo(x2, y2 - r);
        ctx.quadraticCurveTo(x2, y2, x2 - r, y2);
        ctx.lineTo(x + r, y2);
        ctx.quadraticCurveTo(x, y2, x, y2 - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();
    }

    function renderFood(margin) {
        const t = state.foodFxAt ? (now() - state.foodFxAt) : FOOD_FX_MS;
        const raw = clamp01(t / FOOD_FX_MS);
        const p = easeOutCubic(raw);
        const scale = 0.94 + 0.06 * p; // 0.94 -> 1.0
        const alpha = 0.75 + 0.25 * p;
        const cx = state.food.x * TILE + TILE / 2;
        const cy = state.food.y * TILE + TILE / 2;
        const w = (TILE - margin) * scale;
        const h = (TILE - margin) * scale;

        // halo
        const haloR = TILE * (0.45 + 0.15 * p);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
        g.addColorStop(0, 'rgba(255,87,87,' + (0.10 * p).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(255,87,87,0)');
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // subtle drop shadow for the fruit
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 1.5 * SSAA;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0.8 * SSAA;
        ctx.restore();

        // fruit body
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.filter = `blur(${Math.max(0, (1 - p) * 0.4).toFixed(2)}px)`; // a touch of spawn blur
        ctx.fillStyle = "#ff5757";
        drawRoundedRect(cx - w / 2, cy - h / 2, w, h, TILE - margin);
        ctx.restore();
    }

    function computeSnakePoints(moved, margin) {
        const pts = [];
        state.snake.forEach((point, i) => {
            if (i === 0) {
                // head lerp from 2nd to 1st segment for smoothness
                const nx = (state.snake[1].x + (point.x - state.snake[1].x) * moved) * TILE;
                const ny = (state.snake[1].y + (point.y - state.snake[1].y) * moved) * TILE;
                pts.push({ x: nx, y: ny });
            } else if (i === state.snake.length - 1) {
                // tail stays for the frame if we ate
                const last = state.snake[state.snake.length - 2];
                const tailFactor = state.ateOnLastStep ? 0 : (1 - moved);
                const nx = (last.x + (point.x - last.x) * tailFactor) * TILE;
                const ny = (last.y + (point.y - last.y) * tailFactor) * TILE;
                pts.push({ x: nx, y: ny });
            } else {
                pts.push({ x: point.x * TILE, y: point.y * TILE });
            }
        });
        return pts;
    }

    function renderSnake(points, margin) {
        // Build a central path through the segment centers
        const centers = points.map(p => ({ x: p.x + TILE / 2, y: p.y + TILE / 2 }));
        if (centers.length < 2) return;

        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        // Soft drop shadow for depth
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 2.0 * SSAA;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 1 * SSAA;

        // Wider faint outer stroke as a gentle edge/ambient occlusion
        ctx.beginPath();
        ctx.moveTo(centers[0].x, centers[0].y);
        for (let i = 1; i < centers.length; i++) ctx.lineTo(centers[i].x, centers[i].y);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = (TILE - margin) + 2;
        ctx.stroke();

        // Main crisp body stroke
        ctx.beginPath();
        ctx.moveTo(centers[0].x, centers[0].y);
        for (let i = 1; i < centers.length; i++) ctx.lineTo(centers[i].x, centers[i].y);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = (TILE - margin);
        ctx.stroke();
        ctx.restore();
    }

    function renderEatWave() {
        if (!state.eatWave) return;
        const t = now() - state.eatWave.start;
        const D = Math.floor(EAT_FX_MS * 1.15);
        if (t >= D) { state.eatWave = null; return; }
        const u = easeOutCubic(clamp01(t / D));
        const r = TILE * (0.35 + u * 0.9);
        ctx.save();
        ctx.globalAlpha = 0.22 * (1 - u);
        ctx.filter = 'blur(' + (1.1 * (1 - u)).toFixed(2) + 'px)';
        ctx.lineWidth = 1 + (1 - u) * 1.5;
        ctx.strokeStyle = '#ff5757';
        ctx.beginPath();
        ctx.arc(state.eatWave.x, state.eatWave.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    function renderFrame() {
        const moved = (state.gameOver || !state.started) ? 1 : Math.min(1, (now() - state.lastStepAt) / state.stepMs);
        const margin = TILE * (12 / 30);

        clearBoard();
        drawGrid();
        renderFood(margin);

        const snakePoints = computeSnakePoints(moved, margin);
        renderSnake(snakePoints, margin);
        renderEatWave();

        const gameEl = $('#game');
        const menuEl = $('#menu');
        setGameTransform(gameEl, menuEl);
    }

    // ==========================
    // Main Loop
    // ==========================
    function loop(ts) {
        if (!state.lastStepAt) state.lastStepAt = ts;
        if (state.started && !state.gameOver && ts - state.lastStepAt >= state.stepMs) {
            state.lastStepAt = ts;
            step();
        }
        renderFrame();
        requestAnimationFrame(loop);
    }

    // ==========================
    // Bootstrap
    // ==========================
    function bootstrap() {
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('click', onPlayClick);
        document.addEventListener('touchstart', onTouchStart, { passive: false });
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd, { passive: false });
        setupHiDPI(BASE_GRID);
        // initial state: show welcome
        resetToWelcome();
        requestAnimationFrame(loop);
    }

    function resetToWelcome() {
        // Use reset mechanics but keep not-started state for welcome screen
        state.grid = 10;
        state.stepMs = 150 * (15 / state.grid);
        state.snake = [ { x: 3, y: 3 }, { x: 2, y: 3 }, { x: 1, y: 3 } ];
        state.dir = { x: 1, y: 0 };
        state.queuedDirs = [];
        // rebuild occupied set
        state.occupied = new Set();
        state.snake.forEach(p => state.occupied.add(posKey(p.x, p.y)));
        state.food = spawnFood();
        state.score = 0;
        state.lastStepAt = 0;
        state.gameOver = false;
        state.ateOnLastStep = false;
        state.runStartAt = now();
        state.endedAt = null;
        state.menuPopulated = false;
        state.started = false;        // <= show welcome
        state.welcomePopulated = false;
        state.foodFxAt = null;       // prevent pre-start food spawn effect
        state.eatWave = null;
        state.shakeUntil = null;
        setupHiDPI(state.grid);
    }

    // Start
    bootstrap();
})();