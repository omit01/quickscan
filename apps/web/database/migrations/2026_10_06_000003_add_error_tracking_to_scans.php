<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('scans', function (Blueprint $table) {
            $table->string('error_code')->nullable()->after('error');
            $table->text('error_detail')->nullable()->after('error_code');
            $table->boolean('can_retry')->default(false)->after('error_detail');
            $table->unsignedTinyInteger('attempt')->default(0)->after('can_retry');
        });
    }

    public function down(): void
    {
        Schema::table('scans', function (Blueprint $table) {
            $table->dropColumn(['error_code', 'error_detail', 'can_retry', 'attempt']);
        });
    }
};
