<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shared_scores', function (Blueprint $table) {
            $table->string('site_key', 253)->primary();
            $table->foreignUuid('scan_id')->constrained('scans')->cascadeOnDelete();
            $table->text('title');
            $table->text('url');
            $table->unsignedTinyInteger('score')->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shared_scores');
    }
};