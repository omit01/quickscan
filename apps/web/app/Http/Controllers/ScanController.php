<?php

namespace App\Http\Controllers;

use App\Jobs\RunScan;
use App\Models\Scan;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ScanController extends Controller
{
    public function store(Request $request)
    {
        $data = $request->validate([
            'url' => ['required', 'string', 'url:http,https', 'max:2048'],
            'authorizedToScan' => ['required', 'accepted'],
            'activeSecurityChecksAuthorized' => ['required', 'boolean'],
            'formSubmissionTestingAuthorized' => ['sometimes', 'boolean'],
        ]);
        $data['formSubmissionTestingAuthorized'] = $data['formSubmissionTestingAuthorized'] ?? false;
        $parts = parse_url($data['url']);
        $host = strtolower(rtrim($parts['host'] ?? '', '.'));
        if (isset($parts['user']) || isset($parts['pass']) || (isset($parts['port']) && ! in_array($parts['port'], [80, 443], true))
            || ! str_contains($host, '.') || strlen($host) > 253
            || (filter_var($host, FILTER_VALIDATE_IP) && ! filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE))) {
            throw ValidationException::withMessages(['url' => 'Gebruik een publiek websiteadres zonder gebruikersgegevens of afwijkende poort.']);
        }
        $siteKey = preg_replace('/^www\./', '', $host);
        $scan = DB::transaction(function () use ($request, $data, $siteKey) {
            $user = User::whereKey($request->user()->id)->lockForUpdate()->firstOrFail();
            if (! $user->is_admin && Scan::where('user_id', $user->id)->whereIn('status', ['queued', 'running'])->count() >= 3) {
                throw ValidationException::withMessages(['url' => 'Er lopen al drie scans. Wacht tot er een klaar is.']);
            }
            
            // Check daily user limit (10 per day)
            $todayStart = now()->startOfDay();
            $userScansToday = Scan::where('user_id', $request->user()->id)
                ->where('created_at', '>=', $todayStart)
                ->count();
            if (! $user->is_admin && $userScansToday >= 10) {
                throw ValidationException::withMessages(['url' => 'Je hebt je dagelijks limiet van 10 scans bereikt. Probeer morgen opnieuw.']);
            }
            
            // Check global limit (100 per day)
            $totalScansToday = Scan::where('created_at', '>=', $todayStart)->count();
            if (! $user->is_admin && $totalScansToday >= 100) {
                throw ValidationException::withMessages(['url' => 'Het totaal aantal scans vandaag is bereikt, kom morgen terug.']);
            }
            $scan = Scan::create([
                'id' => (string) Str::uuid(),
                'user_id' => $request->user()->id,
                'url' => $data['url'],
                'site_key' => $siteKey,
                'active_security_checks' => $data['activeSecurityChecksAuthorized'],
                'form_submission_testing_authorized' => $data['formSubmissionTestingAuthorized'],
            ]);
            RunScan::dispatch($scan->id)->afterCommit();

            return $scan;
        });

        return response()->json($scan->refresh(), 202);
    }

    public function show(Request $request, Scan $scan)
    {
        abort_unless($scan->user_id === $request->user()->id, 404);

        return response()->json($scan)->header('Cache-Control', 'no-store');
    }

    public function retry(Request $request, Scan $scan)
    {
        abort_unless($scan->user_id === $request->user()->id, 404);

        DB::transaction(function () use ($request, $scan) {
            $user = User::whereKey($request->user()->id)->lockForUpdate()->firstOrFail();
            if (! $user->is_admin && Scan::where('user_id', $user->id)->whereIn('status', ['queued', 'running'])->count() >= 3) {
                throw ValidationException::withMessages(['url' => 'Er lopen al drie scans. Wacht tot er een klaar is.']);
            }
            $updated = Scan::whereKey($scan->id)->where('status', 'failed')->where('can_retry', true)->update([
                'status' => 'queued',
                'phase' => 'queued',
                'results' => null,
                'error' => null,
                'error_code' => null,
                'error_detail' => null,
                'can_retry' => false,
                'attempt' => 0,
                'completed_at' => null,
            ]);
            abort_unless($updated === 1, 422);
            RunScan::dispatch($scan->id)->afterCommit();
        });

        return response()->json($scan->refresh(), 202)->header('Cache-Control', 'no-store');
    }

    public function share(Request $request, Scan $scan)
    {
        abort_unless($scan->user_id === $request->user()->id, 404);
        abort_unless($scan->status === 'completed' && $scan->results !== null, 422);
        $score = $scan->weightedScore();
        if ($score === null) {
            throw ValidationException::withMessages(['score' => 'Delen kan pas als techniek en bezoekerservaring allebei beoordeeld zijn.']);
        }

        DB::table('shared_scores')->upsert([
            'site_key' => $scan->site_key,
            'scan_id' => $scan->id,
            'title' => $scan->results['home']['title'] ?: $scan->site_key,
            'url' => $scan->url,
            'score' => $score,
        ], ['site_key'], ['scan_id', 'title', 'url', 'score']);

        return response()->json(['shared' => true, 'score' => $score])->header('Cache-Control', 'no-store');
    }

    public function report(Request $request, Scan $scan, string $format)
    {
        abort_unless($scan->user_id === $request->user()->id && $scan->status === 'completed', 404);
        abort_unless(in_array($format, ['html', 'json'], true) && $scan->results !== null, 404);
        if ($format === 'json') {
            return response()->json($scan->results)
                ->header('Cache-Control', 'private, no-store')
                ->header('Content-Disposition', 'attachment; filename="quickscan-'.$scan->id.'.json"')
                ->header('X-Content-Type-Options', 'nosniff');
        }

        return response()->view('quickscan', ['pageData' => [
            'user' => ['name' => $request->user()->name],
            'csrfToken' => csrf_token(),
            'report' => [
                'id' => $scan->id, 'url' => $scan->url, 'results' => $scan->results,
                'score' => $scan->weightedScore(),
                'shared' => DB::table('shared_scores')->where('scan_id', $scan->id)->exists(),
            ],
        ]])->header('Cache-Control', 'private, no-store')->header('X-Content-Type-Options', 'nosniff');
    }

    public static function getScanLimitsForUser($userId)
    {
        $isAdmin = User::findOrFail($userId)->is_admin;
        $todayStart = now()->startOfDay();
        $userScansToday = Scan::where('user_id', $userId)
            ->where('created_at', '>=', $todayStart)
            ->count();
        $totalScansToday = Scan::where('created_at', '>=', $todayStart)->count();

        return [
            'isAdmin' => $isAdmin,
            'userScansToday' => $userScansToday,
            'userScansLimit' => $isAdmin ? null : 10,
            'totalScansToday' => $totalScansToday,
            'totalScansLimit' => $isAdmin ? null : 100,
        ];
    }
}