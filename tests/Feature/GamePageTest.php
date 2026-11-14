<?php

namespace Tests\Feature;

use Tests\TestCase;

class GamePageTest extends TestCase
{
    public function test_the_game_page_loads(): void
    {
        $response = $this->get('/');

        $response
            ->assertOk()
            ->assertSee('Neon Snake')
            ->assertSee('id="board"', false)
            ->assertSee('Leaderboard');
    }

    public function test_the_application_public_path_is_public_html(): void
    {
        $this->assertSame(base_path('public_html'), app()->publicPath());
    }
}
