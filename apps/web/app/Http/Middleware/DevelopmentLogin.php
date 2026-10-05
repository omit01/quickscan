<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

class DevelopmentLogin
{
    public function handle(Request $request, Closure $next)
    {
        if (app()->environment('local') && config('quickscan.dev_sol_bypass')) {
            $user = User::firstOrCreate(['oidc_key' => 'development'], [
                'name' => 'Development',
                'email' => 'development@oidc.invalid',
                'password' => Str::random(64),
            ]);
            Auth::login($user);
            $request->session()->forget('membership_verified_at');
            $request->attributes->set('development_login', true);

            if ($request->is('auth/sol', 'auth/sol/callback')) {
                return redirect('/#scan');
            }
        }

        return $next($request);
    }
}