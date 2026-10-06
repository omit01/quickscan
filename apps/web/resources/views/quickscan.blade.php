<!doctype html>
<html lang="nl">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Check je Scoutingwebsite op techniek, toegankelijkheid en bezoekerservaring. Een helder rapport met concrete verbeterpunten.">
    <meta name="theme-color" content="#aafc3d">
    <title>Website Quickscan | Scouting</title>
    <link rel="icon" href="/favicon.ico" sizes="any">
    @viteReactRefresh
    @if(Illuminate\Support\Facades\Vite::isRunningHot())
        @vite(['resources/css/app.css', 'resources/js/app.tsx'])
    @else
        <link rel="preload" href="{{ Illuminate\Support\Facades\Vite::asset('../../node_modules/@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff2') }}" as="font" type="font/woff2" crossorigin>
        <link rel="preload" href="{{ Illuminate\Support\Facades\Vite::asset('../../node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff2') }}" as="font" type="font/woff2" crossorigin>
        <style @if(Illuminate\Support\Facades\Vite::cspNonce()) nonce="{{ Illuminate\Support\Facades\Vite::cspNonce() }}" @endif>{!! Illuminate\Support\Facades\Vite::content('resources/css/app.css') !!}</style>
        @vite('resources/js/app.tsx')
    @endif
</head>
<body>
    <div id="app"></div>
    <script @if(Illuminate\Support\Facades\Vite::cspNonce()) nonce="{{ Illuminate\Support\Facades\Vite::cspNonce() }}" @endif>window.quickscan = {{ Illuminate\Support\Js::from($pageData) }};</script>
</body>
</html>