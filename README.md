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

## Operations & maintenance

Two executable helpers live in the project root.

### `./deploy.sh`

One-command deployment: pulls the branch, installs Composer/npm dependencies,
builds assets, runs migrations, fixes permissions, rebuilds caches, and performs
a health check. It enables maintenance mode for the duration of the deploy and
always tries to bring the site back up, including when a step fails.

```bash
cd /home/customer/www/snake.nikniq.com
./deploy.sh
```

Useful options:

```bash
./deploy.sh --no-pull          # deploy the current checkout
./deploy.sh --no-build         # skip npm (e.g. Node is not installed on the host)
./deploy.sh --no-migrate       # skip migrations
./deploy.sh --no-maintenance   # zero-downtime attempt (not recommended for deps)
./deploy.sh --dry-run          # print every step without changing anything
PHP_BIN=php8.5 ./deploy.sh     # choose the PHP CLI binary
```

Deployment logs are written to `storage/logs/deploy-*.log`.

If Node.js is unavailable on the host, build locally with `npm run build`, upload
`public_html/build/`, and deploy with `--no-build`.

### `./cx.sh`

Operations and maintenance console:

| Command | Purpose |
| ------- | ------- |
| `./cx.sh` / `status` | App, DB, storage, maintenance and git overview |
| `./cx.sh health [url]` | Check `/up` and the homepage (defaults to `APP_URL`) |
| `./cx.sh logs [lines]` | Tail `storage/logs/laravel.log` |
| `./cx.sh backup` | Archive `.env` + SQLite DB to `storage/backups` (keeps 10) |
| `./cx.sh restore <archive> [--yes]` | Restore a backup (creates a safety backup first) |
| `./cx.sh db` / `scores [n]` | Table row counts / leaderboard |
| `./cx.sh clear` / `optimize` | Clear or rebuild all Laravel caches |
| `./cx.sh migrate` / `test` | Run migrations / the test suite |
| `./cx.sh permissions` | Fix storage, cache, DB and build permissions |
| `./cx.sh schedule` | Run the scheduler once (for cron) |
| `./cx.sh down` / `up` | Toggle maintenance mode |
| `./cx.sh artisan <args>` | Any Artisan command passthrough |
| `./cx.sh deploy [opts]` | Delegate to `deploy.sh` |

Examples:

```bash
./cx.sh status
./cx.sh health https://snake.nikniq.com
./cx.sh scores 10
BACKUP_KEEP=14 ./cx.sh backup
./cx.sh restore storage/backups/neon-snake-20261114-123724.tar.gz --yes
CX_YES=1 ./cx.sh down
```

Cron examples:

```cron
# Scheduler
* * * * * cd /home/customer/www/snake.nikniq.com && ./cx.sh schedule >> storage/logs/cron.log 2>&1

# Nightly backup, retaining 14 archives
15 3 * * * cd /home/customer/www/snake.nikniq.com && BACKUP_KEEP=14 ./cx.sh backup >> storage/logs/backup.log 2>&1
```

Set `PHP_BIN=php8.5` if the CLI `php` differs from the PHP version used by the
website.

## Production notes

- Run `npm run build` (or `npm ci && npm run build`) during deployment.
- `php artisan config:cache`, `route:cache`, and `view:cache` are safe to use.
- `public_html/build/` and `public_html/hot` are ignored by git; deploy the built assets.
- The leaderboard uses the default SQLite connection. Point `DB_CONNECTION` at MySQL/Postgres in `.env` for production and run `php artisan migrate --force`.
- Set `APP_DEBUG=false` in production.

### Shared hosting / missing SQLite file

SQLite databases are gitignored, so a fresh deployment may not have
`database/database.sqlite`. The `AppServiceProvider` creates the file and runs
the migrations automatically on the first web request (guarded by a file lock
to avoid racing requests). This means a Git deployment starts working without
shell access.

The first request after deploying may take a moment while migrations run. On
subsequent requests only a lightweight `migrations` table check is performed.
Set `DB_AUTO_MIGRATE=false` if your deployment pipeline already runs
`php artisan migrate --force`.

To initialise the database ahead of time instead, run:

```bash
touch database/database.sqlite
php artisan migrate --force
```

If the app still reports that the database file does not exist, make sure the
`database/` directory is writable by PHP. If you prefer not to use SQLite, set
`DB_CONNECTION` and its credentials in `.env`, create the database, and run
`php artisan migrate --force`.
