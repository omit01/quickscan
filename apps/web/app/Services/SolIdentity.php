<?php

namespace App\Services;

class SolIdentity
{
    public function configured(): bool
    {
        $config = config('quickscan.oidc');

        return is_string($config['issuer']) && str_starts_with($config['issuer'], 'https://')
            && filled($config['client_id']) && filled($config['client_secret'])
            && ((blank($config['membership_claim']) && $config['membership_values'] === [])
                || (filled($config['membership_claim']) && count($config['membership_values']) > 0));
    }

    public function client(): SolClient
    {
        abort_unless($this->configured(), 503, 'SOL 3.0 is nog niet geconfigureerd.');
        $config = config('quickscan.oidc');
        $client = new SolClient($config['issuer'], $config['client_id'], $config['client_secret']);
        $client->setRedirectURL($config['redirect_uri']);
        $client->addScope($config['scopes']);
        $client->setCodeChallengeMethod('S256');
        $client->setTimeout(15);

        return $client;
    }

    public function isMember(object $claims): bool
    {
        $path = config('quickscan.oidc.membership_claim');
        $allowed = config('quickscan.oidc.membership_values');
        if (blank($path) && $allowed === []) {
            return true;
        }
        if (! is_string($path) || $path === '' || $allowed === []) {
            return false;
        }
        $value = data_get($claims, $path);
        $values = is_array($value) ? $value : [$value];

        return collect($values)->contains(fn ($entry) => is_string($entry) && in_array($entry, $allowed, true));
    }
}