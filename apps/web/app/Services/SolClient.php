<?php

namespace App\Services;

use Illuminate\Http\Exceptions\HttpResponseException;
use Jumbojett\OpenIDConnectClient;

class SolClient extends OpenIDConnectClient
{
    protected function verifyJWTClaims($claims, ?string $accessToken = null): bool
    {
        if (! is_object($claims) || ! isset($claims->iss, $claims->sub, $claims->aud, $claims->exp, $claims->iat, $claims->nonce)
            || $claims->iss !== config('quickscan.oidc.issuer')
            || ! is_string($claims->sub) || $claims->sub === ''
            || ! is_int($claims->exp) || $claims->exp <= time()
            || ! is_int($claims->iat) || $claims->iat > time() + 60 || $claims->iat >= $claims->exp
            || ! is_string($claims->nonce) || $claims->nonce === '' || $claims->nonce !== $this->getNonce()) {
            return false;
        }
        $audiences = is_array($claims->aud) ? $claims->aud : [$claims->aud];
        $clientId = config('quickscan.oidc.client_id');
        if (! in_array($clientId, $audiences, true)
            || (count($audiences) > 1 && ($claims->azp ?? null) !== $clientId)
            || (isset($claims->azp) && $claims->azp !== $clientId)) {
            return false;
        }

        return parent::verifyJWTClaims($claims, $accessToken);
    }

    protected function startSession() {}

    protected function commitSession() {}

    protected function getSessionKey(string $key)
    {
        return session()->get('oidc.'.$key, false);
    }

    protected function setSessionKey(string $key, $value)
    {
        session()->put('oidc.'.$key, $value);
    }

    protected function unsetSessionKey(string $key)
    {
        session()->forget('oidc.'.$key);
    }

    public function redirect(string $url)
    {
        throw new HttpResponseException(redirect()->away($url));
    }
}