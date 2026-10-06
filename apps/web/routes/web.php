<?php

use App\Http\Controllers\ScanController;
use App\Http\Controllers\SolController;
use App\Http\Middleware\RequireSolMember;
use App\Models\Scan;
use App\Services\SolIdentity;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

Route::get('/', function (Request $request, SolIdentity $identity) {
    $member = $request->user() && ($request->attributes->get('development_login') === true || $request->session()->get('membership_verified_at', 0) >= time() - config('quickscan.oidc.session_seconds'));
    
    $scanLimits = $member ? \App\Http\Controllers\ScanController::getScanLimitsForUser($request->user()->id) : null;

    return response()->view('quickscan', ['pageData' => [
        'user' => $member ? ['name' => $request->user()->name] : null,
        'uniqueSites' => DB::table('checked_sites')->count(),
        'topSites' => DB::table('shared_scores')->orderByDesc('score')->orderBy('site_key')->limit(10)->get(['title', 'url', 'score']),
        'scans' => $member ? Scan::where('user_id', $request->user()->id)->latest()->limit(10)->get(['id', 'url', 'status', 'phase', 'error', 'created_at']) : [],
        'authError' => $request->session()->get('auth_error'),
        'oidcConfigured' => $identity->configured(),
        'csrfToken' => csrf_token(),
        'scanLimits' => $scanLimits,
    ]])->header('Cache-Control', $request->user() || $request->session()->has('auth_error')
        ? 'private, no-store'
        : 'private, no-cache, max-age=0, must-revalidate');
});
Route::get('/api/stats', fn () => ['uniqueSites' => DB::table('checked_sites')->count()])->middleware('throttle:60,1');
Route::get('/auth/sol', [SolController::class, 'login'])->name('login')->middleware('throttle:10,1');
Route::get('/auth/sol/callback', [SolController::class, 'callback'])->middleware('throttle:20,1');
Route::post('/logout', [SolController::class, 'logout']);
Route::middleware(RequireSolMember::class)->group(function () {
    Route::post('/api/scans', [ScanController::class, 'store'])->middleware('throttle:scan-submissions');
    Route::get('/api/scans/{scan}', [ScanController::class, 'show'])->whereUuid('scan');
    Route::post('/api/scans/{scan}/share', [ScanController::class, 'share'])->whereUuid('scan')->middleware('throttle:20,1');
    Route::post('/api/scans/{scan}/feedback', [ScanController::class, 'feedback'])->whereUuid('scan')->middleware('throttle:5,10');
    Route::post('/api/scans/{scan}/retry', [ScanController::class, 'retry'])->whereUuid('scan')->middleware('throttle:scan-submissions');
    Route::get('/api/scans/{scan}/report.{format}', [ScanController::class, 'report'])->whereUuid('scan')->whereIn('format', ['html', 'json']);
});
