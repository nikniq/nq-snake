<?php

namespace Tests\Feature;

use App\Models\HighScore;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class HighScoreTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_leaderboard_lists_scores_for_the_requested_mode(): void
    {
        HighScore::create(['name' => 'Classic Ace', 'score' => 500, 'apples' => 30, 'mode' => 'classic', 'duration_ms' => 60000]);
        HighScore::create(['name' => 'Portal Pro', 'score' => 300, 'apples' => 20, 'mode' => 'portal', 'duration_ms' => 45000]);
        HighScore::create(['name' => 'Portal Legend', 'score' => 900, 'apples' => 50, 'mode' => 'portal', 'duration_ms' => 90000]);

        $response = $this->getJson('/api/scores?mode=portal');

        $response
            ->assertOk()
            ->assertJsonPath('mode', 'portal')
            ->assertJsonCount(2, 'scores')
            ->assertJsonPath('scores.0.name', 'Portal Legend')
            ->assertJsonPath('scores.0.rank', 1)
            ->assertJsonPath('scores.1.name', 'Portal Pro');
    }

    public function test_an_unknown_mode_falls_back_to_classic(): void
    {
        $response = $this->getJson('/api/scores?mode=not-a-mode');

        $response->assertOk()->assertJsonPath('mode', 'classic');
    }

    public function test_a_score_can_be_saved_and_ranked(): void
    {
        HighScore::create(['name' => 'Early Bird', 'score' => 400, 'apples' => 20, 'mode' => 'classic', 'duration_ms' => 40000]);

        $response = $this->postJson('/api/scores', [
            'name' => '  Neon Rookie  ',
            'score' => 120,
            'apples' => 4,
            'duration_ms' => 15000,
            'mode' => 'classic',
        ]);

        $response
            ->assertCreated()
            ->assertJsonPath('saved', true)
            ->assertJsonPath('rank', 2)
            ->assertJsonPath('entry.name', 'Neon Rookie');

        $this->assertDatabaseHas('high_scores', [
            'name' => 'Neon Rookie',
            'score' => 120,
            'mode' => 'classic',
        ]);
    }

    public function test_names_and_modes_are_validated(): void
    {
        $base = [
            'name' => 'Player',
            'score' => 100,
            'apples' => 5,
            'duration_ms' => 10000,
            'mode' => 'classic',
        ];

        $this->postJson('/api/scores', ['name' => '   '] + $base)
            ->assertUnprocessable()
            ->assertJsonValidationErrors('name');

        $this->postJson('/api/scores', ['mode' => 'sideways'] + $base)
            ->assertUnprocessable()
            ->assertJsonValidationErrors('mode');

        $this->postJson('/api/scores', ['apples' => 0, 'score' => 50] + $base)
            ->assertUnprocessable()
            ->assertJsonValidationErrors('apples');
    }

    public function test_impossible_scores_are_rejected(): void
    {
        $response = $this->postJson('/api/scores', [
            'name' => 'Cheater',
            'score' => 1000000,
            'apples' => 2,
            'duration_ms' => 5000,
            'mode' => 'classic',
        ]);

        $response
            ->assertUnprocessable()
            ->assertJsonValidationErrors('score');

        $this->assertDatabaseCount('high_scores', 0);
    }
}
