/**
 * Neon Snake
 * A dependency-free canvas game with a Laravel-powered leaderboard.
 */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, t) => from + (to - from) * t;

const GRID = { cols: 24, rows: 24 };

const MODES = {
    classic: { label: 'Classic', accent: 'green' },
    portal: { label: 'Portal', accent: 'cyan' },
};

const SPEEDS = {
    chill: { label: 'Chill', base: 175, min: 118, ramp: 0.7 },
    classic: { label: 'Classic', base: 128, min: 80, ramp: 1.05 },
    insane: { label: 'Insane', base: 92, min: 56, ramp: 1.35 },
};

const SCORING = {
    apple: 10,
    golden: 50,
    goldenEvery: 5,
    goldenTtl: 9000,
};

const STORAGE_KEYS = {
    settings: 'neon-snake:settings',
    best: 'neon-snake:best',
};

const DEFAULT_SETTINGS = {
    mode: 'classic',
    speed: 'classic',
    sound: true,
    name: '',
};

function readJson(key, fallback) {
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function writeJson(key, value) {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* Storage can be unavailable in private mode — game still works. */
    }
}

let settings = { ...DEFAULT_SETTINGS, ...readJson(STORAGE_KEYS.settings, {}) };
let bestScores = { ...readJson(STORAGE_KEYS.best, {}) };

if (!MODES[settings.mode]) settings.mode = DEFAULT_SETTINGS.mode;
if (!SPEEDS[settings.speed]) settings.speed = DEFAULT_SETTINGS.speed;

function saveSettings() {
    writeJson(STORAGE_KEYS.settings, settings);
}

function getBest(mode) {
    const value = Number(bestScores[mode]);
    return Number.isFinite(value) ? value : 0;
}

function setBest(mode, value) {
    bestScores = { ...bestScores, [mode]: Math.max(getBest(mode), value) };
    writeJson(STORAGE_KEYS.best, bestScores);
}

function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatNumber(value) {
    return Number(value || 0).toLocaleString('en-US');
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ */
/* Sound                                                               */
/* ------------------------------------------------------------------ */

class SoundEngine {
    constructor() {
        this.enabled = settings.sound !== false;
        this.ctx = null;
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        settings.sound = enabled;
        saveSettings();
    }

    ensure() {
        if (!this.enabled) return null;

        try {
            if (!this.ctx) {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                if (!AudioContext) return null;
                this.ctx = new AudioContext();
            }
            if (this.ctx.state === 'suspended') this.ctx.resume();
            return this.ctx;
        } catch {
            return null;
        }
    }

    tone(frequency, duration = 0.1, { type = 'sine', gain = 0.045, delay = 0, slide = 0 } = {}) {
        if (!this.enabled) return;
        const ctx = this.ensure();
        if (!ctx) return;

        const start = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const volume = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(frequency, start);
        if (slide) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(30, frequency + slide), start + duration);
        }

        volume.gain.setValueAtTime(0.0001, start);
        volume.gain.exponentialRampToValueAtTime(gain, start + 0.015);
        volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);

        osc.connect(volume).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + duration + 0.02);
    }

    eat() {
        this.tone(520, 0.07, { type: 'triangle', gain: 0.05 });
        this.tone(780, 0.09, { type: 'triangle', gain: 0.04, delay: 0.05 });
    }

    golden() {
        [660, 880, 1174].forEach((frequency, index) => {
            this.tone(frequency, 0.12, { type: 'sine', gain: 0.05, delay: index * 0.06 });
        });
    }

    die() {
        this.tone(280, 0.34, { type: 'sawtooth', gain: 0.06, slide: -190 });
        this.tone(140, 0.4, { type: 'triangle', gain: 0.05, delay: 0.04, slide: -80 });
    }

    countdown(final = false) {
        this.tone(final ? 880 : 540, final ? 0.18 : 0.08, { type: 'square', gain: 0.03 });
    }

    click() {
        this.tone(420, 0.045, { type: 'triangle', gain: 0.025 });
    }

    pause() {
        this.tone(360, 0.09, { type: 'sine', gain: 0.035, slide: -80 });
    }
}

const sound = new SoundEngine();

/* ------------------------------------------------------------------ */
/* Game engine                                                         */
/* ------------------------------------------------------------------ */

const DIRECTION_VECTORS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
};

const sameCell = (a, b) => Boolean(a && b && a.x === b.x && a.y === b.y);

class SnakeGame {
    constructor(canvas, { onUpdate, onGameOver } = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onUpdate = onUpdate || (() => {});
        this.onGameOver = onGameOver || (() => {});

        this.mode = settings.mode;
        this.speedKey = settings.speed;

        this.snake = [];
        this.prevSnake = [];
        this.direction = { x: 1, y: 0 };
        this.queue = [];
        this.food = { x: 18, y: 12 };
        this.bonus = null;
        this.growth = 0;

        this.score = 0;
        this.apples = 0;
        this.status = 'idle';
        this.dead = false;
        this.deathPoint = null;

        this.accumulator = 0;
        this.interp = 0;
        this.elapsedTotal = 0;
        this.runningSince = 0;

        this.particles = [];
        this.shake = 0;

        this.width = 0;
        this.height = 0;
        this.cell = 0;
        this.dpr = 1;
        this.background = null;

        this.lastFrame = performance.now();
        this.loop = this.loop.bind(this);

        this.resize();
        this.reset();

        requestAnimationFrame(this.loop);
    }

    configure(mode, speedKey) {
        this.mode = MODES[mode] ? mode : 'classic';
        this.speedKey = SPEEDS[speedKey] ? speedKey : 'classic';
    }

    reset() {
        const centerX = Math.floor(GRID.cols / 2);
        const centerY = Math.floor(GRID.rows / 2);

        this.snake = [
            { x: centerX, y: centerY },
            { x: centerX - 1, y: centerY },
            { x: centerX - 2, y: centerY },
        ];
        this.prevSnake = this.snake.map((part) => ({ ...part }));
        this.direction = { x: 1, y: 0 };
        this.queue = [];
        this.growth = 0;

        this.score = 0;
        this.apples = 0;
        this.bonus = null;
        this.food = { x: centerX + 4, y: centerY };
        this.status = 'idle';
        this.dead = false;
        this.deathPoint = null;

        this.accumulator = 0;
        this.interp = 0;
        this.elapsedTotal = 0;
        this.runningSince = 0;

        this.particles = [];
        this.shake = 0;

        this.spawnFood();
        this.notify();
    }

    begin() {
        this.status = 'running';
        this.dead = false;
        this.runningSince = performance.now();
        this.accumulator = 0;
        this.interp = 0;
        this.notify();
    }

    elapsedMs() {
        const live = this.status === 'running' ? performance.now() - this.runningSince : 0;
        return this.elapsedTotal + live;
    }

    interval() {
        const speed = SPEEDS[this.speedKey] || SPEEDS.classic;
        return Math.max(speed.min, speed.base - this.apples * speed.ramp);
    }

    pause() {
        if (this.status !== 'running') return;
        this.elapsedTotal += performance.now() - this.runningSince;
        this.status = 'paused';
        sound.pause();
        this.notify();
    }

    resume() {
        if (this.status !== 'paused') return;
        this.status = 'running';
        this.runningSince = performance.now();
        this.accumulator = 0;
        this.notify();
    }

    togglePause() {
        if (this.status === 'running') this.pause();
        else if (this.status === 'paused') this.resume();
    }

    setDirection(name) {
        if (this.status !== 'running') return;

        const vector = DIRECTION_VECTORS[name];
        if (!vector) return;

        const base = this.queue.length ? this.queue[this.queue.length - 1] : this.direction;

        if (vector.x === -base.x && vector.y === -base.y) return;
        if (vector.x === base.x && vector.y === base.y) return;
        if (this.queue.length >= 2) return;

        this.queue.push({ ...vector });
    }

    freeCell(exclude = []) {
        const occupied = new Set();

        for (const part of this.snake) occupied.add(`${part.x},${part.y}`);
        for (const cell of exclude) {
            if (cell) occupied.add(`${cell.x},${cell.y}`);
        }

        const free = [];

        for (let y = 0; y < GRID.rows; y++) {
            for (let x = 0; x < GRID.cols; x++) {
                if (!occupied.has(`${x},${y}`)) free.push({ x, y });
            }
        }

        if (!free.length) return null;

        return free[Math.floor(Math.random() * free.length)];
    }

    spawnFood() {
        this.food = this.freeCell([this.bonus]);
    }

    spawnBonus() {
        const cell = this.freeCell([this.food]);
        if (!cell) return;

        const now = performance.now();
        this.bonus = {
            ...cell,
            bornAt: now,
            expiresAt: now + SCORING.goldenTtl,
        };
    }

    step() {
        if (this.status !== 'running') return;

        this.prevSnake = this.snake.map((part) => ({ ...part }));

        if (this.queue.length) {
            this.direction = this.queue.shift();
        }

        const head = this.snake[0];
        let next = { x: head.x + this.direction.x, y: head.y + this.direction.y };

        if (this.mode === 'portal') {
            next = {
                x: (next.x + GRID.cols) % GRID.cols,
                y: (next.y + GRID.rows) % GRID.rows,
            };
        } else if (next.x < 0 || next.y < 0 || next.x >= GRID.cols || next.y >= GRID.rows) {
            this.die('wall', next);
            return;
        }

        const eatsFood = sameCell(next, this.food);
        const eatsBonus = sameCell(next, this.bonus);

        if (eatsFood) this.growth += 1;
        if (eatsBonus) this.growth += 3;

        const growsThisTick = this.growth > 0;
        const body = growsThisTick ? this.snake : this.snake.slice(0, -1);

        if (body.some((part) => part.x === next.x && part.y === next.y)) {
            this.die('self', next);
            return;
        }

        this.snake.unshift(next);

        if (growsThisTick) {
            this.growth -= 1;
        } else {
            this.snake.pop();
        }

        if (eatsFood) {
            const eaten = this.food;
            this.score += SCORING.apple;
            this.apples += 1;
            this.burst(eaten, ['#fb7185', '#fecdd3', '#f97316'], 11);
            sound.eat();
            this.spawnFood();

            if (this.food && this.apples % SCORING.goldenEvery === 0) {
                this.spawnBonus();
            }
        }

        if (eatsBonus && this.bonus) {
            const eaten = this.bonus;
            this.score += SCORING.golden;
            this.apples += 1;
            this.burst(eaten, ['#fbbf24', '#fde68a', '#f59e0b'], 20);
            sound.golden();
            this.bonus = null;
        }

        this.notify();
    }

    die(reason, point = null) {
        if (this.status === 'over' || this.status === 'idle') return;

        if (this.status === 'running') {
            this.elapsedTotal += performance.now() - this.runningSince;
        }

        this.status = 'over';
        this.dead = true;
        this.deathPoint = point || this.snake[0];

        if (point) {
            this.burst(point, ['#fb7185', '#fda4af', '#fecdd3'], 26);
        }

        this.shake = reduceMotion ? 0 : 9;
        sound.die();
        this.notify();

        this.onGameOver(this.result(reason));
    }

    endRun() {
        if (this.status !== 'running' && this.status !== 'paused') return;
        this.die('quit');
    }

    result(reason) {
        return {
            reason,
            score: this.score,
            apples: this.apples,
            durationMs: this.elapsedMs(),
            mode: this.mode,
            speed: this.speedKey,
        };
    }

    snapshot() {
        return {
            status: this.status,
            score: this.score,
            apples: this.apples,
            length: this.snake.length,
            durationMs: this.elapsedMs(),
            mode: this.mode,
            speed: this.speedKey,
            bonus: Boolean(this.bonus),
        };
    }

    notify() {
        this.onUpdate(this.snapshot());
    }

    burst(cell, colors, count) {
        if (reduceMotion || !cell) return;

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1.6 + Math.random() * 4.4;

            this.particles.push({
                x: cell.x + 0.5,
                y: cell.y + 0.5,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 1,
                decay: 1.4 + Math.random() * 1.4,
                size: 0.05 + Math.random() * 0.08,
                color: colors[Math.floor(Math.random() * colors.length)],
            });
        }
    }

    updateParticles(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const particle = this.particles[i];
            particle.life -= particle.decay * dt;

            if (particle.life <= 0) {
                this.particles.splice(i, 1);
                continue;
            }

            particle.x += particle.vx * dt;
            particle.y += particle.vy * dt;
            particle.vx *= 1 - 2.2 * dt;
            particle.vy *= 1 - 2.2 * dt;
        }
    }

    update(dt) {
        if (this.status === 'running') {
            const interval = this.interval();
            this.accumulator += dt * 1000;

            let guard = 0;
            while (this.accumulator >= interval && this.status === 'running' && guard < 4) {
                this.accumulator -= interval;
                this.step();
                guard++;
            }

            this.interp = clamp(this.accumulator / this.interval(), 0, 1);

            if (this.bonus && performance.now() > this.bonus.expiresAt) {
                this.bonus = null;
            }
        }

        this.updateParticles(dt);

        if (this.shake > 0) {
            this.shake = Math.max(0, this.shake - dt * 26);
        }
    }

    loop(timestamp) {
        const dt = Math.min(0.05, Math.max(0, (timestamp - this.lastFrame) / 1000));
        this.lastFrame = timestamp;

        this.update(dt);
        this.render(timestamp / 1000);

        requestAnimationFrame(this.loop);
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const size = Math.max(200, Math.round(rect.width || 480));
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        if (size === this.width && size === this.height && dpr === this.dpr) return;

        this.width = size;
        this.height = size;
        this.dpr = dpr;
        this.canvas.width = Math.round(size * dpr);
        this.canvas.height = Math.round(size * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.cell = size / GRID.cols;

        this.buildBackground();
    }

    buildBackground() {
        const { width: w, height: h, cell, dpr } = this;
        if (!w || !h) return;

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);

        const g = canvas.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);

        const accent = this.mode === 'portal' ? '34, 211, 238' : '74, 222, 128';

        const base = g.createLinearGradient(0, 0, w, h);
        base.addColorStop(0, this.mode === 'portal' ? '#071722' : '#08141c');
        base.addColorStop(0.55, '#050c17');
        base.addColorStop(1, '#03070f');
        g.fillStyle = base;
        g.fillRect(0, 0, w, h);

        g.fillStyle = 'rgba(148, 163, 184, 0.022)';
        for (let y = 0; y < GRID.rows; y++) {
            for (let x = 0; x < GRID.cols; x++) {
                if ((x + y) % 2 === 0) {
                    g.fillRect(Math.round(x * cell), Math.round(y * cell), Math.ceil(cell), Math.ceil(cell));
                }
            }
        }

        const aura = g.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, w * 0.72);
        aura.addColorStop(0, `rgba(${accent}, 0.07)`);
        aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
        g.fillStyle = aura;
        g.fillRect(0, 0, w, h);

        g.lineWidth = 1;
        g.strokeStyle = 'rgba(148, 163, 184, 0.05)';
        g.beginPath();
        for (let i = 1; i < GRID.cols; i++) {
            const p = Math.round(i * cell) + 0.5;
            g.moveTo(p, 0);
            g.lineTo(p, h);
            g.moveTo(0, p);
            g.lineTo(w, p);
        }
        g.stroke();

        g.strokeStyle = 'rgba(148, 163, 184, 0.085)';
        g.beginPath();
        for (let i = 6; i < GRID.cols; i += 6) {
            const p = Math.round(i * cell) + 0.5;
            g.moveTo(p, 0);
            g.lineTo(p, h);
            g.moveTo(0, p);
            g.lineTo(w, p);
        }
        g.stroke();

        g.strokeStyle = `rgba(${accent}, 0.14)`;
        g.lineWidth = 1.5;
        const inset = cell * 0.32;
        g.strokeRect(inset, inset, w - inset * 2, h - inset * 2);

        if (this.mode === 'portal') {
            g.setLineDash([cell * 0.55, cell * 0.45]);
            g.strokeStyle = 'rgba(34, 211, 238, 0.18)';
            g.lineWidth = 2;
            g.strokeRect(inset * 1.8, inset * 1.8, w - inset * 3.6, h - inset * 3.6);
            g.setLineDash([]);
        }

        const vignette = g.createRadialGradient(w / 2, h / 2, cell * 2.5, w / 2, h / 2, w * 0.72);
        vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vignette.addColorStop(0.72, 'rgba(0, 0, 0, 0.16)');
        vignette.addColorStop(1, 'rgba(0, 0, 0, 0.58)');
        g.fillStyle = vignette;
        g.fillRect(0, 0, w, h);

        this.background = canvas;
    }

    getRenderSegments() {
        const t = this.status === 'running' ? clamp(this.interp, 0, 1) : 1;
        const previous = this.prevSnake;

        return this.snake.map((segment, index) => {
            const from = previous[Math.min(index, previous.length - 1)] || segment;
            let fromX = from.x;
            let fromY = from.y;

            if (Math.abs(segment.x - fromX) > 1 || Math.abs(segment.y - fromY) > 1) {
                fromX = segment.x;
                fromY = segment.y;
            }

            return {
                x: lerp(fromX, segment.x, t) + 0.5,
                y: lerp(fromY, segment.y, t) + 0.5,
            };
        });
    }

    render(time) {
        const ctx = this.ctx;
        if (!ctx) return;

        const { width: w, height: h } = this;
        if (!w || !h) return;

        ctx.save();

        if (this.shake > 0 && !reduceMotion) {
            ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
        }

        ctx.clearRect(0, 0, w, h);

        if (this.background) {
            ctx.drawImage(this.background, 0, 0, w, h);
        }

        const segments = this.getRenderSegments();

        if (this.food) this.drawFood(ctx, this.food, time, false);
        if (this.bonus) this.drawFood(ctx, this.bonus, time, true);

        this.drawSnake(ctx, segments, time);
        this.drawParticles(ctx);

        ctx.restore();
    }

    drawSnake(ctx, segments, time) {
        if (!segments.length) return;

        const cell = this.cell;

        for (let i = segments.length - 1; i >= 1; i--) {
            const segment = segments[i];
            const t = i / Math.max(1, segments.length - 1);
            const size = cell * (0.84 - t * 0.2);
            const x = segment.x * cell;
            const y = segment.y * cell;
            const hue = 158 + t * 28;
            const saturation = 80 - t * 22;
            const lightness = 56 - t * 24;

            ctx.fillStyle = `hsl(${hue} ${saturation}% ${lightness}%)`;
            roundRect(ctx, x - size / 2, y - size / 2, size, size, size * 0.34);
            ctx.fill();

            if (!reduceMotion && i < 6) {
                ctx.fillStyle = `hsla(${hue} 90% 82% / ${0.16 - (i / 6) * 0.1})`;
                roundRect(
                    ctx,
                    x - size / 2 + size * 0.2,
                    y - size / 2 + size * 0.16,
                    size * 0.6,
                    size * 0.3,
                    size * 0.18,
                );
                ctx.fill();
            }
        }

        const head = segments[0];
        const headX = head.x * cell;
        const headY = head.y * cell;
        const size = cell * 0.94;

        ctx.save();
        ctx.shadowColor = this.mode === 'portal' ? 'rgba(34, 211, 238, 0.8)' : 'rgba(52, 211, 153, 0.85)';
        ctx.shadowBlur = cell * (this.dead ? 1.1 : 0.65);

        const gradient = ctx.createRadialGradient(
            headX - cell * 0.13,
            headY - cell * 0.17,
            cell * 0.04,
            headX,
            headY,
            size * 0.62,
        );
        gradient.addColorStop(0, '#d9ffe8');
        gradient.addColorStop(0.42, '#5eead4');
        gradient.addColorStop(1, '#0d9488');

        ctx.fillStyle = gradient;
        roundRect(ctx, headX - size / 2, headY - size / 2, size, size, size * 0.36);
        ctx.fill();
        ctx.restore();

        this.drawFace(ctx, headX, headY, time);
    }

    drawFace(ctx, x, y, time) {
        const cell = this.cell;
        const dir = this.direction;
        const perpX = -dir.y;
        const perpY = dir.x;
        const forward = cell * 0.17;
        const side = cell * 0.18;
        const eyeRadius = cell * 0.088;

        const eyes = [
            { x: x + dir.x * forward + perpX * side, y: y + dir.y * forward + perpY * side },
            { x: x + dir.x * forward - perpX * side, y: y + dir.y * forward - perpY * side },
        ];

        if (this.dead) {
            ctx.strokeStyle = '#04231a';
            ctx.lineWidth = cell * 0.055;
            ctx.lineCap = 'round';

            for (const eye of eyes) {
                const r = eyeRadius * 0.9;
                ctx.beginPath();
                ctx.moveTo(eye.x - r, eye.y - r);
                ctx.lineTo(eye.x + r, eye.y + r);
                ctx.moveTo(eye.x + r, eye.y - r);
                ctx.lineTo(eye.x - r, eye.y + r);
                ctx.stroke();
            }
            return;
        }

        for (const eye of eyes) {
            ctx.fillStyle = '#f4fffa';
            ctx.beginPath();
            ctx.arc(eye.x, eye.y, eyeRadius, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#052e22';
            ctx.beginPath();
            ctx.arc(
                eye.x + dir.x * eyeRadius * 0.4,
                eye.y + dir.y * eyeRadius * 0.4,
                eyeRadius * 0.52,
                0,
                Math.PI * 2,
            );
            ctx.fill();
        }

        if (this.status === 'running' && !reduceMotion) {
            const flick = Math.sin(time * 5.2);

            if (flick > 0.55) {
                const tongueStart = cell * 0.42;
                const tongueLength = cell * (0.2 + (flick - 0.55) * 0.3);
                const sx = x + dir.x * tongueStart;
                const sy = y + dir.y * tongueStart;
                const ex = sx + dir.x * tongueLength;
                const ey = sy + dir.y * tongueLength;

                ctx.strokeStyle = '#fb7185';
                ctx.lineWidth = cell * 0.055;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(ex, ey);
                ctx.moveTo(ex, ey);
                ctx.lineTo(ex + perpX * cell * 0.07, ey + perpY * cell * 0.07);
                ctx.moveTo(ex, ey);
                ctx.lineTo(ex - perpX * cell * 0.07, ey - perpY * cell * 0.07);
                ctx.stroke();
            }
        }
    }

    drawFood(ctx, item, time, golden) {
        const cell = this.cell;
        const x = (item.x + 0.5) * cell;
        const y = (item.y + 0.5) * cell;
        const pulse = 1 + Math.sin(time * 3 + (golden ? 1.4 : 0)) * 0.055;

        ctx.save();

        const auraRadius = cell * (golden ? 1.2 : 0.95);
        const aura = ctx.createRadialGradient(x, y, 0, x, y, auraRadius);
        aura.addColorStop(0, golden ? 'rgba(251, 191, 36, 0.36)' : 'rgba(251, 113, 133, 0.26)');
        aura.addColorStop(1, golden ? 'rgba(251, 191, 36, 0)' : 'rgba(251, 113, 133, 0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(x, y, auraRadius, 0, Math.PI * 2);
        ctx.fill();

        if (golden) {
            const remaining = clamp((item.expiresAt - performance.now()) / SCORING.goldenTtl, 0, 1);

            ctx.beginPath();
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.75)';
            ctx.lineWidth = cell * 0.055;
            ctx.lineCap = 'round';
            ctx.arc(x, y, cell * 0.46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remaining);
            ctx.stroke();

            ctx.translate(x, y);
            ctx.rotate(time * 0.7);

            const outer = cell * 0.33 * pulse;
            const inner = outer * 0.38;

            ctx.beginPath();
            for (let i = 0; i < 8; i++) {
                const radius = i % 2 === 0 ? outer : inner;
                const angle = (Math.PI / 4) * i - Math.PI / 2;
                const px = Math.cos(angle) * radius;
                const py = Math.sin(angle) * radius;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();

            const gold = ctx.createRadialGradient(0, 0, 0, 0, 0, outer);
            gold.addColorStop(0, '#fffbe6');
            gold.addColorStop(0.5, '#fde047');
            gold.addColorStop(1, '#f59e0b');
            ctx.fillStyle = gold;
            ctx.fill();
        } else {
            ctx.translate(x, y);
            ctx.scale(pulse, pulse);

            ctx.strokeStyle = '#7c2d12';
            ctx.lineWidth = cell * 0.055;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(0, -cell * 0.2);
            ctx.quadraticCurveTo(cell * 0.03, -cell * 0.34, cell * 0.09, -cell * 0.4);
            ctx.stroke();

            ctx.fillStyle = '#34d399';
            ctx.beginPath();
            ctx.ellipse(cell * 0.17, -cell * 0.34, cell * 0.15, cell * 0.065, -0.55, 0, Math.PI * 2);
            ctx.fill();

            const apple = ctx.createRadialGradient(
                -cell * 0.1,
                -cell * 0.12,
                cell * 0.02,
                0,
                0,
                cell * 0.34,
            );
            apple.addColorStop(0, '#fecdd3');
            apple.addColorStop(0.45, '#fb7185');
            apple.addColorStop(1, '#be123c');
            ctx.fillStyle = apple;
            ctx.beginPath();
            ctx.arc(0, cell * 0.02, cell * 0.29, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
            ctx.beginPath();
            ctx.arc(-cell * 0.1, -cell * 0.07, cell * 0.05, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    drawParticles(ctx) {
        if (!this.particles.length) return;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        for (const particle of this.particles) {
            const alpha = clamp(particle.life, 0, 1);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = particle.color;
            ctx.beginPath();
            ctx.arc(
                particle.x * this.cell,
                particle.y * this.cell,
                particle.size * this.cell * (0.5 + alpha * 0.7),
                0,
                Math.PI * 2,
            );
            ctx.fill();
        }

        ctx.restore();
    }
}

function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
}

/* ------------------------------------------------------------------ */
/* UI                                                                  */
/* ------------------------------------------------------------------ */

const els = {
    canvas: $('#board'),
    frame: $('#board-frame'),
    score: $('#score'),
    best: $('#best'),
    length: $('#length'),
    time: $('#time'),
    modeChip: $('#mode-chip'),
    speedChip: $('#speed-chip'),
    statusText: $('#status-text'),
    statusDot: $('#status-dot'),
    runBest: $('#run-best'),
    pauseBtn: $('#pause-btn'),
    restartBtn: $('#restart-btn'),
    playBtn: $('#play-btn'),
    resumeBtn: $('#resume-btn'),
    quitBtn: $('#quit-btn'),
    againBtn: $('#again-btn'),
    changeSetupBtn: $('#change-setup-btn'),
    closeOverBtn: $('#close-over-btn'),
    countdownNumber: $('#countdown-number'),
    overTitle: $('#over-title'),
    overCopy: $('#over-copy'),
    overScore: $('#over-score'),
    overApples: $('#over-apples'),
    overTime: $('#over-time'),
    overBest: $('#over-best'),
    saveForm: $('#save-form'),
    playerName: $('#player-name'),
    saveBtn: $('#save-btn'),
    saveError: $('#save-error'),
    saveSuccess: $('#save-success'),
    soundToggle: $('#sound-toggle'),
    scoresRefresh: $('#scores-refresh'),
    boardTabs: $('#board-tabs'),
    scoreList: $('#score-list'),
    toast: $('#toast'),
    overlays: {
        start: $('#overlay-start'),
        countdown: $('#overlay-countdown'),
        pause: $('#overlay-pause'),
        over: $('#overlay-over'),
    },
};

const ui = {
    countdownTimer: null,
    overTimer: null,
    toastTimer: null,
    saving: false,
    submitted: false,
    lastResult: null,
    lastHudScore: 0,
    boardMode: settings.mode,
    boardRequest: 0,
};

const csrfToken = $('meta[name="csrf-token"]')?.content || '';

function setOverlay(name, visible) {
    const element = els.overlays[name];
    if (!element) return;

    element.dataset.visible = visible ? 'true' : 'false';
    element.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function hideOverlays() {
    Object.keys(els.overlays).forEach((name) => setOverlay(name, false));
}

function popScore() {
    if (reduceMotion) return;
    const value = els.score;
    value.classList.remove('is-popping');
    void value.offsetWidth;
    value.classList.add('is-popping');
}

const STATUS_COPY = {
    idle: 'Press play to begin',
    running: 'Slithering…',
    paused: 'Paused — take a breath',
    over: 'Run complete — go again?',
};

function renderBest(mode) {
    const best = getBest(mode);
    els.best.textContent = formatNumber(best);
    els.runBest.textContent = `Personal best · ${formatNumber(best)}`;
}

function handleUpdate(state) {
    els.score.textContent = formatNumber(state.score);

    if (state.score > ui.lastHudScore) {
        popScore();
    }
    ui.lastHudScore = state.score;

    els.best.textContent = formatNumber(Math.max(getBest(state.mode), state.score));
    els.length.textContent = formatNumber(state.length);
    els.time.textContent = formatTime(state.durationMs);
    els.runBest.textContent = `Personal best · ${formatNumber(getBest(state.mode))}`;

    const mode = MODES[state.mode] || MODES.classic;
    els.modeChip.textContent = mode.label;
    els.modeChip.dataset.accent = mode.accent;

    const speed = SPEEDS[state.speed] || SPEEDS.classic;
    els.speedChip.textContent = `${speed.label} speed`;

    els.frame.dataset.mode = state.mode;
    els.statusText.textContent = STATUS_COPY[state.status] || STATUS_COPY.idle;
    els.statusDot.dataset.state = state.status;

    const canPause = state.status === 'running' || state.status === 'paused';
    els.pauseBtn.disabled = !canPause;
    els.pauseBtn.querySelector('span').textContent = state.status === 'paused' ? 'Resume' : 'Pause';

    if (state.status === 'paused') {
        setOverlay('pause', true);
    } else if (state.status === 'running') {
        setOverlay('pause', false);
    }
}

const game = new SnakeGame(els.canvas, {
    onUpdate: handleUpdate,
    onGameOver: handleGameOver,
});

game.configure(settings.mode, settings.speed);
game.reset();

/* ------------------------------------------------------------------ */
/* Run lifecycle                                                       */
/* ------------------------------------------------------------------ */

function cancelCountdown() {
    if (ui.countdownTimer) {
        window.clearInterval(ui.countdownTimer);
        ui.countdownTimer = null;
    }
    setOverlay('countdown', false);
}

function replayCountdownAnimation() {
    els.countdownNumber.classList.remove('is-ticking');
    void els.countdownNumber.offsetWidth;
    els.countdownNumber.classList.add('is-ticking');
}

function startRun() {
    sound.ensure();
    cancelCountdown();

    if (ui.overTimer) {
        window.clearTimeout(ui.overTimer);
        ui.overTimer = null;
    }

    hideOverlays();

    if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
    }

    game.configure(settings.mode, settings.speed);
    game.reset();

    ui.lastHudScore = 0;
    ui.submitted = false;
    ui.saving = false;

    renderBest(settings.mode);
    setOverlay('countdown', true);

    let count = 3;
    els.countdownNumber.textContent = String(count);
    replayCountdownAnimation();
    sound.countdown(false);

    ui.countdownTimer = window.setInterval(() => {
        count -= 1;

        if (count > 0) {
            els.countdownNumber.textContent = String(count);
            replayCountdownAnimation();
            sound.countdown(false);
            return;
        }

        window.clearInterval(ui.countdownTimer);
        ui.countdownTimer = null;
        setOverlay('countdown', false);
        sound.countdown(true);
        game.begin();
    }, 700);
}

function handleGameOver(result) {
    ui.lastResult = { ...result };

    const previousBest = getBest(result.mode);
    const isBest = result.score > 0 && result.score > previousBest;

    if (isBest) {
        setBest(result.mode, result.score);
    }

    renderBest(result.mode);
    handleBoardMode(result.mode, true);

    if (ui.overTimer) window.clearTimeout(ui.overTimer);

    ui.overTimer = window.setTimeout(() => {
        showGameOver(result, isBest);
    }, reduceMotion ? 150 : 640);
}

function showGameOver(result, isBest) {
    ui.overTimer = null;

    els.overScore.textContent = formatNumber(result.score);
    els.overApples.textContent = formatNumber(result.apples);
    els.overTime.textContent = formatTime(result.durationMs);

    const copy = {
        wall: 'The wall got you. It happens to the best of us.',
        self: 'You bit your own tail. Bold move.',
        quit: 'You ended the run early. The apples will wait.',
    };

    els.overTitle.textContent = result.reason === 'quit' ? 'Run ended' : 'Game over';
    els.overCopy.textContent = copy[result.reason] || copy.wall;
    els.overBest.dataset.visible = isBest ? 'true' : 'false';

    const canSave = result.score > 0;
    els.saveForm.hidden = !canSave;

    ui.saving = false;
    ui.submitted = false;
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = 'Save';
    els.saveError.textContent = '';
    els.saveSuccess.textContent = '';
    els.playerName.disabled = false;
    els.playerName.value = settings.name || '';

    setOverlay('over', true);

    if (!reduceMotion) {
        window.setTimeout(() => {
            (canSave ? els.playerName : els.againBtn).focus({ preventScroll: true });
        }, 140);
    }
}

/* ------------------------------------------------------------------ */
/* Leaderboard                                                         */
/* ------------------------------------------------------------------ */

function showToast(message, tone = 'success') {
    clearTimeout(ui.toastTimer);
    els.toast.textContent = message;
    els.toast.dataset.tone = tone;
    els.toast.classList.add('is-visible');

    ui.toastTimer = window.setTimeout(() => {
        els.toast.classList.remove('is-visible');
    }, 3400);
}

function emptyState(title, message, retry = false) {
    const item = document.createElement('li');
    item.className = 'score-list__empty';

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML =
        '<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 5h3v3a3 3 0 0 1-3 3M7 5H4v3a3 3 0 0 0 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>';

    const heading = document.createElement('strong');
    heading.textContent = title;

    const body = document.createElement('span');
    body.textContent = message;

    item.append(icon, heading, body);

    if (retry) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn--ghost btn--sm';
        button.textContent = 'Try again';
        button.style.marginTop = '10px';
        button.addEventListener('click', () => loadScores(ui.boardMode));
        item.append(button);
    }

    return item;
}

function renderSkeletons() {
    const rows = [];

    for (let i = 0; i < 6; i++) {
        const row = document.createElement('li');
        row.className = 'skeleton-row';
        row.setAttribute('aria-hidden', 'true');
        row.innerHTML =
            '<span class="skeleton skeleton--rank"></span><span class="skeleton skeleton--name"></span><span class="skeleton skeleton--points"></span>';
        rows.push(row);
    }

    els.scoreList.replaceChildren(...rows);
}

function renderScores(scores) {
    if (!scores.length) {
        els.scoreList.replaceChildren(
            emptyState('No scores yet', 'Be the first to leave a glowing trail.'),
        );
        return;
    }

    const rows = scores.map((score) => {
        const row = document.createElement('li');
        row.className = 'score-row';

        const rank = document.createElement('span');
        rank.className = 'score-row__rank';
        if (score.rank <= 3) rank.classList.add(`score-row__rank--${score.rank}`);
        rank.textContent = String(score.rank);

        const who = document.createElement('span');
        who.className = 'score-row__who';

        const name = document.createElement('span');
        name.className = 'score-row__name';
        name.textContent = score.name;

        const meta = document.createElement('span');
        meta.className = 'score-row__meta';
        meta.textContent = `${formatNumber(score.apples)} apples · ${formatTime(score.duration_ms)}`;

        who.append(name, meta);

        const points = document.createElement('span');
        points.className = 'score-row__points';
        points.textContent = formatNumber(score.score);

        row.append(rank, who, points);
        return row;
    });

    els.scoreList.replaceChildren(...rows);
}

async function loadScores(mode = ui.boardMode) {
    const next = MODES[mode] ? mode : 'classic';
    ui.boardMode = next;

    const requestId = ++ui.boardRequest;

    els.scoreList.setAttribute('aria-busy', 'true');
    renderSkeletons();

    try {
        const response = await fetch(`/api/scores?mode=${encodeURIComponent(next)}`, {
            headers: { Accept: 'application/json' },
        });

        if (!response.ok) throw new Error('The leaderboard is taking a breather.');

        const data = await response.json();

        if (requestId !== ui.boardRequest) return;

        renderScores(Array.isArray(data.scores) ? data.scores : []);
    } catch (error) {
        if (requestId !== ui.boardRequest) return;

        els.scoreList.replaceChildren(
            emptyState('Could not load scores', error.message || 'Please try again.', true),
        );
    } finally {
        if (requestId === ui.boardRequest) {
            els.scoreList.setAttribute('aria-busy', 'false');
        }
    }
}

function handleBoardMode(mode, forceFetch = false) {
    const next = MODES[mode] ? mode : 'classic';
    const changed = ui.boardMode !== next;

    $$('.tab', els.boardTabs).forEach((tab) => {
        const active = tab.dataset.boardMode === next;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    if (forceFetch || changed) {
        loadScores(next);
    } else {
        ui.boardMode = next;
    }
}

async function submitScore(event) {
    event.preventDefault();

    if (!ui.lastResult || ui.saving || ui.submitted) return;

    const name = els.playerName.value.trim().replace(/\s+/g, ' ');

    els.saveError.textContent = '';
    els.saveSuccess.textContent = '';

    if (!name) {
        els.saveError.textContent = 'Pick a name before saving.';
        els.playerName.focus();
        return;
    }

    settings.name = name.slice(0, 20);
    saveSettings();

    ui.saving = true;
    els.saveBtn.disabled = true;
    els.saveBtn.textContent = 'Saving…';

    const payload = {
        name: settings.name,
        score: ui.lastResult.score,
        apples: ui.lastResult.apples,
        duration_ms: Math.round(ui.lastResult.durationMs),
        mode: ui.lastResult.mode,
    };

    try {
        const response = await fetch('/api/scores', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-CSRF-TOKEN': csrfToken,
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            if (response.status === 429) {
                throw new Error('Easy there — too many saves. Try again in a minute.');
            }

            const validationErrors = data.errors ? Object.values(data.errors).flat() : [];
            throw new Error(validationErrors[0] || data.message || 'Could not save that score.');
        }

        ui.submitted = true;
        ui.saving = false;

        els.saveBtn.textContent = 'Saved';
        els.playerName.disabled = true;
        els.saveError.textContent = '';
        els.saveSuccess.textContent = `Saved! You're rank #${data.rank} in ${MODES[payload.mode].label}.`;

        showToast(`Score saved at rank #${data.rank}. Nice run!`);
        handleBoardMode(payload.mode, true);
    } catch (error) {
        ui.saving = false;
        els.saveBtn.disabled = false;
        els.saveBtn.textContent = 'Save';
        els.saveError.textContent = error.message || 'Could not save that score.';
    }
}

/* ------------------------------------------------------------------ */
/* Controls & wiring                                                   */
/* ------------------------------------------------------------------ */

function syncSelectors() {
    $$('#mode-select .segment').forEach((button) => {
        const active = button.dataset.mode === settings.mode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    $$('#speed-select button').forEach((button) => {
        const active = button.dataset.speed === settings.speed;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    els.frame.dataset.mode = settings.mode;
    els.modeChip.textContent = MODES[settings.mode].label;
    els.modeChip.dataset.accent = MODES[settings.mode].accent;
    els.speedChip.textContent = `${SPEEDS[settings.speed].label} speed`;
}

function syncSoundUi() {
    const enabled = settings.sound !== false;
    els.soundToggle.dataset.sound = enabled ? 'on' : 'off';
    els.soundToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    els.soundToggle.setAttribute('aria-label', enabled ? 'Mute sound' : 'Unmute sound');
    els.soundToggle.title = enabled ? 'Sound on' : 'Sound off';
}

function changeSetup() {
    setOverlay('over', false);
    setOverlay('pause', false);
    setOverlay('start', true);
    els.playBtn.focus({ preventScroll: true });
}

function wireEvents() {
    els.playBtn.addEventListener('click', () => {
        sound.click();
        startRun();
    });

    els.restartBtn.addEventListener('click', () => {
        sound.click();
        startRun();
    });

    els.againBtn.addEventListener('click', () => {
        sound.click();
        startRun();
    });

    els.changeSetupBtn.addEventListener('click', changeSetup);

    els.pauseBtn.addEventListener('click', () => {
        sound.click();
        game.togglePause();
    });

    els.resumeBtn.addEventListener('click', () => {
        sound.click();
        game.resume();
    });

    els.quitBtn.addEventListener('click', () => {
        sound.click();
        game.endRun();
    });

    els.closeOverBtn.addEventListener('click', () => {
        setOverlay('over', false);
    });

    els.saveForm.addEventListener('submit', submitScore);

    document.addEventListener('keydown', (event) => {
        const target = event.target;
        const tag = (target.tagName || '').toLowerCase();

        if (['input', 'textarea', 'select'].includes(tag) || target.isContentEditable) {
            if (event.key === 'Escape') target.blur();
            return;
        }

        if (event.metaKey || event.ctrlKey || event.altKey) return;

        const key = event.key.toLowerCase();
        const directions = {
            arrowup: 'up',
            w: 'up',
            arrowdown: 'down',
            s: 'down',
            arrowleft: 'left',
            a: 'left',
            arrowright: 'right',
            d: 'right',
        };

        if (directions[key]) {
            event.preventDefault();
            game.setDirection(directions[key]);
            return;
        }

        if (key === ' ' || key === 'spacebar') {
            // Let a focused button or link handle its own Space activation.
            if (tag === 'button' || tag === 'a') return;

            event.preventDefault();

            if (game.status === 'running' || game.status === 'paused') {
                game.togglePause();
            } else {
                startRun();
            }
            return;
        }

        if (key === 'escape' || key === 'p') {
            if (game.status === 'running' || game.status === 'paused') {
                event.preventDefault();
                game.togglePause();
            }
            return;
        }

        if (key === 'r') {
            event.preventDefault();
            startRun();
        }
    });

    $$('.dpad__btn').forEach((button) => {
        const direction = button.dataset.dir;

        button.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            game.setDirection(direction);
        });

        button.addEventListener('click', () => game.setDirection(direction));
    });

    let swipe = null;

    els.canvas.addEventListener('pointerdown', (event) => {
        if (game.status !== 'running') return;
        swipe = { x: event.clientX, y: event.clientY };
    });

    els.canvas.addEventListener('pointerup', (event) => {
        if (!swipe) return;

        const dx = event.clientX - swipe.x;
        const dy = event.clientY - swipe.y;
        swipe = null;

        if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;

        if (Math.abs(dx) > Math.abs(dy)) {
            game.setDirection(dx > 0 ? 'right' : 'left');
        } else {
            game.setDirection(dy > 0 ? 'down' : 'up');
        }
    });

    els.canvas.addEventListener('pointercancel', () => {
        swipe = null;
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden && game.status === 'running') {
            game.pause();
        }
    });

    els.soundToggle.addEventListener('click', () => {
        settings.sound = !(settings.sound !== false);
        sound.setEnabled(settings.sound);
        syncSoundUi();

        if (settings.sound) sound.click();
    });

    $$('#mode-select .segment').forEach((button) => {
        button.addEventListener('click', () => {
            if (button.dataset.mode === settings.mode) return;

            settings.mode = button.dataset.mode;
            saveSettings();
            sound.click();
            syncSelectors();
            renderBest(settings.mode);

            game.configure(settings.mode, settings.speed);
            game.buildBackground();

            if (game.status === 'idle' || game.status === 'over') {
                game.reset();
            }

            handleBoardMode(settings.mode, true);
        });
    });

    $$('#speed-select button').forEach((button) => {
        button.addEventListener('click', () => {
            if (button.dataset.speed === settings.speed) return;

            settings.speed = button.dataset.speed;
            saveSettings();
            sound.click();
            syncSelectors();
            game.configure(settings.mode, settings.speed);

            if (game.status === 'idle' || game.status === 'over') {
                game.reset();
            }
        });
    });

    $$('.tab', els.boardTabs).forEach((tab) => {
        tab.addEventListener('click', () => {
            if (tab.dataset.boardMode === ui.boardMode) return;
            sound.click();
            handleBoardMode(tab.dataset.boardMode, true);
        });
    });

    els.scoresRefresh.addEventListener('click', () => {
        sound.click();
        loadScores(ui.boardMode);
    });

    if ('ResizeObserver' in window) {
        new ResizeObserver(() => game.resize()).observe(els.frame);
    } else {
        window.addEventListener('resize', () => game.resize());
    }

    window.setInterval(() => {
        if (game.status === 'running' || game.status === 'paused') {
            els.time.textContent = formatTime(game.elapsedMs());
        }
    }, 250);
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

syncSelectors();
syncSoundUi();
renderBest(settings.mode);
wireEvents();
game.resize();
loadScores(settings.mode);
