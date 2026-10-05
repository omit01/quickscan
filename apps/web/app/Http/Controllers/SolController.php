<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\SolIdentity;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Throwable;

class SolController extends Controller
{
    public function login(Request $request, SolIdentity $identity)
    {
        Auth::logout();
        $request->session()->forget('membership_verified_at');
        if (! $identity->configured()) {
            return redirect('/')->with('auth_error', 'SOL 3.0 is nog niet ingesteld. Neem contact op met de beheerder.');
        }
        $request->session()->forget('oidc');

        return $this->authenticate($request, $identity, false);
    }

    public function callback(Request $request, SolIdentity $identity)
    {
        if (! $request->filled('code') || ! $request->filled('state')) {
            $request->session()->forget('oidc');

            return redirect('/')->with('auth_error', 'Aanmelden is geannuleerd of ongeldig. Probeer opnieuw.');
        }

        return $this->authenticate($request, $identity, true);
    }

    private function authenticate(Request $request, SolIdentity $identity, bool $callback)
    {
        try {
            $client = $identity->client();
            if (! $client->authenticate() || ! $callback) {
                throw new \RuntimeException('Authentication was not completed.');
            }
            $claims = $client->getVerifiedClaims();
            if (! is_object($claims) || ! $identity->isMember($claims) || ! isset($claims->sub) || ! is_string($claims->sub) || $claims->sub === '') {
                $request->session()->forget('oidc');

                return redirect('/')->with('auth_error', 'Je account heeft geen geldig organisatielidmaatschap.');
            }
            $key = hash('sha256', config('quickscan.oidc.issuer')."\0".$claims->sub);
            $user = User::firstOrCreate(['oidc_key' => $key], [
                'name' => mb_substr(is_string($claims->name ?? null) ? $claims->name : 'SOL-lid', 0, 200),
                'email' => $key.'@oidc.invalid',
                'password' => null,
            ]);
            Auth::login($user);
            $request->session()->regenerate();
            $request->session()->forget('oidc');
            $request->session()->put('membership_verified_at', time());

            return redirect('/#scan');
        } catch (HttpResponseException $redirect) {
            throw $redirect;
        } catch (Throwable $error) {
            Log::warning('SOL authentication failed', ['type' => get_class($error)]);
            $request->session()->forget('oidc');

            return redirect('/')->with('auth_error', 'Aanmelden via SOL 3.0 is niet gelukt. Probeer opnieuw.');
        }
    }

    public function logout(Request $request)
    {
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect('/');
    }
}