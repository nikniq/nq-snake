#!/usr/bin/env bash
#
# Neon Snake — deployment script
#
# Safe, idempotent deployment for this Laravel app on shared hosting:
# pull -> dependencies -> assets -> migrations -> caches -> permissions.
#
# Usage: ./deploy.sh [options]

set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BRANCH="${DEPLOY_BRANCH:-main}"
DO_PULL=1
DO_COMPOSER=1
DO_BUILD=0
DO_MIGRATE=1
DO_OPTIMIZE=1
USE_MAINTENANCE=1
ALLOW_DIRTY=0
DRY_RUN=0
PHP_BIN="${PHP_BIN:-}"
NPM_BIN="${NPM_BIN:-npm}"
MAINTENANCE_ACTIVE=0
START_TS=$SECONDS

usage() {
    cat <<'EOF'
Usage: ./deploy.sh [options]

Options:
  --no-pull          Skip git fetch/pull (deploy the current checkout)
  --no-composer      Skip composer install
  --build            Build frontend assets with npm (requires Node.js)
  --no-build         Use the committed public_html/build assets (default)
  --no-migrate       Skip database migrations
  --no-optimize      Skip clearing/rebuilding Laravel caches
  --no-maintenance   Do not enable maintenance mode during the deploy
  --allow-dirty      Allow tracked files to have uncommitted changes
  --branch <name>    Branch to deploy (default: main / DEPLOY_BRANCH)
  --dry-run          Print commands without executing them
  -h, --help         Show this help

Environment:
  PHP_BIN=php8.5     PHP CLI binary
  NPM_BIN=npm        npm binary
  DEPLOY_BRANCH=main Branch to pull
  DEPLOY_LOG=path    Custom log file
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --no-pull) DO_PULL=0 ;;
        --no-composer) DO_COMPOSER=0 ;;
        --build) DO_BUILD=1 ;;
        --no-build) DO_BUILD=0 ;;
        --no-migrate) DO_MIGRATE=0 ;;
        --no-optimize) DO_OPTIMIZE=0 ;;
        --no-maintenance) USE_MAINTENANCE=0 ;;
        --allow-dirty) ALLOW_DIRTY=1 ;;
        --branch)
            BRANCH="${2:-}"
            [ -n "$BRANCH" ] || { echo "error: --branch requires a value" >&2; exit 2; }
            shift
            ;;
        --branch=*) BRANCH="${1#*=}" ;;
        --dry-run) DRY_RUN=1 ;;
        -h|--help) usage; exit 0 ;;
        *)
            echo "error: unknown option: $1" >&2
            usage
            exit 2
            ;;
    esac
    shift
done

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

mkdir -p "$ROOT/storage/logs" 2>/dev/null || true
LOG_FILE="${DEPLOY_LOG:-$ROOT/storage/logs/deploy-$(date +%Y%m%d-%H%M%S).log}"
if ! touch "$LOG_FILE" 2>/dev/null; then
    LOG_FILE="/tmp/deploy-$(date +%Y%m%d-%H%M%S).log"
    touch "$LOG_FILE" 2>/dev/null || LOG_FILE=/dev/null
fi

log() {
    printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"
}

section() {
    log ""
    log "==> $*"
}

warn() {
    log "warning: $*"
}

die() {
    log "error: $*"
    exit 1
}

run() {
    log "\$ $*"
    if [ "$DRY_RUN" -eq 1 ]; then
        return 0
    fi
    "$@" 2>&1 | tee -a "$LOG_FILE"
}

env_value() {
    local key="$1" line
    [ -f "$ROOT/.env" ] || return 0

    line=$(grep -E "^[[:space:]]*${key}=" "$ROOT/.env" | tail -n 1 || true)
    [ -n "$line" ] || return 0

    line=${line#*=}
    line=${line%$'\r'}

    case "$line" in
        \"*\") line=${line#\"}; line=${line%\"} ;;
        \'*\') line=${line#\'}; line=${line%\'} ;;
    esac

    printf '%s' "$line"
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

artisan_available() {
    [ -f "$ROOT/artisan" ] && [ -f "$ROOT/vendor/autoload.php" ]
}

enable_maintenance() {
    if [ "$USE_MAINTENANCE" -eq 0 ]; then
        log "Maintenance mode: disabled by --no-maintenance"
        return 0
    fi

    if ! artisan_available; then
        warn "Skipping maintenance mode (vendor/autoload.php not present yet)."
        return 0
    fi

    if run "$PHP_BIN" "$ROOT/artisan" down --retry=60; then
        MAINTENANCE_ACTIVE=1
        log "Maintenance mode enabled."
    else
        warn "Could not enable maintenance mode; continuing."
    fi
}

disable_maintenance() {
    [ "$MAINTENANCE_ACTIVE" -eq 1 ] || return 0

    if ! artisan_available; then
        return 0
    fi

    set +e
    if [ "$DRY_RUN" -eq 1 ]; then
        log "(dry-run) \$ $PHP_BIN artisan up"
    elif "$PHP_BIN" "$ROOT/artisan" up >>"$LOG_FILE" 2>&1; then
        log "Maintenance mode disabled."
    else
        log "warning: could not disable maintenance mode. Run: $PHP_BIN artisan up"
    fi
    set -e

    MAINTENANCE_ACTIVE=0
}

health_check() {
    if ! command -v curl >/dev/null 2>&1; then
        warn "curl is not available; skipping the HTTP health check."
        return 0
    fi

    local url
    url=$(env_value APP_URL)

    if [ -z "$url" ]; then
        warn "APP_URL is not set; skipping the HTTP health check."
        return 0
    fi

    local endpoint code
    endpoint="${url%/}/up"
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$endpoint" 2>/dev/null || true)

    if [ "$code" = "200" ]; then
        log "Health check OK: $endpoint -> 200"
    else
        warn "Health check returned '${code:-no response}' for $endpoint."
    fi
}

on_error() {
    local line="$1"
    set +e
    log ""
    log "Deployment failed at line $line."
    disable_maintenance
    log "Fix the error above, then re-run ./deploy.sh."
    exit 1
}

on_signal() {
    set +e
    log ""
    log "Deployment interrupted."
    disable_maintenance
    exit 130
}

trap 'on_error $LINENO' ERR
trap on_signal INT TERM

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

section "Preflight"

[ -f "$ROOT/.env" ] || die ".env not found. Copy .env.example, configure it, and run again."
[ -f "$ROOT/composer.json" ] || die "composer.json not found in $ROOT."
grep -qE '^APP_KEY=[^[:space:]]+' "$ROOT/.env" || die "APP_KEY is empty. Generate it with: $PHP_BIN artisan key:generate"

if [ -z "$PHP_BIN" ]; then
    for candidate in php8.5 php8.4 php8.3 php; do
        if command -v "$candidate" >/dev/null 2>&1; then
            PHP_BIN="$candidate"
            break
        fi
    done
fi

[ -n "$PHP_BIN" ] || die "PHP CLI not found. Set PHP_BIN=/path/to/php."
command -v "$PHP_BIN" >/dev/null 2>&1 || die "PHP binary '$PHP_BIN' not found."

PHP_VERSION=$("$PHP_BIN" -r 'echo PHP_VERSION;' 2>/dev/null || true)
[ -n "$PHP_VERSION" ] || die "Could not execute $PHP_BIN."

"$PHP_BIN" -r 'exit(version_compare(PHP_VERSION, "8.3.0", ">=") ? 0 : 1);' \
    || die "PHP 8.3+ is required; $PHP_BIN reports $PHP_VERSION."

log "PHP: $PHP_VERSION ($PHP_BIN)"
log "Branch: $BRANCH"
if [ "$DRY_RUN" -eq 1 ]; then
    log "Mode: dry run (no changes will be made)"
fi

COMPOSER_CMD=()
if command -v composer >/dev/null 2>&1; then
    COMPOSER_CMD=(composer)
elif [ -f "$ROOT/composer.phar" ]; then
    COMPOSER_CMD=("$PHP_BIN" "$ROOT/composer.phar")
fi

if [ "$DO_COMPOSER" -eq 1 ] && [ "${#COMPOSER_CMD[@]}" -eq 0 ]; then
    die "Composer not found. Install it, or run with --no-composer."
fi

if [ "$DO_BUILD" -eq 1 ] && ! command -v "$NPM_BIN" >/dev/null 2>&1; then
    die "npm not found. Remove --build to use the committed public_html/build assets."
fi

if [ "$DO_PULL" -eq 1 ] && [ -d "$ROOT/.git" ] && command -v git >/dev/null 2>&1; then
    if [ "$ALLOW_DIRTY" -eq 0 ] && [ -n "$(git status --porcelain --untracked-files=no -- . ':(exclude)public_html/build' 2>/dev/null)" ]; then
        die "Tracked files have uncommitted changes. Commit/stash them or use --allow-dirty."
    fi
fi

# ---------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------

section "Maintenance mode"
enable_maintenance

section "Code update"
if [ "$DO_PULL" -eq 1 ]; then
    if [ -d "$ROOT/.git" ] && command -v git >/dev/null 2>&1; then
        CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
        if [ -n "$CURRENT_BRANCH" ] && [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
            run git checkout "$BRANCH"
        fi

        run git fetch origin "$BRANCH"

        # Older deployments kept public_html/build untracked. Remove it when
        # the incoming branch starts tracking the build so the pull can apply.
        if [ -d "$ROOT/public_html/build" ] \
            && ! git cat-file -e "HEAD:public_html/build/manifest.json" 2>/dev/null \
            && git cat-file -e "origin/$BRANCH:public_html/build/manifest.json" 2>/dev/null; then
            run rm -rf "$ROOT/public_html/build"
            log "Removed the untracked build directory so the committed assets can be deployed."
        fi

        # Generated assets may differ after a server-side --build. Reset them
        # so the pull can apply cleanly; they can be rebuilt afterwards.
        if ! git diff --quiet -- public_html/build 2>/dev/null; then
            run git checkout -- public_html/build
            log "Reset generated frontend assets before pulling."
        fi

        run git pull --ff-only origin "$BRANCH"
        log "Commit: $(git log -1 --format='%h %s' 2>/dev/null || echo unknown)"
    else
        warn "Git repository not found; skipping pull (use --no-pull to silence this)."
    fi
else
    log "Pull skipped (--no-pull)."
fi

section "PHP dependencies"
if [ "$DO_COMPOSER" -eq 1 ]; then
    run "${COMPOSER_CMD[@]}" install --no-dev --prefer-dist --no-interaction --optimize-autoloader
else
    log "Composer install skipped (--no-composer)."
fi

section "Project directories"
run mkdir -p "$ROOT/storage/framework/cache" \
    "$ROOT/storage/framework/sessions" \
    "$ROOT/storage/framework/views" \
    "$ROOT/storage/logs" \
    "$ROOT/storage/backups" \
    "$ROOT/bootstrap/cache"

DB_CONNECTION=$(env_value DB_CONNECTION)
DB_CONNECTION=${DB_CONNECTION:-sqlite}
DB_FILE=""

if [ "$DB_CONNECTION" = "sqlite" ]; then
    DB_FILE=$(env_value DB_DATABASE)

    if [ -z "$DB_FILE" ]; then
        DB_FILE="$ROOT/database/database.sqlite"
    fi

    case "$DB_FILE" in
        /*) ;;
        *) DB_FILE="$ROOT/$DB_FILE" ;;
    esac

    run mkdir -p "$(dirname "$DB_FILE")"

    if [ ! -f "$DB_FILE" ]; then
        run touch "$DB_FILE"
        log "Created SQLite database: $DB_FILE"
    fi
else
    log "Database driver: $DB_CONNECTION"
fi

section "Frontend assets"
if [ "$DO_BUILD" -eq 1 ]; then
    if [ -f "$ROOT/package-lock.json" ]; then
        run "$NPM_BIN" ci --no-audit --no-fund
    else
        run "$NPM_BIN" install --no-audit --no-fund
    fi
    run "$NPM_BIN" run build
else
    log "Using committed frontend assets in public_html/build (pass --build to rebuild)."
fi

if [ ! -f "$ROOT/public_html/build/manifest.json" ]; then
    die "public_html/build/manifest.json is missing. Run 'npm run build' locally and commit the result, or deploy with --build on a host with Node.js."
fi

section "Database migrations"
if [ "$DO_MIGRATE" -eq 1 ]; then
    run "$PHP_BIN" "$ROOT/artisan" migrate --force --no-interaction
else
    log "Migrations skipped (--no-migrate)."
fi

section "Permissions"
run chmod -R ug+rwX "$ROOT/storage" "$ROOT/bootstrap/cache"

if [ -f "$ROOT/.env" ]; then
    run chmod 640 "$ROOT/.env" || warn "Could not set .env permissions."
fi

if [ -n "$DB_FILE" ] && [ -f "$DB_FILE" ]; then
    run chmod 664 "$DB_FILE" || warn "Could not set database permissions."
fi

if [ -d "$ROOT/public_html/build" ]; then
    run chmod -R u+rwX,go+rX "$ROOT/public_html/build" || warn "Could not set build permissions."
fi

section "Application caches"
if [ "$DO_OPTIMIZE" -eq 1 ]; then
    run "$PHP_BIN" "$ROOT/artisan" optimize:clear
    run "$PHP_BIN" "$ROOT/artisan" optimize
else
    log "Cache optimization skipped (--no-optimize)."
fi

section "Maintenance mode"
disable_maintenance

section "Health check"
health_check

section "Deployment complete"
log "Branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
log "Commit: $(git log -1 --format='%h %s' 2>/dev/null || echo unknown)"
log "Duration: $((SECONDS - START_TS))s"

if [ "$DRY_RUN" -eq 1 ]; then
    log "Dry run finished. No changes were made."
else
    log "Deployment finished. Web root: public_html/"
fi

log "Log file: $LOG_FILE"

exit 0


