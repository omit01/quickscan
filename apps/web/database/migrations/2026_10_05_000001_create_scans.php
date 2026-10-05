<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('oidc_key', 64)->nullable()->unique();
            $table->string('password')->nullable()->change();
        });
        Schema::create('scans', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->text('url');
            $table->string('site_key', 253)->index();
            $table->boolean('active_security_checks')->default(false);
            $table->string('status')->default('queued');
            $table->string('phase')->default('queued');
            $table->text('error')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();
            $table->index(['user_id', 'status']);
        });
        Schema::create('checked_sites', function (Blueprint $table) {
            $table->string('hostname', 253)->primary();
            $table->timestamp('first_checked_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('checked_sites');
        Schema::dropIfExists('scans');
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn('oidc_key'));
    }
};