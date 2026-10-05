<?php

namespace App\Jobs;

use App\Models\Scan;
use App\Services\ScanErrorAnalyzer;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Symfony\Component\Process\Process;
use Throwable;

class RunScan implements ShouldQueue
{
    use Queueable;

    public int $timeout = 900;

    public int $tries = 3;  // Retry up to 3 times

    public bool $failOnTimeout = true;

    public function __construct(public string $scanId) {}

    public function handle(): void
    {
        $scan = Scan::findOrFail($this->scanId);
        $scan->increment('attempt');
        $scan->update(['status' => 'running', 'phase' => 'capturing_homepage', 'error' => null, 'error_code' => null]);

        $root = dirname(base_path(), 2);
        $process = new Process(['node', $root.'/apps/worker/dist/cli.js'], $root, [
            'ARTIFACTS_PATH' => config('quickscan.artifacts_path'),
            'GEMINI_API_KEY' => config('quickscan.gemini_api_key') ?? '',
            'GEMINI_MODEL' => config('quickscan.gemini_model'),
            'GOOGLE_PAGESPEED_API_KEY' => config('quickscan.pagespeed_api_key') ?? '',
        ]);
        $process->setInput(json_encode([
            'scanId' => $scan->id, 'url' => $scan->url,
            'authorizedToScan' => true,
            'activeSecurityChecksAuthorized' => $scan->active_security_checks,
            'formSubmissionTestingAuthorized' => $scan->form_submission_testing_authorized,
            'submittedAt' => $scan->created_at->toISOString(),
        ], JSON_THROW_ON_ERROR));
        $process->setTimeout(870);
        $buffer = '';
        $processLogs = [];
        $process->run(function ($type, $chunk) use ($scan, &$buffer, &$processLogs) {
            if ($type === Process::OUT) {
                $buffer .= $chunk;
                while (($newline = strpos($buffer, "\n")) !== false) {
                    $event = json_decode(substr($buffer, 0, $newline), true);
                    $buffer = substr($buffer, $newline + 1);
                    
                    if (isset($event['phase']) && in_array($event['phase'], ['capturing_homepage', 'running_technical_checks', 'evaluating_ai', 'generating_report'], true)) {
                        $scan->update(['phase' => $event['phase']]);
                    }
                    
                    // Capture error logs from worker
                    if (($event['type'] ?? null) === 'error_log') {
                        $processLogs[] = $event;
                    }
                }
            } elseif ($type === Process::ERR) {
                $processLogs[] = ['type' => 'stderr', 'message' => $chunk];
            }
        });

        if (! $process->isSuccessful()) {
            $errorMessage = $this->buildDetailedErrorMessage($scan->id, $processLogs, $process);
            $errorAnalysis = ScanErrorAnalyzer::analyze($errorMessage, $scan->phase);
            
            Log::error('Scanner process failed', [
                'scan_id' => $scan->id,
                'exit_code' => $process->getExitCode(),
                'attempt' => $scan->attempt,
                'error_code' => $errorAnalysis['code'],
                'is_transient' => $errorAnalysis['is_transient'],
                'error_message' => $errorMessage,
                'process_logs' => $processLogs,
            ]);

            // If transient error and not last attempt, throw to trigger retry
            if ($errorAnalysis['is_transient'] && $scan->attempt < $this->tries) {
                throw new \RuntimeException('Transient error, will retry: ' . $errorAnalysis['code']);
            }

            // Permanent error or last attempt
            throw new \RuntimeException('Scanner process failed: ' . $errorMessage);
        }

        $path = config('quickscan.artifacts_path').'/'.$scan->id.'/report.json';
        if (! is_file($path)) {
            Log::error('Scanner report missing', [
                'scan_id' => $scan->id,
                'expected_path' => $path,
            ]);
            throw new \RuntimeException('Scanner did not produce results.');
        }

        try {
            $results = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            Log::error('Scanner report invalid JSON', [
                'scan_id' => $scan->id,
                'path' => $path,
                'error' => $e->getMessage(),
            ]);
            throw new \RuntimeException('Scanner produced invalid results: ' . $e->getMessage());
        }

        DB::transaction(function () use ($scan, $results) {
            try {
                $scan->saveResults($results);
            } catch (\Illuminate\Validation\ValidationException $e) {
                Log::error('Scan results validation failed', [
                    'scan_id' => $scan->id,
                    'errors' => $e->errors(),
                    'results' => $results,
                ]);
                throw new \RuntimeException('Invalid scan results structure: ' . json_encode($e->errors()));
            }
            
            DB::table('checked_sites')->insertOrIgnore(['hostname' => $scan->site_key, 'first_checked_at' => now()]);
            $scan->update(['status' => 'completed', 'phase' => 'completed', 'completed_at' => now(), 'error_code' => null, 'can_retry' => false]);
        });

        File::delete($path);
        
        // Also delete error artifact if it exists (successful completion)
        File::delete(config('quickscan.artifacts_path').'/'.$scan->id.'/error.json');
    }

    private function buildDetailedErrorMessage(string $scanId, array $processLogs, Process $process): string
    {
        $messages = [];
        
        // Extract phase-specific errors from worker logs
        foreach ($processLogs as $log) {
            if ($log['type'] === 'error_log') {
                $messages[] = sprintf(
                    "[%s] %s (Code: %s) - %s",
                    $log['phase'] ?? 'unknown',
                    $log['message'] ?? 'No message',
                    $log['errorCode'] ?? 'UNKNOWN',
                    $log['details']['url'] ?? ''
                );
            }
        }

        // If no detailed logs, try to extract from error artifact
        if (empty($messages)) {
            $errorPath = config('quickscan.artifacts_path').'/'.$scanId.'/error.json';
            if (is_file($errorPath)) {
                try {
                    $errorData = json_decode(file_get_contents($errorPath), true, 512, JSON_THROW_ON_ERROR);
                    if (isset($errorData['errors']) && is_array($errorData['errors'])) {
                        foreach ($errorData['errors'] as $error) {
                            $messages[] = sprintf(
                                "[%s] %s (Code: %s)",
                                $error['phase'] ?? 'unknown',
                                $error['message'] ?? 'Unknown error',
                                $error['errorCode'] ?? 'UNKNOWN'
                            );
                        }
                    }
                } catch (\Exception $e) {
                    $messages[] = 'Could not parse error artifact: ' . $e->getMessage();
                }
            }
        }

        // Fall back to stderr if no structured logs
        if (empty($messages)) {
            $stderr = $process->getErrorOutput();
            if ($stderr) {
                $secrets = array_filter([config('quickscan.gemini_api_key'), config('quickscan.pagespeed_api_key')]);
                $stderr = str_replace($secrets, '[redacted]', $stderr);
                $messages[] = 'Process error: ' . mb_substr($stderr, -1000);
            }
        }

        return !empty($messages) ? implode(' | ', array_unique($messages)) : 'Unknown error occurred during scanning.';
    }

    public function failed(?Throwable $exception): void
    {
        $scan = Scan::findOrFail($this->scanId);
        $errorMessage = $exception instanceof \RuntimeException 
            ? substr($exception->getMessage(), 0, 1000)
            : 'De scan kon niet worden afgerond. Probeer het later opnieuw of neem contact op met de beheerder.';
        
        $errorAnalysis = ScanErrorAnalyzer::analyze($errorMessage, $scan->phase);

        $scan->update([
            'status' => 'failed',
            'phase' => 'failed',
            'error' => $errorAnalysis['user_message'],  // User-friendly message
            'error_code' => $errorAnalysis['code'],  // Error code for categorization
            'error_detail' => $errorMessage,  // Technical details for admin
            'can_retry' => $errorAnalysis['can_retry'],  // Allow user to retry
        ]);

        // Log the full error for admin debugging
        Log::error('Scan job failed', [
            'scan_id' => $this->scanId,
            'attempt' => $scan->attempt,
            'error_code' => $errorAnalysis['code'],
            'is_transient' => $errorAnalysis['is_transient'],
            'error' => $exception?->getMessage(),
            'trace' => $exception?->getTraceAsString(),
        ]);
    }

    /**
     * Retry callback to add exponential backoff
     */
    public function backoff(): int
    {
        return ScanErrorAnalyzer::getBackoffDelay($this->attempts());
    }
}
