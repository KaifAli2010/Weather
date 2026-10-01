<?php
declare(strict_types=1);

/**
 * SkyCast — API configuration.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  WHICH WEATHER PROVIDER SHOULD I USE?                                │
 * │                                                                      │
 * │  • openmeteo (default) — no API key, no signup, works instantly.     │
 * │  • openweather — OpenWeatherMap. Requires a free API key from        │
 * │    https://home.openweathermap.org/api_keys (activation can take up  │
 * │    to a couple of hours for brand-new keys).                        │
 * │                                                                      │
 * │  To switch to OpenWeatherMap:                                        │
 * │    1. Set  'provider' => 'openweather'                              │
 * │    2. Paste your key into 'openweather_key' below                    │
 * └─────────────────────────────────────────────────────────────────────┘
 */

return [
    // 'openmeteo' (no key needed) or 'openweather' (needs API key)
    'provider' => 'openmeteo',

    // OpenWeatherMap API key — https://home.openweathermap.org/api_keys
    'openweather_key' => 'YOUR_OPENWEATHERMAP_API_KEY_HERE',

    // If the primary provider fails, these are tried in order.
    'providers' => ['openmeteo'],

    // Seconds to cache API responses (weather changes little within
    // a few minutes and this protects the free-tier rate limits).
    'cache_ttl' => 600,

    // Disk cache for API responses. Set false to disable.
    'cache_enabled' => true,

    // Only relevant while testing on localhost with a self-signed cert.
    // ALWAYS leave true in production.
    'verify_ssl' => true,
];
