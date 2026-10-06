<?php

namespace Tests\Feature;

use App\Jobs\RunScan;
use App\Models\Scan;
use App\Models\User;
use App\Services\SolIdentity;
use App\Services\SolClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

class QuickscanTest extends TestCase
{
    use RefreshDatabase;

    public function test_weighted_score_excludes_unassessed_results_and_requires_both_categories(): void
    {
        $scan = new Scan(['results' => [
            'technical' => [
                'https' => ['status' => 'pass', 'score' => 100],
                'mobile' => ['status' => 'fail', 'score' => 0],
                'pagespeed' => ['status' => 'unavailable', 'score' => 0],
            ],
            'ai' => ['criteria' => [
                'beeldgebruik' => ['score' => 5],
                'taalgebruik' => ['score' => 3],
                'actualiteit' => ['score' => 1, 'insufficientEvidence' => true],
            ]],
        ]]);
        $this->assertSame(65, $scan->weightedScore());
        $scan->results = ['technical' => ['https' => ['status' => 'pass', 'score' => 100]]];
        $this->assertNull($scan->weightedScore());
        $scan->results = ['ai' => ['criteria' => ['beeldgebruik' => ['score' => 5]]]];
        $this->assertNull($scan->weightedScore());
        $scan->results = null;
        $this->assertNull($scan->weightedScore());
    }

    public function test_sharing_publishes_only_server_score_and_one_entry_per_website(): void
    {
        $this->member();
        $this->withoutVite();
        $scan = Scan::create([
            'id' => (string) Str::uuid(), 'user_id' => auth()->id(),
            'url' => 'https://www.example.com', 'site_key' => 'example.com', 'status' => 'completed',
            'results' => [
                'home' => ['title' => 'Scouting Voorbeeld', 'url' => 'https://www.example.com'],
                'technical' => ['https' => ['status' => 'pass', 'score' => 100, 'detail' => 'Privaat advies']],
                'ai' => ['criteria' => ['beeldgebruik' => ['score' => 3]]],
                'generatedAt' => now()->toISOString(),
            ],
        ]);
        $this->get('/')->assertViewHas('pageData', fn ($data) => count($data['topSites']) === 0);
        $this->postJson('/api/scans/'.$scan->id.'/share', ['score' => 100, 'url' => 'https://other.example'])
            ->assertOk()->assertExactJson(['shared' => true, 'score' => 80]);
        $this->postJson('/api/scans/'.$scan->id.'/share')->assertOk();
        $this->assertDatabaseCount('shared_scores', 1);
        $this->assertDatabaseHas('shared_scores', ['site_key' => 'example.com', 'score' => 80, 'url' => $scan->url]);
        $this->get('/api/scans/'.$scan->id.'/report.html')->assertViewHas('pageData', fn ($data) => $data['report']['score'] === 80 && $data['report']['shared']);

        $newScan = $scan->replicate();
        $newScan->id = (string) Str::uuid();
        $newScan->url = 'http://example.com';
        $newScan->save();
        $this->postJson('/api/scans/'.$newScan->id.'/share')->assertOk();
        $this->assertDatabaseCount('shared_scores', 1);
        $this->assertDatabaseHas('shared_scores', ['scan_id' => $newScan->id, 'url' => $newScan->url]);

        auth()->logout();
        $this->get('/')->assertOk()->assertViewHas('pageData', function ($data) use ($newScan) {
            return (array) $data['topSites'][0] === ['title' => 'Scouting Voorbeeld', 'url' => $newScan->url, 'score' => 80];
        });
        $this->get('/api/scans/'.$scan->id.'/report.html')->assertRedirect('/auth/sol');
        $this->postJson('/api/scans/'.$scan->id.'/share')->assertUnauthorized();
        $this->member();
        $this->postJson('/api/scans/'.$scan->id.'/share')->assertNotFound();
    }

    public function test_sharing_rejects_pending_failed_and_incomplete_scans(): void
    {
        $this->member();
        $scan = Scan::create([
            'id' => (string) Str::uuid(), 'user_id' => auth()->id(),
            'url' => 'https://example.com', 'site_key' => 'example.com',
        ]);
        foreach (['queued', 'running', 'failed', 'completed'] as $status) {
            $scan->update(['status' => $status]);
            $this->postJson('/api/scans/'.$scan->id.'/share')->assertUnprocessable();
        }
        $scan->update(['results' => ['technical' => ['https' => ['status' => 'pass', 'score' => 100]]]]);
        $this->postJson('/api/scans/'.$scan->id.'/share')->assertUnprocessable();
        $this->assertDatabaseCount('shared_scores', 0);
    }

    public function test_public_top_ten_is_ranked_limited_and_contains_no_private_report_data(): void
    {
        $this->member();
        $scan = Scan::create([
            'id' => (string) Str::uuid(), 'user_id' => auth()->id(),
            'url' => 'https://example.com', 'site_key' => 'example.com',
        ]);
        for ($index = 0; $index < 12; $index++) {
            DB::table('shared_scores')->insert([
                'site_key' => 'site'.$index.'.example', 'scan_id' => $scan->id,
                'title' => 'Scouting '.$index, 'url' => 'https://site'.$index.'.example', 'score' => $index * 8,
            ]);
        }
        auth()->logout();
        $this->withoutVite();
        $this->get('/')->assertOk()->assertViewHas('pageData', function ($data) {
            $sites = $data['topSites'];
            return count($sites) === 10 && $sites[0]->score === 88 && $sites[9]->score === 16
                && array_keys((array) $sites[0]) === ['title', 'url', 'score'];
        });
    }

    public function test_production_responses_have_security_headers_and_matching_script_nonce(): void
    {
        $this->withoutVite();
        $this->app->detectEnvironment(fn () => 'production');
        $response = $this->get('https://localhost/')->assertOk()
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('X-Frame-Options', 'DENY')
            ->assertHeader('Strict-Transport-Security', 'max-age=31536000');
        $nonce = \Illuminate\Support\Facades\Vite::cspNonce();
        $this->assertNotEmpty($nonce);
        $this->assertStringContainsString("'nonce-{$nonce}'", $response->headers->get('Content-Security-Policy'));
        $response->assertSee('nonce="'.$nonce.'"', false);
    }

    public function test_health_check_fails_when_database_is_unavailable(): void
    {
        $this->get('/up')->assertOk();
        DB::shouldReceive('table')->with('jobs')->once()->andThrow(new \RuntimeException('Database unavailable'));
        $this->get('/up')->assertStatus(500);
    }

    public function test_scan_backoff_uses_the_queue_attempt_number(): void
    {
        $job = new RunScan((string) Str::uuid());
        $queueJob = \Mockery::mock(\Illuminate\Contracts\Queue\Job::class);
        $queueJob->shouldReceive('attempts')->once()->andReturn(2);
        $job->setJob($queueJob);

        $this->assertSame(\App\Services\ScanErrorAnalyzer::getBackoffDelay(2), $job->backoff());
    }

    public function test_scan_results_are_stored_as_data_and_hidden_from_status_responses(): void
    {
        $this->member();
        $results = [
            'home' => ['title' => 'Voorbeeld', 'url' => 'https://example.com'],
            'technical' => ['https' => ['status' => 'pass', 'score' => 100, 'detail' => 'HTTPS actief.']],
            'generatedAt' => now()->toISOString(),
        ];
        $scan = Scan::create([
            'id' => (string) Str::uuid(), 'user_id' => auth()->id(),
            'url' => 'https://example.com', 'site_key' => 'example.com',
            'status' => 'completed',
        ]);
        $scan->saveResults([...$results, 'html' => '<html>Niet bewaren</html>', 'home' => [...$results['home'], 'screenshot' => 'base64-image']]);
        $this->assertSame($results, $scan->fresh()->results);
        $this->getJson('/api/scans/'.$scan->id)->assertOk()->assertJsonMissingPath('results');
        $this->withoutVite();
        $this->get('/api/scans/'.$scan->id.'/report.html')->assertOk()->assertViewHas('pageData', fn ($data) => $data['report']['results'] === $results);
        $this->get('/api/scans/'.$scan->id.'/report.json')->assertOk()->assertExactJson($results);
        $this->get('/api/scans/'.$scan->id.'/report.pdf')->assertNotFound();
        File::deleteDirectory(config('quickscan.artifacts_path').'/'.$scan->id);
        $this->get('/api/scans/'.$scan->id.'/report.html')->assertOk();
    }

    public function test_retry_resets_non_nullable_fields_and_cannot_be_submitted_twice(): void
    {
        Queue::fake();
        $this->member();
        $scan = Scan::create([
            'id' => (string) Str::uuid(), 'user_id' => auth()->id(),
            'url' => 'https://example.com', 'site_key' => 'example.com',
            'status' => 'failed', 'phase' => 'failed', 'can_retry' => true,
            'attempt' => 3, 'error_detail' => 'Internal diagnostic',
        ]);
        $this->getJson('/api/scans/'.$scan->id)->assertOk()->assertJsonMissingPath('error_detail');
        $this->postJson('/api/scans/'.$scan->id.'/retry')->assertAccepted()
            ->assertJsonPath('phase', 'queued')->assertJsonPath('attempt', 0)
            ->assertJsonPath('can_retry', false)->assertJsonMissingPath('error_detail');
        $this->postJson('/api/scans/'.$scan->id.'/retry')->assertUnprocessable();
        Queue::assertPushed(RunScan::class, 1);
    }

    public function test_retry_respects_pending_limit_and_scan_ownership(): void
    {
        Queue::fake();
        $this->member();
        $scan = Scan::create([
            'id' => (string) Str::uuid(), 'user_id' => auth()->id(),
            'url' => 'https://example.com', 'site_key' => 'example.com',
            'status' => 'failed', 'can_retry' => true,
        ]);
        for ($index = 0; $index < 3; $index++) {
            $this->postJson('/api/scans', $this->submission())->assertAccepted();
        }
        $this->postJson('/api/scans/'.$scan->id.'/retry')->assertUnprocessable();
        $this->assertSame('failed', $scan->fresh()->status);
        $this->member();
        $this->postJson('/api/scans/'.$scan->id.'/retry')->assertNotFound();
        Queue::assertPushed(RunScan::class, 3);
    }

    public function test_guests_can_view_page_but_cannot_submit(): void
    {
        $this->withoutVite();
        $this->get('/')->assertOk()->assertSee('Website Quickscan')->assertSee('href="/favicon.ico"', false);
        $this->postJson('/api/scans', $this->submission())->assertUnauthorized();
    }

    public function test_legacy_report_import_preserves_results_and_keeps_invalid_files(): void
    {
        $directory = storage_path('app/private/test-import-'.Str::uuid());
        config(['quickscan.artifacts_path' => $directory]);
        $this->member();
        $scan = Scan::create(['id' => (string) Str::uuid(), 'user_id' => auth()->id(), 'url' => 'https://example.com', 'site_key' => 'example.com', 'status' => 'completed']);
        File::ensureDirectoryExists($directory.'/'.$scan->id);
        $results = [
            'home' => ['title' => 'Voorbeeld', 'url' => 'https://example.com'],
            'technical' => ['https' => ['status' => 'pass', 'score' => 100, 'detail' => 'HTTPS actief.']],
            'ai' => ['criteria' => ['beeldgebruik' => ['score' => 3, 'toelichting' => 'Duidelijke beelden.', 'verbeterpunt' => 'Voeg actuele beelden toe.', 'insufficientEvidence' => false]]],
            'generatedAt' => now()->toISOString(),
        ];
        try {
            foreach (['html' => '<html>oude stijl</html>', 'pdf' => 'oude PDF', 'json' => json_encode($results)] as $format => $content) {
                File::put($directory.'/'.$scan->id.'/report.'.$format, $content);
            }
            $this->artisan('quickscan:import-reports')->assertSuccessful();
            $this->assertSame($results, $scan->fresh()->results);
            $this->assertFileDoesNotExist($directory.'/'.$scan->id.'/report.pdf');
            $this->assertFileDoesNotExist($directory.'/'.$scan->id.'/report.html');
            $this->assertFileDoesNotExist($directory.'/'.$scan->id.'/report.json');
            $this->artisan('quickscan:import-reports')->assertSuccessful();
            $scan->update(['results' => null]);
            File::put($directory.'/'.$scan->id.'/report.json', '{broken');
            File::put($directory.'/'.$scan->id.'/report.pdf', 'bewaren bij importfout');
            $this->artisan('quickscan:import-reports')->assertFailed();
            $this->assertNull($scan->fresh()->results);
            $this->assertFileExists($directory.'/'.$scan->id.'/report.json');
            $this->assertFileExists($directory.'/'.$scan->id.'/report.pdf');
        } finally {
            File::deleteDirectory($directory);
        }
    }

    public function test_development_bypass_logs_in_a_persistent_account_without_sol(): void
    {
        $this->withoutVite();
        $this->withoutMiddleware(\Illuminate\Foundation\Http\Middleware\ValidateCsrfToken::class);
        Queue::fake();
        $this->app->detectEnvironment(fn () => 'local');
        config(['quickscan.dev_sol_bypass' => true]);
        $this->withSession(['membership_verified_at' => time()]);
        $this->get('/')->assertOk()->assertSessionMissing('membership_verified_at')->assertViewHas('pageData', fn ($data) => $data['user']['name'] === 'Development');
        $this->get('/auth/sol')->assertRedirect('/#scan');
        $this->postJson('/api/scans', $this->submission())->assertAccepted();
        $this->assertDatabaseCount('users', 1);
        $this->assertSame('development', auth()->user()->oidc_key);

        config(['quickscan.dev_sol_bypass' => false]);
        $this->postJson('/api/scans', $this->submission())->assertUnauthorized();
    }

    public function test_development_bypass_is_ignored_in_production(): void
    {
        $this->withoutMiddleware(\Illuminate\Foundation\Http\Middleware\ValidateCsrfToken::class);
        $this->app->detectEnvironment(fn () => 'production');
        config(['quickscan.dev_sol_bypass' => true]);
        $this->postJson('/api/scans', $this->submission())->assertUnauthorized();
        $this->assertDatabaseCount('users', 0);
    }

    public function test_membership_fails_closed_and_does_not_trust_email(): void
    {
        $identity = new SolIdentity;
        config(['quickscan.oidc.membership_claim' => 'organization.groups', 'quickscan.oidc.membership_values' => ['scouting-member']]);
        $this->assertFalse($identity->isMember((object) ['email' => 'member@scouting.nl']));
        $this->assertTrue($identity->isMember((object) ['organization' => (object) ['groups' => ['scouting-member']]]));
        $this->assertFalse($identity->isMember((object) ['organization' => (object) ['groups' => ['other']]]));
        $this->assertFalse($identity->isMember((object) ['organization' => (object) ['groups' => [true, 1]] ]));
    }

    public function test_membership_is_optional_only_when_both_settings_are_empty(): void
    {
        config([
            'quickscan.oidc.issuer' => 'https://issuer.example',
            'quickscan.oidc.client_id' => 'quickscan',
            'quickscan.oidc.client_secret' => 'secret',
            'quickscan.oidc.membership_claim' => '',
            'quickscan.oidc.membership_values' => [],
        ]);
        $identity = new SolIdentity;
        $this->assertTrue($identity->configured());
        $this->assertTrue($identity->isMember((object) ['sub' => 'user']));
        config(['quickscan.oidc.membership_claim' => 'organization.groups']);
        $this->assertFalse($identity->configured());
        $this->assertFalse($identity->isMember((object) ['sub' => 'user']));
        config(['quickscan.oidc.membership_claim' => '', 'quickscan.oidc.membership_values' => ['scouting-member']]);
        $this->assertFalse($identity->configured());
        $this->assertFalse($identity->isMember((object) ['sub' => 'user']));
        config(['quickscan.oidc.membership_claim' => 'organization.groups']);
        $this->assertTrue($identity->configured());
        config(['quickscan.oidc.client_secret' => '']);
        $this->assertFalse($identity->configured());
    }

    public function test_verified_sol_callback_without_membership_claim_allows_scanning(): void
    {
        Queue::fake();
        config([
            'quickscan.dev_sol_bypass' => false,
            'quickscan.oidc.issuer' => 'https://issuer.example',
            'quickscan.oidc.membership_claim' => '',
            'quickscan.oidc.membership_values' => [],
        ]);
        $client = \Mockery::mock(SolClient::class);
        $client->shouldReceive('authenticate')->once()->andReturn(true);
        $client->shouldReceive('getVerifiedClaims')->once()->andReturn((object) ['sub' => 'user', 'name' => 'SOL user']);
        $identity = \Mockery::mock(SolIdentity::class)->makePartial();
        $identity->shouldReceive('client')->once()->andReturn($client);
        $this->app->instance(SolIdentity::class, $identity);

        $this->get('/auth/sol/callback?code=valid-code&state=valid-state')->assertRedirect('/#scan')
            ->assertSessionHas('membership_verified_at');
        $this->assertAuthenticated();
        $this->assertSame(hash('sha256', "https://issuer.example\0user"), auth()->user()->oidc_key);
        $this->postJson('/api/scans', $this->submission())->assertAccepted();
    }

    public function test_members_can_queue_isolated_scans_with_explicit_consent(): void
    {
        Queue::fake();
        $this->member();
        $first = $this->postJson('/api/scans', $this->submission())->assertAccepted()->assertJsonPath('status', 'queued')->assertJsonPath('phase', 'queued')->json('id');
        $second = $this->postJson('/api/scans', $this->submission())->assertAccepted()->json('id');
        $this->assertNotSame($first, $second);
        $this->assertDatabaseHas('scans', ['id' => $first, 'site_key' => 'example.com', 'active_security_checks' => false]);
        Queue::assertPushed(RunScan::class, 2);
        $this->postJson('/api/scans', [...$this->submission(), 'authorizedToScan' => false])->assertUnprocessable();
        $this->postJson('/api/scans', [...$this->submission(), 'url' => 'http://127.0.0.1'])->assertUnprocessable();
        $this->postJson('/api/scans', [...$this->submission(), 'url' => 'https://user:pass@example.com'])->assertUnprocessable();
    }

    public function test_failed_sol_callback_logs_safe_diagnostics_and_clears_oidc_session(): void
    {
        config(['quickscan.dev_sol_bypass' => false]);
        foreach ([
            ['Unable to determine state', 'state_mismatch', null],
            ['Unable to verify JWT claims', 'invalid_id_token_claims', null],
            ['Curl error: (60) certificate verification failed', 'provider_connection_failed', null],
            ['Provider rejected secret-value and token-value', 'provider_or_protocol_error', null],
            ['Provider rejected secret-value', 'invalid_client', 'invalid_client'],
            ['Provider rejected private-code', 'invalid_grant', 'invalid_grant'],
            ['Provider rejected private-code', 'provider_or_protocol_error', 'private-provider-error'],
        ] as [$message, $reason, $tokenError]) {
            $client = \Mockery::mock(SolClient::class);
            $client->shouldReceive('authenticate')->once()->andThrow(new \Jumbojett\OpenIDConnectClientException($message));
            $client->shouldReceive('getTokenResponse')->once()->andReturn($tokenError === null ? null : (object) ['error' => $tokenError]);
            $identity = \Mockery::mock(SolIdentity::class);
            $identity->shouldReceive('client')->once()->andReturn($client);
            $this->app->instance(SolIdentity::class, $identity);
            \Illuminate\Support\Facades\Log::shouldReceive('warning')->once()->with('SOL authentication failed', [
                'type' => \Jumbojett\OpenIDConnectClientException::class,
                'reason' => $reason,
                'callback' => true,
                'oidc_session_present' => true,
            ]);

            $this->withSession(['oidc' => ['state' => 'private-state']])
                ->get('/auth/sol/callback?code=private-code&state=private-state')
                ->assertRedirect('/')
                ->assertSessionHas('auth_error')
                ->assertSessionMissing('oidc');
            $this->assertGuest();
        }
    }

    public function test_other_users_cannot_read_scans_or_reports(): void
    {
        $owner = User::factory()->create();
        $scan = Scan::create(['id' => (string) Str::uuid(), 'user_id' => $owner->id, 'url' => 'https://example.com', 'site_key' => 'example.com', 'status' => 'completed']);
        $this->member();
        $this->getJson('/api/scans/'.$scan->id)->assertNotFound();
        $this->get('/api/scans/'.$scan->id.'/report.html')->assertNotFound();
        $this->get('/api/scans/'.$scan->id.'/report.json')->assertNotFound();
        $this->get('/api/scans/'.$scan->id.'/report.pdf')->assertNotFound();
    }

    public function test_expired_membership_cannot_submit(): void
    {
        $this->actingAs(User::factory()->create())->withSession(['membership_verified_at' => time() - 7201]);
        $this->postJson('/api/scans', $this->submission())->assertUnauthorized();
    }

    public function test_counter_counts_only_distinct_completed_sites(): void
    {
        DB::table('checked_sites')->insertOrIgnore(['hostname' => 'example.com', 'first_checked_at' => now()]);
        DB::table('checked_sites')->insertOrIgnore(['hostname' => 'example.com', 'first_checked_at' => now()]);
        $this->getJson('/api/stats')->assertExactJson(['uniqueSites' => 1]);
    }

    public function test_unconfigured_login_and_invalid_callback_are_safe(): void
    {
        $this->get('/auth/sol')->assertRedirect('/')->assertSessionHas('auth_error');
        $this->get('/auth/sol/callback')->assertRedirect('/')->assertSessionHas('auth_error');
    }

    public function test_oidc_rejects_missing_required_claims_and_wrong_nonce(): void
    {
        config(['quickscan.oidc.issuer' => 'https://issuer.example', 'quickscan.oidc.client_id' => 'quickscan']);
        $client = new class('https://issuer.example', 'quickscan', 'secret') extends SolClient
        {
            public function checkClaims(object $claims): bool
            {
                return $this->verifyJWTClaims($claims);
            }
        };
        $claims = (object) ['iss' => 'https://issuer.example', 'sub' => 'member', 'aud' => 'quickscan', 'iat' => time(), 'exp' => time() + 300, 'nonce' => 'wrong'];
        $this->assertFalse($client->checkClaims($claims));
        unset($claims->exp);
        $this->assertFalse($client->checkClaims($claims));
        $claims->exp = time() - 1;
        $this->assertFalse($client->checkClaims($claims));
        unset($claims->nonce);
        $this->assertFalse($client->checkClaims($claims));
    }

    public function test_per_user_pending_limit_does_not_block_another_user(): void
    {
        Queue::fake();
        $this->member();
        for ($index = 0; $index < 3; $index++) {
            $this->postJson('/api/scans', $this->submission())->assertAccepted();
        }
        $this->postJson('/api/scans', $this->submission())->assertUnprocessable();
        $this->member();
        $this->postJson('/api/scans', $this->submission())->assertAccepted();
    }

    private function member(): void
    {
        $this->actingAs(User::factory()->create())->withSession(['membership_verified_at' => time()]);
    }

    public function test_admins_bypass_all_scan_limits_but_still_need_consent(): void
    {
        Queue::fake();
        $user = User::factory()->create();
        $user->is_admin = true;
        $user->save();
        $this->actingAs($user)->withSession(['membership_verified_at' => time()]);
        for ($index = 0; $index < 100; $index++) {
            Scan::create(['id' => (string) Str::uuid(), 'user_id' => $user->id, 'url' => 'https://example.com', 'site_key' => 'example.com']);
        }
        for ($index = 0; $index < 12; $index++) {
            $this->postJson('/api/scans', $this->submission())->assertAccepted();
        }
        $this->postJson('/api/scans', [...$this->submission(), 'authorizedToScan' => false])->assertUnprocessable();
        $this->postJson('/api/scans', [...$this->submission(), 'url' => 'http://127.0.0.1'])->assertUnprocessable();
        $this->withoutVite();
        $this->get('/')->assertViewHas('pageData', fn ($data) => $data['scanLimits']['isAdmin'] && $data['scanLimits']['userScansLimit'] === null);
        $this->member();
        $this->postJson('/api/scans', $this->submission())->assertUnprocessable();
    }

    public function test_regular_accounts_keep_daily_and_submission_limits(): void
    {
        Queue::fake();
        $this->member();
        $this->assertFalse(auth()->user()->is_admin);
        for ($index = 0; $index < 10; $index++) {
            Scan::create(['id' => (string) Str::uuid(), 'user_id' => auth()->id(), 'url' => 'https://example.com', 'site_key' => 'example.com', 'status' => 'completed']);
        }
        $this->postJson('/api/scans', $this->submission())->assertUnprocessable()->assertJsonValidationErrors('url');
        $this->member();
        for ($index = 0; $index < 10; $index++) {
            $this->postJson('/api/scans', [...$this->submission(), 'authorizedToScan' => false])->assertUnprocessable();
        }
        $this->postJson('/api/scans', $this->submission())->assertStatus(429);
    }

    public function test_admin_command_grants_and_revokes_access_for_an_existing_account(): void
    {
        $user = User::factory()->create();
        $this->artisan('quickscan:admin', ['user' => $user->email])->assertSuccessful();
        $this->assertTrue($user->fresh()->is_admin);
        $this->artisan('quickscan:admin', ['user' => $user->id, '--revoke' => true])->assertSuccessful();
        $this->assertFalse($user->fresh()->is_admin);
        $this->artisan('quickscan:admin', ['user' => 999999])->assertFailed();
    }

    public function test_job_can_generate_real_reports_when_smoke_checks_enabled(): void
    {
        if (getenv('RUN_BROWSER_SCAN_TEST') !== '1') {
            $this->markTestSkipped('Set RUN_BROWSER_SCAN_TEST=1 for the public-site Chromium integration test.');
        }
        $directory = storage_path('app/private/test-scans-'.Str::uuid());
        $url = getenv('RUN_BROWSER_SCAN_URL') ?: 'https://example.org';
        config(['quickscan.artifacts_path' => $directory, 'quickscan.gemini_api_key' => null, 'quickscan.pagespeed_api_key' => null]);
        $scan = Scan::create([
            'id' => (string) Str::uuid(), 'user_id' => User::factory()->create()->id,
            'url' => $url, 'site_key' => preg_replace('/^www\./', '', strtolower(parse_url($url, PHP_URL_HOST))), 'active_security_checks' => false,
        ]);
        try {
            (new RunScan($scan->id))->handle();
            $this->assertSame('completed', $scan->fresh()->status);
            $this->assertSame('completed', $scan->fresh()->phase);
            $this->getJson('/api/stats')->assertJsonPath('uniqueSites', 1);
            $this->assertNotEmpty($scan->fresh()->results['technical']);
            foreach (['html', 'pdf', 'json'] as $format) {
                $this->assertFileDoesNotExist($directory.'/'.$scan->id.'/report.'.$format);
            }
        } finally {
            File::deleteDirectory($directory);
        }
    }

    private function submission(): array
    {
        return ['url' => 'https://www.example.com/', 'authorizedToScan' => true, 'activeSecurityChecksAuthorized' => false];
    }
}