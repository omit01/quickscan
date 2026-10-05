<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class RequireSolMember
{
    public function handle(Request $request, Closure $next)
    {
        if ($request->attributes->get('development_login') === true) {
            return $next($request);
        }
        $verifiedAt = $request->session()->get('membership_verified_at', 0);
        if (! Auth::check() || ! is_int($verifiedAt) || $verifiedAt < time() - config('quickscan.oidc.session_seconds')) {
            Auth::logout();

            return $request->expectsJson()
                ? response()->json(['message' => 'Log opnieuw in met SOL 3.0.'], 401)
                : redirect('/auth/sol');
        }

        return $next($request);
    }
}