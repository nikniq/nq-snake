<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class HighScore extends Model
{
    /**
     * The game modes that can be recorded on the leaderboard.
     */
    public const MODES = ['classic', 'portal'];

    protected $fillable = [
        'name',
        'score',
        'apples',
        'duration_ms',
        'mode',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'score' => 'integer',
            'apples' => 'integer',
            'duration_ms' => 'integer',
        ];
    }

    public function scopeForMode(Builder $query, string $mode): Builder
    {
        return $query->where('mode', $mode);
    }
}
