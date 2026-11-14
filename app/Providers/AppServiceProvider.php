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
     */
    protected function ensureSqliteDatabase(): void
    {
        if (app()->runningInConsole() || config('database.default') !== 'sqlite') {
            return;
        }

        if (! config('app.auto_migrate', true)) {
            return;
        }

        $database = config('database.connections.sqlite.database');

        if (! is_string($database) || $database === ':memory:' || str_contains($database, '://')) {
            return;
        }

        if (! is_dir(dirname($database))) {
            return;
        }

        if (! file_exists($database) && ! @touch($database)) {
            return;
        }

        try {
            if (Schema::hasTable('migrations')) {
                return;
            }
        } catch (Throwable $exception) {
            report($exception);

            return;
        }

        $lock = @fopen(storage_path('framework/database-init.lock'), 'c');

        if ($lock === false) {
            return;
        }

        try {
            if (! flock($lock, LOCK_EX)) {
                return;
            }

            try {
                if (! Schema::hasTable('migrations')) {
                    Artisan::call('migrate', ['--force' => true]);
                }
            } catch (Throwable $exception) {
                report($exception);
            } finally {
                flock($lock, LOCK_UN);
            }
        } finally {
            fclose($lock);
        }
    }
}
