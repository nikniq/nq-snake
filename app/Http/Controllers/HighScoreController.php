<?php

namespace App\Http\Controllers;

use App\Models\HighScore;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class HighScoreController extends Controller
{
    /**
     * Return the top scores for a game mode.
     */
    public function index(Request $request): JsonResponse
    {
        $mode = $request->string('mode', 'classic')->toString();

        if (! in_array($mode, HighScore::MODES, true)) {
            $mode = 'classic';
        }

        $scores = HighScore::query()
            ->forMode($mode)
            ->orderByDesc('score')
            ->orderBy('created_at')
            ->limit(10)
            ->get()
            ->values()
            ->map(fn (HighScore $score, int $index) => [
                'rank' => $index + 1,
                'name' => $score->name,
                'score' => $score->score,
                'apples' => $score->apples,
                'duration_ms' => $score->duration_ms,
                'mode' => $score->mode,
                'played_at' => $score->created_at?->toIso8601String(),
            ]);

        return response()->json([
            'mode' => $mode,
            'scores' => $scores,
        ]);
    }

    /**
     * Persist a finished run on the leaderboard.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:20'],
            'score' => ['required', 'integer', 'min:1', 'max:1000000'],
            'apples' => ['required', 'integer', 'min:1', 'max:100000'],
            'duration_ms' => ['required', 'integer', 'min:0', 'max:86400000'],
            'mode' => ['required', 'string', Rule::in(HighScore::MODES)],
        ]);

        $data['name'] = trim(strip_tags($data['name']));

        if ($data['name'] === '') {
            throw ValidationException::withMessages([
                'name' => 'Please enter a name.',
            ]);
        }

        // Each apple is worth at most 50 points, so this keeps bogus
        // client-submitted scores out of the leaderboard.
        if ($data['score'] > $data['apples'] * 50) {
            throw ValidationException::withMessages([
                'score' => 'That score does not match the apples collected.',
            ]);
        }

        $highScore = HighScore::create($data);

        $rank = HighScore::query()
            ->forMode($highScore->mode)
            ->where('score', '>', $highScore->score)
            ->count() + 1;

        return response()->json([
            'saved' => true,
            'rank' => $rank,
            'entry' => [
                'name' => $highScore->name,
                'score' => $highScore->score,
                'apples' => $highScore->apples,
                'mode' => $highScore->mode,
                'played_at' => $highScore->created_at?->toIso8601String(),
            ],
        ], 201);
    }
}
