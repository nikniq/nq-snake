# Neon Snake

A modern take on the arcade classic, built with **Laravel 13**, **Vite**, and a dependency-free HTML5 canvas engine.

The application is served from `public_html/` instead of Laravel's default `public/` directory.

## Features

- **Two game modes** — Classic (walls are fatal) and Portal (edges wrap around).
- **Three speeds** — Chill, Classic, and Insane. The snake speeds up as it grows.
- **Golden apples** — every fifth pickup spawns a timed bonus worth 50 points and three segments.
- **Smooth canvas rendering** — interpolated movement, gradient snake segments, glowing apples, particles, screen shake, and a subtle “portal” board theme.
- **Modern UI** — glassmorphism panels, neon accents, responsive layout, and a full-screen game overlay flow (start, countdown, pause, game over).
- **Controls** — arrow keys / WASD, swipe on touch devices, and an on-screen D-pad.
- **Sound** — generated with the Web Audio API (no audio assets) and persisted as a preference.
- **Leaderboard** — top 10 scores per mode stored in SQLite via a CSRF-protected JSON API.
- **Personal bests** — kept locally per mode with `localStorage`.
- **Accessibility** — labelled controls, keyboard focus states, live regions, and reduced-motion support.

## Requirements

- PHP 8.3+
- Composer
- Node.js 20+ and npm
- SQLite (default) or another Laravel-supported database

## Setup

```bash
composer install
cp .env.example .env
php artisan key:generate
touch database/database.sqlite
php artisan migrate
npm install
npm run build
php artisan serve
```

Open <http://localhost:8000>.

For frontend hot reloading, run `npm run dev` in a separate terminal.

## `public_html` as the public directory

The document root is `public_html/`. Three pieces make that work:

1. **Application public path** — `bootstrap/app.php` calls `$app->usePublicPath(dirname(__DIR__).'/public_html')`, so `public_path()`, the `@vite` directive, and `php artisan serve` all resolve assets from `public_html/`.
2. **Vite build output** — `vite.config.js` passes `publicDirectory: 'public_html'` to `laravel-vite-plugin`, so compiled assets land in `public_html/build/`.
3. **Web server** — point your host's document root at `public_html/`. The included `.htaccess` handles front-controller rewrites on Apache. For Nginx, use `root /path/to/project/public_html;` and the usual Laravel `try_files` rule.

`public_html/index.php` requires `../vendor/autoload.php` and `../bootstrap/app.php`, so no further path changes are needed.

## Project layout

```
app/Http/Controllers/GameController.php       Page controller
app/Http/Controllers/HighScoreController.php  Leaderboard JSON API
app/Models/HighScore.php                      Eloquent model
resources/views/game.blade.php                Game page
resources/css/app.css                         Design system and responsive styles
resources/js/app.js                           Game engine, renderer, UI, API client
public_html/                                  Web root (build output + index.php)
tests/Feature/HighScoreTest.php               Leaderboard API tests
tests/Feature/GamePageTest.php                Page and public-path tests
```

## API

| Method | Endpoint            | Description                                     |
| ------ | ------------------- | ----------------------------------------------- |
| GET    | `/api/scores?mode=` | Top 10 scores for `classic` or `portal`.        |
| POST   | `/api/scores`       | Save a finished run (CSRF protected, throttled). |

Example payload:

```json
{
  "name": "Neon Rookie",
  "score": 120,
  "apples": 4,
  "duration_ms": 15000,
  "mode": "classic"
}
```

Scores are sanity-checked server-side (`score <= apples * 50`) and ranked per mode.

## Controls

| Action  | Keys / input                      |
| ------- | --------------------------------- |
| Steer   | Arrow keys, WASD, swipe, or D-pad |
| Pause   | `Space`, `P`, or `Esc`            |
| Restart | `R` or the Restart button         |
| Start   | `Space` or the Play button        |

## Testing

```bash
php artisan test
```

The suite covers the game page, the custom public path, leaderboard ordering, validation, and score persistence.

## Production notes

- Run `npm run build` (or `npm ci && npm run build`) during deployment.
- `php artisan config:cache`, `route:cache`, and `view:cache` are safe to use.
- `public_html/build/` and `public_html/hot` are ignored by git; deploy the built assets.
- The leaderboard uses the default SQLite connection. Point `DB_CONNECTION` at MySQL/Postgres in `.env` for production and run `php artisan migrate --force`.
