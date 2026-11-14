<?php

namespace App\Providers;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\ServiceProvider;
use Throwable;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->ensureSqliteDatabase();
    }

    /**
     * SQLite files are ignored by git, so a fresh deployment can be missing
     * its database. Create the file and run the migrations once, on the
     * first web request, so the app boots without manual server access.
     *
     * If the configured directory is not writable we fall back to a database
     * inside storage/. If SQLite still cannot be prepared, sessions and cache
     * fall back to file drivers so the site keeps serving requests.
     */
    protected function ensureSqliteDatabase(): void
    {
        if (app()->runningInConsole() || config('database.default') !== 'sqlite') {
            return;
        }

        if (! config('app.auto_migrate', true)) {
            return;
        }

        $configured = config('database.connections.sqlite.database');

        if (! is_string($configured) || $configured === ':memory:' || str_contains($configured, '://')) {
            return;
        }

        $database = $this->resolveWritableDatabase($configured);

        if ($database === null) {
            $this->useFileDrivers();

            return;
        }

        if (! file_exists($database) && ! @touch($database)) {
            $this->useFileDrivers();

            return;
        }

        try {
            if (Schema::hasTable('migrations')) {
                return;
            }
        } catch (Throwable $exception) {
            report($exception);
            $this->useFileDrivers();

            return;
        }

        $lock = @fopen(storage_path('framework/database-init.lock'), 'c');

        if ($lock === false) {
            $this->runMigrations();

            return;
        }

        try {
            if (! flock($lock, LOCK_EX)) {
                $this->runMigrations();

                return;
            }

            try {
                $this->runMigrations();
            } finally {
                flock($lock, LOCK_UN);
            }
        } finally {
            fclose($lock);
        }
    }

    /**
     * Return a database path that PHP can write to. When the configured
     * database directory is not writable, use storage/database.sqlite and
     * copy the existing database across when possible.
     */
    protected function resolveWritableDatabase(string $database): ?string
    {
        $directory = dirname($database);
        $fileIsWritable = ! file_exists($database) || is_writable($database);

        if (is_dir($directory) && is_writable($directory) && $fileIsWritable) {
            return $database;
        }

        $fallback = storage_path('database.sqlite');
        $fallbackDirectory = dirname($fallback);

        if (! is_dir($fallbackDirectory)) {
            @mkdir($fallbackDirectory, 0775, true);
        }

        if (! is_dir($fallbackDirectory) || ! is_writable($fallbackDirectory)) {
            return null;
        }

        if (! file_exists($fallback) && file_exists($database) && is_readable($database)) {
            @copy($database, $fallback);
        }

        config(['database.connections.sqlite.database' => $fallback]);

        @error_log("Neon Snake: configured SQLite path [{$database}] is not writable; using [{$fallback}].");

        return $fallback;
    }

    /**
     * Run pending migrations behind the database init lock.
     */
    protected function runMigrations(): void
    {
        try {
            if (! Schema::hasTable('migrations')) {
                Artisan::call('migrate', ['--force' => true]);
            }
        } catch (Throwable $exception) {
            report($exception);
            $this->useFileDrivers();
        }
    }

    /**
     * Keep the site online when SQLite cannot be prepared by using file
     * backed sessions and cache instead of database-backed drivers.
     */
    protected function useFileDrivers(): void
    {
        foreach (['framework/sessions', 'framework/cache/data', 'framework/views', 'logs'] as $directory) {
            $path = storage_path($directory);

            if (! is_dir($path)) {
                @mkdir($path, 0775, true);
            }
        }

        config([
            'session.driver' => 'file',
            'cache.default' => 'file',
        ]);

        @error_log('Neon Snake: falling back to file session/cache drivers because SQLite is unavailable.');
    }
}
