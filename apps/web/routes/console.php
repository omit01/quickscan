<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use App\Models\User;
use App\Models\Scan;
use Illuminate\Support\Facades\File;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('quickscan:admin {user : Account ID or email} {--revoke : Remove admin access}', function () {
    $account = (string) $this->argument('user');
    $user = ctype_digit($account) ? User::find($account) : User::where('email', $account)->first();
    if (! $user) {
        $this->error('Account niet gevonden.');

        return 1;
    }
    $user->is_admin = ! $this->option('revoke');
    $user->save();
    $this->info($user->name.($user->is_admin ? ' is nu admin.' : ' is geen admin meer.'));

    return 0;
})->purpose('Grant or revoke unlimited scanning for an existing account');

Artisan::command('quickscan:import-reports', function () {
    $failed = 0;
    foreach (Scan::where('status', 'completed')->lazyById() as $scan) {
        $directory = config('quickscan.artifacts_path').'/'.$scan->id;
        try {
            if ($scan->results === null) {
                $scan->saveResults(json_decode(File::get($directory.'/report.json'), true, 512, JSON_THROW_ON_ERROR));
            }
            File::delete($directory.'/report.html', $directory.'/report.pdf', $directory.'/report.json');
        } catch (\Throwable $exception) {
            $failed++;
            $this->error('Rapport '.$scan->id.' niet overgezet; bestaande bestanden behouden.');
        }
    }
    $this->info('Rapportimport afgerond.');

    return $failed ? 1 : 0;
})->purpose('Import existing report data into the database and remove obsolete report files');
