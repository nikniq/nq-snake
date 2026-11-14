<?php

use App\Http\Controllers\GameController;
use App\Http\Controllers\HighScoreController;
use Illuminate\Support\Facades\Route;

Route::get('/', GameController::class)->name('game');

Route::get('/api/scores', [HighScoreController::class, 'index'])->name('scores.index');
Route::post('/api/scores', [HighScoreController::class, 'store'])
    ->middleware('throttle:20,1')
    ->name('scores.store');
