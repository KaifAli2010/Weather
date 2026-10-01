<?php
declare(strict_types=1);

/**
 * Shared bootstrap for every API endpoint: autoloading, config,
 * cache directory and a global exception handler.
 */

define('SKY_ROOT', dirname(__DIR__));

require_once SKY_ROOT . '/includes/Response.php';
require_once SKY_ROOT . '/includes/ApiException.php';
require_once SKY_ROOT . '/includes/Http.php';
require_once SKY_ROOT . '/includes/Cache.php';
require_once SKY_ROOT . '/includes/WeatherService.php';

/**
 * API configuration (api/config.php).
 */
function sky_config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $cfg = require SKY_ROOT . '/api/config.php';
        $GLOBALS['skyConfig'] = $cfg;
        define('SKY_VERIFY_SSL', (bool) ($cfg['verify_ssl'] ?? true));
    }
    return $cfg;
}

function sky_cache(): Cache
{
    static $cache = null;
    if ($cache === null) {
        $cfg = sky_config();
        $cache = new Cache(SKY_ROOT . '/includes/cache', (bool) ($cfg['cache_enabled'] ?? true));
    }
    return $cache;
}

function sky_service(): WeatherService
{
    static $service = null;
    if ($service === null) {
        $service = new WeatherService(sky_config(), sky_cache());
    }
    return $service;
}

set_exception_handler(static function (Throwable $e): void {
    if ($e instanceof ApiException) {
        Response::error($e->getMessage(), $e->httpStatus(), $e->type);
    }

    error_log('[SkyCast] unhandled ' . get_class($e) . ' — ' . $e->getMessage());
    Response::error(
        'Something went wrong on our side. Please try again in a moment.',
        500,
        'server'
    );
});

error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');
date_default_timezone_set('UTC');
