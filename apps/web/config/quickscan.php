<?php

return [
    'dev_sol_bypass' => env('DEV_SOL_BYPASS', false),
    'oidc' => [
        'issuer' => env('OIDC_ISSUER'),
        'client_id' => env('OIDC_CLIENT_ID'),
        'client_secret' => env('OIDC_CLIENT_SECRET'),
        'redirect_uri' => env('OIDC_REDIRECT_URI', rtrim(env('APP_URL', 'http://localhost:8000'), '/').'/auth/sol/callback'),
        'scopes' => array_filter(explode(' ', env('OIDC_SCOPES', 'openid profile'))),
        'membership_claim' => env('OIDC_MEMBERSHIP_CLAIM'),
        'membership_values' => array_values(array_filter(array_map('trim', explode(',', env('OIDC_MEMBERSHIP_VALUES', ''))))),
        'session_seconds' => 7200,
    ],
    'artifacts_path' => env('SCAN_ARTIFACTS_PATH', storage_path('app/private/scans')),
    'gemini_api_key' => env('GEMINI_API_KEY'),
    'gemini_model' => env('GEMINI_MODEL', 'gemini-2.5-flash'),
    'pagespeed_api_key' => env('GOOGLE_PAGESPEED_API_KEY'),
];