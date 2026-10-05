<?php

namespace App\Services;

/**
 * Categorizes scan errors for retry and user-facing messaging.
 * 
 * Transient errors: Can be retried (timeouts, rate limits, temporary server issues)
 * Permanent errors: Should not retry (invalid input, access denied, not found)
 */
class ScanErrorAnalyzer
{
    const TRANSIENT_CODES = [
        'NETWORK_TIMEOUT',
        'API_RATE_LIMIT',
        'API_SERVER_ERROR',
        'BROWSER_TIMEOUT',
        'DNS_TIMEOUT',
        'SSL_TIMEOUT',
    ];

    const PERMANENT_CODES = [
        'INVALID_URL',
        'INVALID_INPUT',
        'ACCESS_DENIED',
        'DNS_FAILED',
        'SSL_INVALID',
        'CERTIFICATE_ERROR',
        'HOST_NOT_FOUND',
    ];

    /**
     * Analyze error message and categorize it
     */
    public static function analyze(string $errorMessage, string $phase = 'unknown'): array
    {
        $errorCode = self::extractErrorCode($errorMessage);
        $isTransient = self::isTransientError($errorCode, $errorMessage);
        $userMessage = self::getUserMessage($errorCode, $phase);

        return [
            'code' => $errorCode,
            'is_transient' => $isTransient,
            'can_retry' => $isTransient,
            'user_message' => $userMessage,
            'admin_detail' => $errorMessage,
        ];
    }

    /**
     * Extract error code from error message
     */
    private static function extractErrorCode(string $message): string
    {
        // Check for explicit error codes in message
        if (preg_match('/\(Code:\s*([A-Z_]+)\)/', $message, $matches)) {
            return $matches[1];
        }

        // Check for timeout patterns
        if (preg_match('/timeout|timed out/i', $message)) {
            return 'NETWORK_TIMEOUT';
        }

        // Check for rate limit patterns
        if (preg_match('/HTTP 429|quota|rate limit/i', $message)) {
            return 'API_RATE_LIMIT';
        }

        // Check for server error patterns
        if (preg_match('/HTTP 5\d{2}|server error|internal error/i', $message)) {
            return 'API_SERVER_ERROR';
        }

        // Check for DNS/network patterns
        if (preg_match('/DNS|ENOTFOUND|connection refused|network error/i', $message)) {
            return 'DNS_FAILED';
        }

        // Check for SSL/certificate patterns
        if (preg_match('/SSL|certificate|TLS|self-signed/i', $message)) {
            return 'SSL_INVALID';
        }

        // Check for access denied patterns
        if (preg_match('/HTTP 403|forbidden|access denied|unauthorized/i', $message)) {
            return 'ACCESS_DENIED';
        }

        // Check for not found patterns
        if (preg_match('/HTTP 404|not found/i', $message)) {
            return 'HOST_NOT_FOUND';
        }

        // Default
        return 'UNKNOWN_ERROR';
    }

    /**
     * Determine if error is transient (should retry)
     */
    private static function isTransientError(string $code, string $message): bool
    {
        // Explicitly transient codes
        if (in_array($code, self::TRANSIENT_CODES)) {
            return true;
        }

        // Explicitly permanent codes
        if (in_array($code, self::PERMANENT_CODES)) {
            return false;
        }

        // For unknown codes, check for timeout indicators (usually transient)
        if (preg_match('/timeout|429|5\d{2}/i', $message)) {
            return true;
        }

        // Default: not transient (safer for permanent errors)
        return false;
    }

    /**
     * Generate user-friendly error message
     */
    private static function getUserMessage(string $code, string $phase): string
    {
        $messages = [
            'NETWORK_TIMEOUT' => 'De website laadt te langzaam. Probeer het later opnieuw.',
            'API_RATE_LIMIT' => 'Onze service wordt even overbelast. Probeer het later opnieuw.',
            'API_SERVER_ERROR' => 'Er is een technisch probleem. Probeer het later opnieuw.',
            'BROWSER_TIMEOUT' => 'De scan duurde te lang. Probeer het later opnieuw.',
            'DNS_TIMEOUT' => 'DNS-check duurde te lang. Probeer het later opnieuw.',
            'SSL_TIMEOUT' => 'SSL-certificaatcheck duurde te lang. Probeer het later opnieuw.',
            'INVALID_URL' => 'De website-URL is niet geldig. Controleer het webadres.',
            'INVALID_INPUT' => 'Ongeldige invoer voor de scan. Neem contact op met support.',
            'ACCESS_DENIED' => 'Toegang tot de website werd geweigerd. Dit kan aan de website liggen.',
            'DNS_FAILED' => 'De website-naam kon niet worden gevonden. Controleer of het webadres klopt.',
            'SSL_INVALID' => 'Het SSL-certificaat van de website is niet geldig. Dit kan een veiligheidsprobleem zijn.',
            'CERTIFICATE_ERROR' => 'Er is een probleem met het SSL-certificaat van de website.',
            'HOST_NOT_FOUND' => 'De website kon niet worden gevonden. Controleer het webadres.',
            'UNKNOWN_ERROR' => 'De scan kon niet worden afgerond. Probeer het later opnieuw.',
        ];

        return $messages[$code] ?? 'De scan kon niet worden afgerond. Probeer het later opnieuw.';
    }

    /**
     * Check if this is a partial failure (some checks succeeded)
     */
    public static function isPartialFailure(string $errorMessage): bool
    {
        // If error mentions "unavailable" or "skipped", it's likely partial
        return preg_match('/unavailable|skipped|niet beschikbaar/i', $errorMessage);
    }

    /**
     * Get backoff delay in seconds for retry attempt
     * Exponential backoff: 5s, 15s, 60s
     */
    public static function getBackoffDelay(int $attempt): int
    {
        $delays = [5, 15, 60];
        return $delays[$attempt - 1] ?? 60;
    }
}
