<?php
declare(strict_types=1);

/**
 * GET api/health.php
 *
 * Connectivity self-test: reports PHP version, configured provider,
 * cache status and whether the upstream weather API is reachable.
 */

require_once __DIR__ . '/bootstrap.php';

Response::preflight();

$cfg = sky_config();
sky_cache(); // ensure the cache directory is initialised

$provider = $cfg['provider'];
$upstream = 'skipped';

if ($provider === 'openweather') {
    $key = trim((string) $cfg['openweather_key']);
    if ($key === '' || $key === 'YOUR_OPENWEATHERMAP_API_KEY_HERE') {
        $upstream = 'missing-key';
    } else {
        [, $status] = Http::get('https://api.openweathermap.org/data/2.5/weather?q=London&appid=' . urlencode($key));
        $upstream = $status === 200 ? 'ok' : 'http-' . $status;
    }
} else {
    [, $status] = Http::get('https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.12&current=temperature_2m');
    $upstream = $status === 200 ? 'ok' : 'http-' . $status;
}

Response::ok([
    'status'        => 'ok',
    'php_version'   => PHP_VERSION,
    'curl'          => function_exists('curl_init'),
    'provider'      => $provider,
    'cache'         => sky_cache()->enabled(),
    'upstream'      => $upstream,
    'time'          => gmdate('c'),
]);
