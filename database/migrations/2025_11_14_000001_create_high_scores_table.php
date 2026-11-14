<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('high_scores', function (Blueprint $table) {
            $table->id();
            $table->string('name', 20);
            $table->unsignedInteger('score');
            $table->unsignedInteger('apples')->default(0);
            $table->unsignedInteger('duration_ms')->default(0);
            $table->string('mode', 16)->default('classic');
            $table->timestamps();

            $table->index(['mode', 'score']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('high_scores');
    }
};
