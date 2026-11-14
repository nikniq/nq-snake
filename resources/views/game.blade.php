<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <meta name="theme-color" content="#05070f">
    <meta name="description" content="Neon Snake — a modern take on the arcade classic. Eat, grow, glow. Compete for the high score.">

    <title>{{ config('app.name', 'Neon Snake') }}</title>

    <link rel="icon" href="/favicon.svg" type="image/svg+xml">

    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body>
    <div class="scene" aria-hidden="true">
        <span class="scene__grid"></span>
        <span class="scene__orb scene__orb--green"></span>
        <span class="scene__orb scene__orb--cyan"></span>
        <span class="scene__orb scene__orb--violet"></span>
    </div>

    <header class="topbar">
        <a class="brand" href="{{ route('game') }}" aria-label="Neon Snake home">
            <span class="brand__mark">
                <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
                    <path d="M14 34h13a7 7 0 0 0 0-14H14a6 6 0 0 1 0-12h15"
                          stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
                    <circle cx="30" cy="8" r="3" fill="#eafff2"/>
                    <circle cx="31" cy="8" r="1.2" fill="#05130c"/>
                </svg>
            </span>
            <span class="brand__text">
                <span class="brand__name">Neon <em>Snake</em></span>
                <span class="brand__tag">The arcade classic, reimagined</span>
            </span>
        </a>

        <div class="topbar__actions">
            <a class="btn btn--ghost btn--sm" href="#leaderboard">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 5h3v3a3 3 0 0 1-3 3M7 5H4v3a3 3 0 0 0 3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                Leaderboard
            </a>
            <button class="icon-btn" id="sound-toggle" type="button" aria-pressed="true" aria-label="Mute sound" title="Sound on">
                <svg class="icon-on" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                <svg class="icon-off" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m16.5 9.5 5 5m0-5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            </button>
        </div>
    </header>

    <main class="layout">
        <section class="game-card glass" aria-labelledby="game-title">
            <h1 class="sr-only" id="game-title">Neon Snake</h1>

            <div class="hud">
                <div class="hud__stats">
                    <div class="stat">
                        <span class="stat__label">Score</span>
                        <span class="stat__value stat__value--accent" id="score">0</span>
                    </div>
                    <div class="stat">
                        <span class="stat__label">Best</span>
                        <span class="stat__value" id="best">0</span>
                    </div>
                    <div class="stat">
                        <span class="stat__label">Length</span>
                        <span class="stat__value" id="length">3</span>
                    </div>
                    <div class="stat">
                        <span class="stat__label">Time</span>
                        <span class="stat__value stat__value--mono" id="time">00:00</span>
                    </div>
                </div>
                <div class="hud__chips">
                    <span class="chip" id="mode-chip" data-accent="green">Classic</span>
                    <span class="chip chip--muted" id="speed-chip">Classic speed</span>
                </div>
            </div>

            <div class="board-shell">
                <div class="board-frame" id="board-frame" data-mode="classic">
                    <canvas id="board" width="720" height="720" role="img" aria-label="Snake game board. Use arrow keys or WASD to steer."></canvas>
                    <span class="board-frame__glow" aria-hidden="true"></span>
                    <span class="board-frame__corner board-frame__corner--tl" aria-hidden="true"></span>
                    <span class="board-frame__corner board-frame__corner--br" aria-hidden="true"></span>
                    <span class="board-frame__scan" aria-hidden="true"></span>

                    <!-- Start -->
                    <div class="overlay" id="overlay-start" data-visible="true">
                        <div class="overlay__panel overlay__panel--start">
                            <p class="eyebrow"><span class="pulse-dot"></span> Ready when you are</p>
                            <h2 class="overlay__title">Chase the <span>glow.</span></h2>
                            <p class="overlay__copy">Swipe apples, stack points and keep your tail out of trouble. Every fifth apple spawns a golden one.</p>

                            <div class="field">
                                <span class="field__label">Mode</span>
                                <div class="segmented" id="mode-select" role="group" aria-label="Game mode">
                                    <button type="button" class="segment is-active" data-mode="classic">
                                        <span>Classic</span><small>Walls bite</small>
                                    </button>
                                    <button type="button" class="segment" data-mode="portal">
                                        <span>Portal</span><small>Edges wrap</small>
                                    </button>
                                </div>
                            </div>

                            <div class="field">
                                <span class="field__label">Speed</span>
                                <div class="segmented segmented--compact" id="speed-select" role="group" aria-label="Game speed">
                                    <button type="button" data-speed="chill">Chill</button>
                                    <button type="button" data-speed="classic" class="is-active">Classic</button>
                                    <button type="button" data-speed="insane">Insane</button>
                                </div>
                            </div>

                            <button class="btn btn--primary btn--lg btn--block" id="play-btn" type="button">
                                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5Z"/></svg>
                                Play now <kbd>Space</kbd>
                            </button>

                            <ul class="hints">
                                <li><kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd> or <kbd>WASD</kbd></li>
                                <li>Swipe on touch</li>
                                <li><kbd>Space</kbd> to pause</li>
                            </ul>
                        </div>
                    </div>

                    <!-- Countdown -->
                    <div class="overlay overlay--clear" id="overlay-countdown" data-visible="false" aria-hidden="true">
                        <div class="countdown">
                            <span class="countdown__number" id="countdown-number">3</span>
                            <span class="countdown__label">Get ready</span>
                        </div>
                    </div>

                    <!-- Pause -->
                    <div class="overlay" id="overlay-pause" data-visible="false" aria-hidden="true">
                        <div class="overlay__panel overlay__panel--slim">
                            <span class="overlay__icon">
                                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.4"/><rect x="14" y="5" width="4" height="14" rx="1.4"/></svg>
                            </span>
                            <h2 class="overlay__title overlay__title--sm">Paused</h2>
                            <p class="overlay__copy">Take a breath. Your run is waiting.</p>
                            <div class="overlay__actions">
                                <button class="btn btn--primary" id="resume-btn" type="button">Resume</button>
                                <button class="btn btn--ghost" id="quit-btn" type="button">End run</button>
                            </div>
                            <p class="overlay__hint"><kbd>Space</kbd> or <kbd>Esc</kbd> to resume</p>
                        </div>
                    </div>

                    <!-- Game over -->
                    <div class="overlay" id="overlay-over" data-visible="false" aria-hidden="true">
                        <div class="overlay__panel overlay__panel--over">
                            <p class="eyebrow eyebrow--danger"><span class="pulse-dot"></span> Run complete</p>
                            <h2 class="overlay__title overlay__title--sm" id="over-title">Game over</h2>
                            <p class="overlay__copy" id="over-copy">The wall got you. It happens to the best of us.</p>

                            <div class="result-grid">
                                <div class="result">
                                    <span class="result__label">Score</span>
                                    <span class="result__value result__value--accent" id="over-score">0</span>
                                </div>
                                <div class="result">
                                    <span class="result__label">Apples</span>
                                    <span class="result__value" id="over-apples">0</span>
                                </div>
                                <div class="result">
                                    <span class="result__label">Time</span>
                                    <span class="result__value" id="over-time">00:00</span>
                                </div>
                            </div>

                            <div class="personal-best" id="over-best" data-visible="false">
                                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
                                New personal best
                            </div>

                            <form class="save-form" id="save-form" novalidate>
                                <label class="save-form__label" for="player-name">Save to the leaderboard</label>
                                <div class="save-form__row">
                                    <input class="input" id="player-name" name="name" type="text" maxlength="20" autocomplete="nickname" placeholder="Your name" aria-describedby="save-error">
                                    <button class="btn btn--primary" id="save-btn" type="submit">Save</button>
                                </div>
                                <p class="save-form__error" id="save-error" role="alert"></p>
                                <p class="save-form__success" id="save-success" role="status"></p>
                            </form>

                            <div class="overlay__actions">
                                <button class="btn btn--primary" id="again-btn" type="button">
                                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.34-5.66M4 4v4h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                                    Play again
                                </button>
                                <button class="btn btn--ghost" id="change-setup-btn" type="button">Change setup</button>
                                <button class="btn btn--ghost" id="close-over-btn" type="button">View board</button>
                            </div>
                            <p class="overlay__hint">Press <kbd>Space</kbd> to play again</p>
                        </div>
                    </div>
                </div>

                <div class="board-caption">
                    <span class="board-caption__status"><span class="status-dot" id="status-dot"></span><span id="status-text">Press play to begin</span></span>
                    <span id="run-best">Personal best · 0</span>
                </div>
            </div>

            <div class="game-controls">
                <div class="dpad" role="group" aria-label="Directional controls">
                    <button class="dpad__btn dpad__btn--up" type="button" data-dir="up" aria-label="Move up">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 14 6-6 6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <button class="dpad__btn dpad__btn--left" type="button" data-dir="left" aria-label="Move left">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14 6-6 6 6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <span class="dpad__core" aria-hidden="true"></span>
                    <button class="dpad__btn dpad__btn--right" type="button" data-dir="right" aria-label="Move right">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m10 6 6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <button class="dpad__btn dpad__btn--down" type="button" data-dir="down" aria-label="Move down">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 10 6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                </div>

                <p class="controls-hint"><span class="controls-hint__desktop">Steer with <kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd> or <kbd>WASD</kbd></span><span class="controls-hint__touch">Swipe the board or use the pad</span></p>

                <div class="action-buttons">
                    <button class="btn btn--ghost" id="pause-btn" type="button" disabled>
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.4"/><rect x="14" y="5" width="4" height="14" rx="1.4"/></svg>
                        <span>Pause</span>
                    </button>
                    <button class="btn btn--ghost" id="restart-btn" type="button">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.34-5.66M4 4v4h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        <span>Restart</span>
                    </button>
                </div>
            </div>
        </section>

        <aside class="sidebar">
            <section class="panel glass" id="leaderboard" aria-labelledby="leaderboard-title">
                <div class="panel__head">
                    <div>
                        <p class="eyebrow">Hall of fame</p>
                        <h2 class="panel__title" id="leaderboard-title">Leaderboard</h2>
                    </div>
                    <button class="icon-btn icon-btn--sm" id="scores-refresh" type="button" aria-label="Refresh leaderboard" title="Refresh">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 11a8 8 0 1 0-.6 3M20 4v7h-7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                </div>

                <div class="tabs" id="board-tabs" role="tablist" aria-label="Leaderboard mode">
                    <button class="tab is-active" type="button" role="tab" aria-selected="true" data-board-mode="classic">Classic</button>
                    <button class="tab" type="button" role="tab" aria-selected="false" data-board-mode="portal">Portal</button>
                </div>

                <ol class="score-list" id="score-list" aria-live="polite" aria-busy="true"></ol>
                <p class="panel__foot">Top 10 runs on this server. Could your name be up there?</p>
            </section>

            <section class="panel glass panel--tips" aria-labelledby="tips-title">
                <div class="panel__head">
                    <div>
                        <p class="eyebrow">Field guide</p>
                        <h2 class="panel__title" id="tips-title">How to play</h2>
                    </div>
                </div>
                <ul class="tips-list">
                    <li>
                        <span class="tips-list__icon tips-list__icon--red"></span>
                        <span><strong>Apples</strong> are worth 10 points and add one segment.</span>
                    </li>
                    <li>
                        <span class="tips-list__icon tips-list__icon--gold"></span>
                        <span><strong>Golden apples</strong> appear every 5th pickup — 50 points and a three-segment boost.</span>
                    </li>
                    <li>
                        <span class="tips-list__icon tips-list__icon--green"></span>
                        <span><strong>Classic</strong> mode walls are fatal. <strong>Portal</strong> mode wraps you to the other side.</span>
                    </li>
                    <li>
                        <span class="tips-list__icon tips-list__icon--cyan"></span>
                        <span>Speed ramps up as you grow. Corners are where legends are made.</span>
                    </li>
                </ul>
                <div class="key-guide" aria-hidden="true">
                    <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>Steer</span></div>
                    <div><kbd>Space</kbd><span>Pause</span></div>
                    <div><kbd>R</kbd><span>Restart</span></div>
                </div>
            </section>
        </aside>
    </main>

    <footer class="footer">
        <span>Built with Laravel + Vite</span>
        <span class="footer__dot" aria-hidden="true"></span>
        <span>Neon Snake &copy; {{ date('Y') }}</span>
    </footer>

    <div class="toast" id="toast" role="status" aria-live="polite"></div>
</body>
</html>




