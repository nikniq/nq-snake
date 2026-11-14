#!/usr/bin/env bash
#
# Neon Snake — operations & maintenance console
#
# Usage: ./cx.sh <command> [arguments]
# Run ./cx.sh help for the full command list.

set -uo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PHP_BIN="${PHP_BIN:-}"
NPM_BIN="${NPM_BIN:-npm}"

if [ -t 1 ]; then
    BOLD=$'\033[1m'
    DIM=$'\033[2m'
    RED=$'\033[31m'
    GREEN=$'\033[32m'
    YELLOW=$'\033[33m'
    CYAN=$'\033[36m'
    RESET=$'\033[0m'
else
    BOLD=""
    DIM=""
    RED=""
    GREEN=""
    YELLOW=""
    CYAN=""
    RESET=""
fi

usage() {
    cat <<'EOF'
Neon Snake — operations & maintenance

Usage: ./cx.sh <command> [arguments]

Commands:
  status | info       Application, database, storage and git overview
  health [url]        HTTP check for /up and / (defaults to APP_URL / CX_URL)
  logs [lines]        Tail storage/logs/laravel.log (default 50)
  clear               Clear config, route, view and event caches
  optimize            Rebuild the production caches
  migrate             Run pending migrations (--force)
  test                Run the test suite
  db                  Database file and schema summary
  scores [limit]      Show the leaderboard (default 10)
  backup              Archive .env and the SQLite database
  restore <file>      Restore a backup (use --yes or CX_YES=1)
  permissions         Fix storage/cache/database permissions
  schedule            Run the scheduler once (for cron)
  down [--yes]        Enable maintenance mode
  up                  Disable maintenance mode
  artisan <args...>   Run any artisan command
  deploy [options]    Delegate to ./deploy.sh
  version             Print PHP/Laravel/git versions
  help                Show this help

Environment:
  PHP_BIN=php8.5      PHP CLI binary
  CX_YES=1            Assume yes for prompts
  BACKUP_KEEP=10      Number of backups to retain
  CX_URL=...          Default URL for health checks

Cron example:
  * * * * * cd /home/customer/www/snake.nikniq.com && ./cx.sh schedule >> storage/logs/cron.log 2>&1
EOF
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

die() {
    printf '%serror:%s %s\n' "$RED" "$RESET" "$*" >&2
    exit 1
}

warn() {
    printf '%swarning:%s %s\n' "$YELLOW" "$RESET" "$*" >&2
}

heading() {
    printf '\n%s==> %s%s\n' "$BOLD" "$*" "$RESET"
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

detect_php() {
    if [ -n "$PHP_BIN" ]; then
        return 0
    fi

    local candidate
    for candidate in php8.5 php8.4 php8.3 php; do
        if command -v "$candidate" >/dev/null 2>&1; then
            PHP_BIN="$candidate"
            return 0
        fi
    done

    PHP_BIN="php"
}

detect_php

require_project() {
    [ -f "$ROOT/artisan" ] || die "artisan not found in $ROOT."
    [ -f "$ROOT/vendor/autoload.php" ] || die "Dependencies are not installed. Run ./deploy.sh or composer install."
    command -v "$PHP_BIN" >/dev/null 2>&1 || die "PHP binary '$PHP_BIN' not found. Set PHP_BIN."
}

artisan_run() {
    require_project
    "$PHP_BIN" "$ROOT/artisan" "$@"
}

confirm() {
    if [ "${CX_YES:-0}" = "1" ]; then
        return 0
    fi

    printf '%s [y/N] ' "$1"
    read -r reply || return 1

    case "$reply" in
        y|Y|yes|YES) return 0 ;;
        *) return 1 ;;
    esac
}

db_file() {
    local connection path
    connection=$(env_value DB_CONNECTION)
    connection=${connection:-sqlite}

    [ "$connection" = "sqlite" ] || return 1

    path=$(env_value DB_DATABASE)

    if [ -z "$path" ]; then
        path="$ROOT/database/database.sqlite"
    fi

    case "$path" in
        /*) ;;
        *) path="$ROOT/$path" ;;
    esac

    printf '%s' "$path"
}

# ---------------------------------------------------------------------------
# Info commands
# ---------------------------------------------------------------------------

php_version() {
    "$PHP_BIN" -r 'echo PHP_VERSION;' 2>/dev/null || echo "not available"
}

laravel_version() {
    if [ -f "$ROOT/artisan" ] && [ -f "$ROOT/vendor/autoload.php" ]; then
        artisan_run --version 2>/dev/null | head -n 1 || echo "unknown"
    else
        echo "not installed"
    fi
}

git_summary() {
    if command -v git >/dev/null 2>&1 && [ -d "$ROOT/.git" ]; then
        local branch commit changes
        branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
        commit=$(git log -1 --format='%h %s' 2>/dev/null || echo "unknown")
        changes=$(git status --porcelain --untracked-files=no 2>/dev/null | wc -l | tr -d ' ')
        printf '%s @ %s (%s changed files)' "$branch" "$commit" "$changes"
    else
        printf 'not a git checkout'
    fi
}

sqlite_count() {
    local file="$1" table="$2"

    DB_FILE_PATH="$file" DB_TABLE="$table" "$PHP_BIN" <<'PHP' 2>/dev/null || echo "?"
<?php
$path = getenv('DB_FILE_PATH');
$table = getenv('DB_TABLE');

if (! is_file($path)) {
    echo '0';
    exit;
}

try {
    $pdo = new PDO('sqlite:'.$path);
    $stmt = $pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ".$pdo->quote($table));
    echo $stmt->fetchColumn() ? (int) $pdo->query('SELECT COUNT(*) FROM "'.$table.'"')->fetchColumn() : 0;
} catch (Throwable $e) {
    echo '?';
}
PHP
}

cmd_version() {
    printf '%sNeon Snake%s\n' "$BOLD" "$RESET"
    printf 'Project: %s\n' "$ROOT"
    printf 'PHP:     %s (%s)\n' "$(php_version)" "$PHP_BIN"
    printf 'Laravel: %s\n' "$(laravel_version)"
    printf 'Git:     %s\n' "$(git_summary)"
}

cmd_status() {
    heading "Neon Snake status"

    local app_env app_debug app_url maintenance storage_ok cache_ok db_dir_ok
    app_env=$(env_value APP_ENV)
    app_env=${app_env:-unknown}
    app_debug=$(env_value APP_DEBUG)
    app_url=$(env_value APP_URL)

    printf 'Generated:    %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')"
    printf 'Project:      %s\n' "$ROOT"
    printf 'PHP CLI:      %s (%s)\n' "$(php_version)" "$PHP_BIN"
    printf 'Laravel:      %s\n' "$(laravel_version)"
    printf 'Environment:  %s (debug: %s)\n' "$app_env" "${app_debug:-unknown}"
    printf 'URL:          %s\n' "${app_url:-not set}"

    if [ -f "$ROOT/storage/framework/maintenance.php" ]; then
        printf 'Maintenance:  %sON%s\n' "$RED" "$RESET"
    else
        printf 'Maintenance:  %sOFF%s\n' "$GREEN" "$RESET"
    fi

    printf 'Git:          %s\n' "$(git_summary)"

    storage_ok="no"
    cache_ok="no"
    db_dir_ok="no"
    [ -w "$ROOT/storage" ] && storage_ok="yes"
    [ -w "$ROOT/bootstrap/cache" ] && cache_ok="yes"
    [ -w "$ROOT/database" ] && db_dir_ok="yes"

    printf 'Storage:      writable=%s, bootstrap/cache writable=%s\n' "$storage_ok" "$cache_ok"
    printf 'Database dir: writable=%s\n' "$db_dir_ok"

    local connection file
    connection=$(env_value DB_CONNECTION)
    connection=${connection:-sqlite}
    printf 'Database:     %s\n' "$connection"

    if file=$(db_file); then
        if [ -f "$file" ]; then
            printf 'SQLite file:  %s (%s)\n' "$file" "$(du -h "$file" 2>/dev/null | cut -f1)"
            printf 'Leaderboard:  %s scores, %s sessions\n' \
                "$(sqlite_count "$file" high_scores)" \
                "$(sqlite_count "$file" sessions)"
        else
            printf 'SQLite file:  %s (missing)\n' "$file"
        fi
    fi

    printf 'Disk:         %s\n' "$(df -h "$ROOT" 2>/dev/null | awk 'NR==2 {print $4 " free of " $2}')"
}

cmd_health() {
    local url="${1:-${CX_URL:-$(env_value APP_URL)}}"

    [ -n "$url" ] || die "No URL given. Pass one: ./cx.sh health https://example.com"
    command -v curl >/dev/null 2>&1 || die "curl is required for health checks."

    heading "HTTP health check"
    local failed=0 code endpoint

    for endpoint in "${url%/}/up" "${url%/}/"; do
        code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time "${CX_TIMEOUT:-15}" "$endpoint" 2>/dev/null || true)
        if [ "$code" = "200" ]; then
            printf '%sOK%s   %-55s %s\n' "$GREEN" "$RESET" "$endpoint" "$code"
        else
            printf '%sFAIL%s %-55s %s\n' "$RED" "$RESET" "$endpoint" "${code:-no response}"
            failed=1
        fi
    done

    return "$failed"
}

cmd_logs() {
    local lines="${1:-50}" file="$ROOT/storage/logs/laravel.log"

    case "$lines" in
        ''|*[!0-9]*) die "Line count must be a number." ;;
    esac

    [ -f "$file" ] || die "Log file not found: $file"
    tail -n "$lines" "$file"
}

# ---------------------------------------------------------------------------
# Application commands
# ---------------------------------------------------------------------------

cmd_clear() {
    heading "Clearing caches"
    artisan_run optimize:clear
}

cmd_optimize() {
    heading "Rebuilding caches"
    artisan_run optimize:clear
    artisan_run optimize
}

cmd_migrate() {
    heading "Running migrations"
    artisan_run migrate --force --no-interaction
}

cmd_test() {
    heading "Running the test suite"
    artisan_run test
}

# ---------------------------------------------------------------------------
# Database commands
# ---------------------------------------------------------------------------

cmd_db() {
    heading "Database"

    local connection file
    connection=$(env_value DB_CONNECTION)
    connection=${connection:-sqlite}
    printf 'Driver: %s\n' "$connection"

    if ! file=$(db_file); then
        die "This command inspects SQLite only. Use: ./cx.sh artisan db:show"
    fi

    [ -f "$file" ] || die "Database file not found: $file"

    printf 'File:   %s\n' "$file"
    printf 'Size:   %s\n\n' "$(du -h "$file" 2>/dev/null | cut -f1)"

    DB_FILE_PATH="$file" "$PHP_BIN" <<'PHP'
<?php
$path = getenv('DB_FILE_PATH');

try {
    $pdo = new PDO('sqlite:'.$path);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $tables = $pdo->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")->fetchAll(PDO::FETCH_COLUMN);
} catch (Throwable $e) {
    fwrite(STDERR, 'Could not open database: '.$e->getMessage()."\n");
    exit(1);
}

if (! $tables) {
    echo "No tables found. Run ./cx.sh migrate.\n";
    exit(0);
}

printf("%-28s %10s\n", 'Table', 'Rows');
printf("%'-40s\n", '');

foreach ($tables as $table) {
    $count = $pdo->query('SELECT COUNT(*) FROM "'.$table.'"')->fetchColumn();
    printf("%-28s %10d\n", $table, $count);
}
PHP
}

cmd_scores() {
    local limit="${1:-10}" file

    case "$limit" in
        ''|*[!0-9]*) die "Limit must be a number." ;;
    esac

    if ! file=$(db_file); then
        die "Leaderboard inspection requires the SQLite driver."
    fi

    [ -f "$file" ] || die "Database file not found: $file"

    heading "Leaderboard (top $limit)"

    DB_FILE_PATH="$file" DB_LIMIT="$limit" "$PHP_BIN" <<'PHP'
<?php
$path = getenv('DB_FILE_PATH');
$limit = max(1, (int) getenv('DB_LIMIT'));

try {
    $pdo = new PDO('sqlite:'.$path);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $rows = $pdo->query(
        'SELECT name, score, apples, mode FROM high_scores ORDER BY score DESC, created_at ASC LIMIT '.$limit
    )->fetchAll(PDO::FETCH_ASSOC);
} catch (Throwable $e) {
    fwrite(STDERR, 'Could not read high_scores: '.$e->getMessage()."\n");
    exit(1);
}

if (! $rows) {
    echo "No scores recorded yet.\n";
    exit(0);
}

printf("%-4s %-20s %8s %8s %10s\n", '#', 'Name', 'Score', 'Apples', 'Mode');
printf("%'-56s\n", '');

$rank = 0;
foreach ($rows as $row) {
    printf("%-4d %-20s %8d %8d %10s\n", ++$rank, substr($row['name'], 0, 20), $row['score'], $row['apples'], $row['mode']);
}
PHP
}

# ---------------------------------------------------------------------------
# Backup & restore
# ---------------------------------------------------------------------------

cmd_backup() {
    heading "Backup"

    local backup_dir="$ROOT/storage/backups"
    local keep="${BACKUP_KEEP:-10}"
    local stamp archive tmp db

    mkdir -p "$backup_dir" || die "Could not create $backup_dir"
    chmod 700 "$backup_dir" 2>/dev/null || true

    stamp=$(date +%Y%m%d-%H%M%S)
    archive="$backup_dir/neon-snake-${stamp}.tar.gz"
    tmp=$(mktemp -d "${TMPDIR:-/tmp}/neon-snake.XXXXXX") || die "Could not create a temporary directory."

    if db=$(db_file) && [ -f "$db" ]; then
        if command -v sqlite3 >/dev/null 2>&1; then
            if ! sqlite3 "$db" ".backup '$tmp/database.sqlite'"; then
                rm -rf "$tmp"
                die "SQLite backup failed."
            fi
        else
            cp "$db" "$tmp/database.sqlite" || {
                rm -rf "$tmp"
                die "Could not copy the database."
            }
        fi
        printf 'Database: %s\n' "$db"
    else
        warn "No SQLite database found; backing up .env only."
    fi

    if [ -f "$ROOT/.env" ]; then
        cp "$ROOT/.env" "$tmp/.env" || {
            rm -rf "$tmp"
            die "Could not copy .env."
        }
        chmod 600 "$tmp/.env" 2>/dev/null || true
    fi

    if ! tar -czf "$archive" -C "$tmp" .; then
        rm -rf "$tmp"
        die "Could not create the archive."
    fi

    rm -rf "$tmp"
    chmod 600 "$archive" 2>/dev/null || true

    printf 'Archive:  %s\n' "$archive"
    printf 'Size:     %s\n' "$(du -h "$archive" 2>/dev/null | cut -f1)"

    case "$keep" in
        ''|*[!0-9]*) keep=10 ;;
    esac

    if [ "$keep" -gt 0 ]; then
        local old
        while IFS= read -r old; do
            [ -n "$old" ] && rm -f "$old"
        done < <(ls -1t "$backup_dir"/neon-snake-*.tar.gz 2>/dev/null | tail -n +$((keep + 1)))

        printf 'Retention: keeping the newest %s backup(s) in storage/backups\n' "$keep"
    fi
}

cmd_restore() {
    local archive="" arg tmp stamp db
    local assume_yes=0

    for arg in "$@"; do
        case "$arg" in
            --yes|-y) assume_yes=1 ;;
            *) archive="$arg" ;;
        esac
    done

    [ -n "$archive" ] || die "Usage: ./cx.sh restore <backup.tar.gz> [--yes]"
    [ -f "$archive" ] || die "Backup not found: $archive"

    heading "Restore backup"
    printf 'Archive: %s\n\nContents:\n' "$archive"
    tar -tzf "$archive" | sed 's/^/  /'

    if tar -tzf "$archive" | grep -qE '^/|(^|/)\.\.(/|$)'; then
        die "Refusing to restore an archive with absolute or parent-directory paths."
    fi

    if [ "$assume_yes" -ne 1 ] && [ "${CX_YES:-0}" != "1" ]; then
        confirm "Restore .env and the SQLite database from this archive?" || {
            printf 'Aborted.\n'
            exit 0
        }
    fi

    printf '\nCreating a safety backup before restoring...\n'
    cmd_backup

    tmp=$(mktemp -d "${TMPDIR:-/tmp}/neon-restore.XXXXXX") || die "Could not create a temporary directory."
    stamp=$(date +%Y%m%d-%H%M%S)

    if ! tar -xzf "$archive" -C "$tmp"; then
        rm -rf "$tmp"
        die "Could not extract the archive."
    fi

    if [ ! -f "$tmp/.env" ] && [ ! -f "$tmp/database.sqlite" ]; then
        rm -rf "$tmp"
        die "The archive does not contain .env or database.sqlite."
    fi

    if [ -f "$tmp/.env" ]; then
        if [ -f "$ROOT/.env" ]; then
            cp "$ROOT/.env" "$ROOT/.env.before-restore-$stamp" || true
        fi
        cp "$tmp/.env" "$ROOT/.env" || {
            rm -rf "$tmp"
            die "Could not restore .env."
        }
        chmod 640 "$ROOT/.env" 2>/dev/null || true
        printf 'Restored .env (previous version saved as .env.before-restore-%s)\n' "$stamp"
    fi

    if [ -f "$tmp/database.sqlite" ]; then
        if ! db=$(db_file); then
            rm -rf "$tmp"
            die "The archive contains SQLite data, but the app is not configured for SQLite."
        fi

        mkdir -p "$(dirname "$db")"
        cp "$tmp/database.sqlite" "$db" || {
            rm -rf "$tmp"
            die "Could not restore the database."
        }
        chmod 664 "$db" 2>/dev/null || true
        printf 'Restored database: %s\n' "$db"
    fi

    rm -rf "$tmp"

    if [ -f "$ROOT/artisan" ] && [ -f "$ROOT/vendor/autoload.php" ]; then
        printf '\nClearing caches...\n'
        artisan_run optimize:clear
    fi

    printf '\nRestore complete.\n'
}

# ---------------------------------------------------------------------------
# Maintenance commands
# ---------------------------------------------------------------------------

cmd_permissions() {
    heading "Fixing permissions"

    mkdir -p "$ROOT/storage/framework/cache" \
        "$ROOT/storage/framework/sessions" \
        "$ROOT/storage/framework/views" \
        "$ROOT/storage/logs" \
        "$ROOT/storage/backups" \
        "$ROOT/bootstrap/cache"

    chmod -R ug+rwX "$ROOT/storage" "$ROOT/bootstrap/cache" || warn "Could not update storage permissions."

    if [ -f "$ROOT/.env" ]; then
        chmod 640 "$ROOT/.env" 2>/dev/null || true
    fi

    local db
    if db=$(db_file) && [ -f "$db" ]; then
        chmod 664 "$db" 2>/dev/null || true
        printf 'Database: %s\n' "$db"
    fi

    if [ -d "$ROOT/public_html/build" ]; then
        chmod -R u+rwX,go+rX "$ROOT/public_html/build" 2>/dev/null || warn "Could not update build permissions."
    fi

    printf 'Permissions updated.\n'
}

cmd_schedule() {
    heading "Running scheduler"
    artisan_run schedule:run
}

cmd_down() {
    local assume_yes=0

    if [ "${1:-}" = "--yes" ] || [ "${1:-}" = "-y" ]; then
        assume_yes=1
    fi

    if [ "$assume_yes" -ne 1 ] && [ "${CX_YES:-0}" != "1" ]; then
        confirm "Enable maintenance mode?" || {
            printf 'Aborted.\n'
            exit 0
        }
    fi

    heading "Enabling maintenance mode"
    artisan_run down --retry=60
    printf 'Maintenance mode is ON. Bring it back with: ./cx.sh up\n'
}

cmd_up() {
    heading "Disabling maintenance mode"
    artisan_run up
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

cmd="${1:-status}"

if [ $# -gt 0 ]; then
    shift
fi

case "$cmd" in
    status|info) cmd_status ;;
    health) cmd_health "$@" ;;
    logs) cmd_logs "$@" ;;
    clear|cc) cmd_clear ;;
    optimize) cmd_optimize ;;
    migrate) cmd_migrate ;;
    test) cmd_test ;;
    db) cmd_db ;;
    scores) cmd_scores "$@" ;;
    backup) cmd_backup ;;
    restore) cmd_restore "$@" ;;
    permissions|perms) cmd_permissions ;;
    schedule|cron) cmd_schedule ;;
    down) cmd_down "$@" ;;
    up) cmd_up ;;
    artisan)
        require_project
        exec "$PHP_BIN" "$ROOT/artisan" "$@"
        ;;
    deploy)
        exec bash "$ROOT/deploy.sh" "$@"
        ;;
    version|-v|--version) cmd_version ;;
    help|-h|--help) usage ;;
    *)
        usage >&2
        die "Unknown command: $cmd"
        ;;
esac




