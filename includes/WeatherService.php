<?php
declare(strict_types=1);

require_once __DIR__ . '/ApiException.php';
require_once __DIR__ . '/Http.php';

/**
 * WeatherService — fetches current conditions + 5-day forecast for a
 * city name or coordinates.
 *
 * Provider order (configured in api/config.php):
 *   1. openweather — OpenWeatherMap (needs a free API key)
 *   2. openmeteo   — Open-Meteo (no API key required)  <- default
 *
 * Both providers are normalised to one shared shape so the frontend
 * never has to know which one answered.
 */
final class WeatherService
{
    private const WMO_TEXT = [
        0   => 'Clear sky',
        1   => 'Mainly clear',
        2   => 'Partly cloudy',
        3   => 'Overcast',
        45  => 'Fog',
        48  => 'Depositing rime fog',
        51  => 'Light drizzle',
        53  => 'Moderate drizzle',
        55  => 'Dense drizzle',
        56  => 'Light freezing drizzle',
        57  => 'Dense freezing drizzle',
        61  => 'Slight rain',
        63  => 'Moderate rain',
        65  => 'Heavy rain',
        66  => 'Light freezing rain',
        67  => 'Heavy freezing rain',
        71  => 'Slight snowfall',
        73  => 'Moderate snowfall',
        75  => 'Heavy snowfall',
        77  => 'Snow grains',
        80  => 'Slight rain showers',
        81  => 'Moderate rain showers',
        82  => 'Violent rain showers',
        85  => 'Slight snow showers',
        86  => 'Heavy snow showers',
        95  => 'Thunderstorm',
        96  => 'Thunderstorm with slight hail',
        99  => 'Thunderstorm with heavy hail',
    ];

    private const WMO_GROUP = [
        0 => 'clear', 1 => 'clear', 2 => 'partly', 3 => 'clouds',
        45 => 'fog', 48 => 'fog',
        51 => 'drizzle', 53 => 'drizzle', 55 => 'drizzle',
        56 => 'drizzle', 57 => 'drizzle',
        61 => 'rain', 63 => 'rain', 65 => 'rain',
        66 => 'rain', 67 => 'rain',
        71 => 'snow', 73 => 'snow', 75 => 'snow', 77 => 'snow',
        80 => 'rain', 81 => 'rain', 82 => 'rain',
        85 => 'snow', 86 => 'snow',
        95 => 'thunder', 96 => 'thunder', 99 => 'thunder',
    ];

    private array  $cfg;
    private Cache  $cache;

    public function __construct(array $cfg, Cache $cache)
    {
        $this->cfg   = $cfg;
        $this->cache = $cache;
    }

    /**
     * Main entry: resolve a location and return its normalised weather payload.
     * @param array{lat:float,lon:float,name:string,country:string,admin:string}|null $coords
     */
    public function getWeather(?array $coords, ?string $city): array
    {
        if ($coords === null) {
            $coords = $this->geocode($city ?? '');
        }

        $weather = $this->cached('wx:' . round($coords['lat'], 3) . ',' . round($coords['lon'], 3),
            fn () => $this->fetch($coords));

        $weather['location'] = [
            'name'      => $coords['name'],
            'country'   => $coords['country'],
            'admin'     => $coords['admin'],
            'latitude'  => (float) $coords['lat'],
            'longitude' => (float) $coords['lon'],
        ];

        return $weather;
    }

    /** City name search — returns up to $limit suggestions. */
    public function search(string $query, int $limit = 6): array
    {
        $query = trim($query);

        if ($query === '') {
            throw new ApiException('bad_request', 'Please type a city name to search.');
        }

        if (mb_strlen($query) < 2) {
            return [];
        }

        return $this->cached(
            'geo:' . mb_strtolower($query) . ':' . $limit,
            fn () => $this->geocodeSearch($query, $limit)
        );
    }

    /**
     * Reverse geocode coordinates (from browser geolocation) into a
     * displayable location. Never throws — falls back to a generic name.
     * @return array{lat:float,lon:float,name:string,country:string,admin:string}
     */
    public function reverseGeocode(float $lat, float $lon): array
    {
        $fallback = [
            'lat'     => $lat,
            'lon'     => $lon,
            'name'    => 'My Location',
            'country' => '',
            'admin'   => '',
        ];

        $key = 'revgeo:' . round($lat, 2) . ',' . round($lon, 2);
        $cached = $this->cache->get($key);
        if ($cached !== null) {
            return $cached;
        }

        $url = 'https://api.bigdatacloud.net/data/reverse-geocode-client?' . http_build_query([
            'latitude'  => $lat,
            'longitude' => $lon,
            'localityLanguage' => 'en',
        ]);

        [$data, $status, $error] = Http::getJson($url);

        $result = $fallback;
        if ($error === '' && $status < 400 && is_array($data)) {
            $name = trim((string) ($data['city'] ?? $data['locality'] ?? ''));
            if ($name === '') {
                $name = trim((string) ($data['principalSubdivision'] ?? ''));
            }
            if ($name !== '') {
                $result = [
                    'lat'     => $lat,
                    'lon'     => $lon,
                    'name'    => $name,
                    'country' => (string) ($data['countryName'] ?? ''),
                    'admin'   => (string) ($data['principalSubdivision'] ?? ''),
                ];
            }
        }

        $this->cache->set($key, $result, 86400);
        return $result;
    }

    // ── Providers ────────────────────────────────────────────────────────

    private function fetch(array $coords): array
    {
        $errors    = [];
        $severity  = ['config' => 0, 'auth' => 1, 'rate' => 2, 'upstream' => 3, 'server' => 4];
        $worst     = null; // most specific failure seen
        $worstRank = PHP_INT_MAX;

        foreach ($this->cfg['providers'] as $provider) {
            $method = 'fetch' . ucfirst($provider);
            if (!method_exists($this, $method)) {
                continue;
            }

            try {
                return $this->$method($coords);
            } catch (ApiException $e) {
                $errors[] = $provider . ': ' . $e->getMessage();
                error_log('[SkyCast] provider "' . $provider . '" failed — ' . $e->getMessage());

                $rank = $severity[$e->type] ?? PHP_INT_MAX - 1;
                if ($rank < $worstRank) {
                    $worstRank = $rank;
                    $worst     = $e;
                }

                if ($e->type === 'city') {
                    // Deterministic "unknown location" — no point retrying.
                    throw $e;
                }
            }
        }

        if ($worst !== null) {
            $detail = count($errors) > 1 ? ' (' . implode(' | ', $errors) . ')' : '';
            throw new ApiException($worst->type, $worst->getMessage() . $detail);
        }

        throw new ApiException('config', 'No weather provider is configured. Check api/config.php.');
    }

    /**
     * OpenWeatherMap — Current Weather + 5 day / 3 hour forecast.
     * Free tier, requires an API key.
     */
    private function fetchOpenweather(array $coords): array
    {
        $key = trim((string) ($this->cfg['openweather_key'] ?? ''));
        if ($key === '') {
            throw new ApiException('config', 'OpenWeatherMap is enabled but no API key is set.');
        }

        $base  = 'https://api.openweathermap.org/data/2.5';
        $query = http_build_query([
            'lat'   => $coords['lat'],
            'lon'   => $coords['lon'],
            'appid' => $key,
            'units' => 'metric',
        ]);

        [$current, $s1, $e1] = Http::getJson($base . '/weather?' . $query);
        if ($e1 !== '') {
            throw new ApiException('upstream', 'Could not reach OpenWeatherMap: ' . $e1);
        }
        if ($s1 === 401) {
            throw new ApiException('auth', 'OpenWeatherMap rejected the API key. ' .
                'Verify it in api/config.php (new keys can take up to a couple of hours to activate).');
        }
        if ($s1 === 429) {
            throw new ApiException('rate', 'OpenWeatherMap rate limit reached. Try again shortly.');
        }
        if ($s1 >= 400 || $current === null) {
            throw new ApiException('upstream', 'OpenWeatherMap error (HTTP ' . $s1 . ').');
        }

        [$forecast, $s2, $e2] = Http::getJson($base . '/forecast?' . $query);
        if ($e2 !== '') {
            throw new ApiException('upstream', 'Could not reach OpenWeatherMap forecast: ' . $e2);
        }
        if ($s2 === 401) {
            throw new ApiException('auth', 'OpenWeatherMap rejected the API key.');
        }
        if ($s2 === 429) {
            throw new ApiException('rate', 'OpenWeatherMap rate limit reached. Try again shortly.');
        }
        if ($s2 >= 400 || $forecast === null) {
            throw new ApiException('upstream', 'OpenWeatherMap forecast error (HTTP ' . $s2 . ').');
        }

        return $this->normaliseOpenweather($current, $forecast);
    }

    private function normaliseOpenweather(array $current, array $forecast): array
    {
        $tzOffset = (int) ($current['timezone'] ?? 0);

        // Collapse the 3-hourly list into daily summaries (local days).
        $daily = [];
        foreach (($forecast['list'] ?? []) as $slot) {
            $ts      = (int) ($slot['dt'] ?? 0);
            $dayKey  = gmdate('Y-m-d', $ts + $tzOffset);
            $temp    = (float) ($slot['main']['temp'] ?? 0);
            $pop     = (float) ($slot['pop'] ?? 0);

            if (!isset($daily[$dayKey])) {
                $daily[$dayKey] = [
                    'ts_min'    => $temp,
                    'ts_max'    => $temp,
                    'pop'       => $pop,
                    'midday'    => null,
                    'middayGap' => PHP_INT_MAX,
                ];
            }

            $daily[$dayKey]['ts_min'] = min($daily[$dayKey]['ts_min'], $temp);
            $daily[$dayKey]['ts_max'] = max($daily[$dayKey]['ts_max'], $temp);
            $daily[$dayKey]['pop']    = max($daily[$dayKey]['pop'], $pop);

            // Pick the slot closest to 12:00 local time as the "day icon".
            $hour = (int) gmdate('G', $ts + $tzOffset);
            $gap  = abs($hour - 12);
            if ($gap < $daily[$dayKey]['middayGap']) {
                $daily[$dayKey]['middayGap'] = $gap;
                $daily[$dayKey]['midday']    = $slot;
            }
        }

        $forecastDays = [];
        $todayKey = gmdate('Y-m-d', (int) ($current['dt'] ?? time()) + $tzOffset);
        foreach ($daily as $dayKey => $d) {
            if ($dayKey === $todayKey) {
                continue; // today is already shown as "current weather"
            }
            if (count($forecastDays) >= 5) {
                break;
            }

            $slot  = $d['midday'] ?? null;
            $w     = is_array($slot) ? ($slot['weather'][0] ?? []) : [];
            $icon  = (string) ($w['id'] ?? '');
            $group = $this->owmGroup($icon, (string) ($w['icon'] ?? ''));

            $forecastDays[] = [
                'date'      => $dayKey,
                'temp_min'  => round($d['ts_min'], 1),
                'temp_max'  => round($d['ts_max'], 1),
                'condition' => (string) ($w['main'] ?? '—'),
                'desc'      => (string) ($w['description'] ?? '—'),
                'group'     => $group,
                'icon'      => $this->groupIcon($group, $this->owmIsDay((string) ($w['icon'] ?? ''))),
                'is_day'    => $this->owmIsDay((string) ($w['icon'] ?? '')),
                'pop'       => round($d['pop'] * 100),
            ];
        }

        $w       = $current['weather'][0] ?? [];
        $iconStr = (string) ($w['icon'] ?? '');
        $group   = $this->owmGroup((string) ($w['id'] ?? ''), $iconStr);
        $isDay   = $this->owmIsDay($iconStr);

        // OWM "metric" wind speed is m/s — convert to km/h to match Open-Meteo.
        $windKmh = round((float) ($current['wind']['speed'] ?? 0) * 3.6, 1);

        return [
            'current' => [
                'temperature' => round((float) ($current['main']['temp'] ?? 0), 1),
                'feels_like'  => round((float) ($current['main']['feels_like'] ?? 0), 1),
                'humidity'    => (int) ($current['main']['humidity'] ?? 0),
                'pressure'    => (int) ($current['main']['pressure'] ?? 0),
                'visibility'  => isset($current['visibility']) ? (int) $current['visibility'] / 1000 : null,
                'wind_speed'  => $windKmh,
                'wind_deg'    => isset($current['wind']['deg']) ? (int) $current['wind']['deg'] : null,
                'clouds'      => (int) ($current['clouds']['all'] ?? 0),
                'uv_index'    => null,
                'condition'   => (string) ($w['main'] ?? '—'),
                'description' => (string) ($w['description'] ?? '—'),
                'group'       => $group,
                'icon'        => $this->groupIcon($group, $isDay),
                'is_day'      => $isDay,
            ],
            'sun' => [
                'sunrise'     => (int) ($current['sys']['sunrise'] ?? 0),
                'sunset'      => (int) ($current['sys']['sunset'] ?? 0),
                'timezone'    => $tzOffset,
            ],
            'forecast'    => $forecastDays,
            'observed_at' => (int) ($current['dt'] ?? time()),
            'fetched_at'  => time(),
            'provider'    => 'OpenWeatherMap',
        ];
    }

    /**
     * Open-Meteo — free, no API key required (https://open-meteo.com).
     */
    private function fetchOpenmeteo(array $coords): array
    {
        $url = 'https://api.open-meteo.com/v1/forecast?' . http_build_query([
            'latitude'      => $coords['lat'],
            'longitude'     => $coords['lon'],
            'current'       => 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,' .
                                'weather_code,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,' .
                                'wind_direction_10m,visibility',
            'daily'         => 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max',
            'forecast_days' => 7,
            'timezone'      => 'auto',
        ]);

        [$data, $status, $error] = Http::getJson($url);
        if ($error !== '') {
            throw new ApiException('upstream', 'Could not reach Open-Meteo: ' . $error);
        }
        if ($status >= 400 || $data === null) {
            throw new ApiException('upstream', 'Open-Meteo error (HTTP ' . $status . ').');
        }

        return $this->normaliseOpenmeteo($data);
    }

    private function normaliseOpenmeteo(array $data): array
    {
        $c     = $data['current'] ?? [];
        $d     = $data['daily'] ?? [];
        $code  = (int) ($c['weather_code'] ?? 0);
        $group = self::WMO_GROUP[$code] ?? 'clouds';
        $isDay = (int) ($c['is_day'] ?? 1) === 1;

        // Visibility is returned in metres by Open-Meteo.
        $visibilityM = $c['visibility'] ?? null;
        $visibility  = $visibilityM === null ? null : round($visibilityM / 1000, 1);

        // Local date strings → "Y-m-d".
        $sunriseLocal = (string) ($d['sunrise'][0] ?? '');
        $sunsetLocal  = (string) ($d['sunset'][0] ?? '');
        $tzOffset     = (int) ($data['utc_offset_seconds'] ?? 0);
        $sunriseTs    = $sunriseLocal !== '' ? $this->localToTs($sunriseLocal, $tzOffset) : null;
        $sunsetTs     = $sunsetLocal !== '' ? $this->localToTs($sunsetLocal, $tzOffset) : null;

        $forecastDays = [];
        $dates = (array) ($d['time'] ?? []);
        foreach ($dates as $i => $dateStr) {
            if ($i === 0) {
                continue; // today = current conditions
            }
            if (count($forecastDays) >= 5) {
                break;
            }

            $dayCode  = (int) ($d['weather_code'][$i] ?? 3);
            $dayGroup = self::WMO_GROUP[$dayCode] ?? 'clouds';

            $forecastDays[] = [
                'date'      => (string) $dateStr,
                'temp_min'  => round((float) ($d['temperature_2m_min'][$i] ?? 0), 1),
                'temp_max'  => round((float) ($d['temperature_2m_max'][$i] ?? 0), 1),
                'condition' => self::WMO_TEXT[$dayCode] ?? '—',
                'desc'      => self::WMO_TEXT[$dayCode] ?? '—',
                'group'     => $dayGroup,
                'icon'      => $this->groupIcon($dayGroup, true),
                'is_day'    => true,
                'pop'       => isset($d['precipitation_probability_max'][$i])
                    ? (int) $d['precipitation_probability_max'][$i]
                    : null,
            ];
        }

        $observedAt = 0;
        if (!empty($c['time'])) {
            $observedAt = $this->localToTs((string) $c['time'], $tzOffset);
        }

        return [
            'current' => [
                'temperature' => round((float) ($c['temperature_2m'] ?? 0), 1),
                'feels_like'  => round((float) ($c['apparent_temperature'] ?? 0), 1),
                'humidity'    => (int) ($c['relative_humidity_2m'] ?? 0),
                'pressure'    => (int) ($c['surface_pressure'] ?? ($c['pressure_msl'] ?? 0)),
                'visibility'  => $visibility,
                'wind_speed'  => round((float) ($c['wind_speed_10m'] ?? 0), 1),
                'wind_deg'    => isset($c['wind_direction_10m']) ? (int) $c['wind_direction_10m'] : null,
                'clouds'      => (int) ($c['cloud_cover'] ?? 0),
                'uv_index'    => isset($d['uv_index_max'][0]) ? round((float) $d['uv_index_max'][0], 1) : null,
                'condition'   => self::WMO_TEXT[$code] ?? '—',
                'description' => self::WMO_TEXT[$code] ?? '—',
                'group'       => $group,
                'icon'        => $this->groupIcon($group, $isDay),
                'is_day'      => $isDay,
            ],
            'sun' => [
                'sunrise'  => $sunriseTs,
                'sunset'   => $sunsetTs,
                'timezone' => $tzOffset,
            ],
            'forecast'    => $forecastDays,
            'observed_at' => $observedAt > 0 ? $observedAt : time(),
            'fetched_at'  => time(),
            'provider'    => 'Open-Meteo',
        ];
    }

    // ── Geocoding ────────────────────────────────────────────────────────

    /** Resolve a city name to exactly one location (first hit). */
    private function geocode(string $city): array
    {
        $results = $this->search($city, 1);
        if ($results === []) {
            throw new ApiException('city', 'We could not find "' . $city . '". ' .
                'Check the spelling or try another name (e.g. London, Dubai).');
        }

        return $results[0];
    }

    /** @return list<array{id:int,name:string,country:string,admin:string,lat:float,lon:float}> */
    private function geocodeSearch(string $query, int $limit): array
    {
        if ($this->cfg['provider'] === 'openweather' && trim((string) $this->cfg['openweather_key']) !== '') {
            try {
                return $this->geocodeOpenweather($query, $limit);
            } catch (ApiException $e) {
                error_log('[SkyCast] OWM geocoding failed, falling back to Open-Meteo — ' . $e->getMessage());
            }
        }

        return $this->geocodeOpenmeteo($query, $limit);
    }

    /** @return list<array{...}> */
    private function geocodeOpenmeteo(string $query, int $limit): array
    {
        $url = 'https://geocoding-api.open-meteo.com/v1/search?' . http_build_query([
            'name'    => $query,
            'count'   => max($limit, 10),
            'language'=> 'en',
            'format'  => 'json',
        ]);

        [$data, $status, $error] = Http::getJson($url);
        if ($error !== '') {
            throw new ApiException('upstream', 'Could not reach the city search service: ' . $error);
        }
        if ($status >= 400 || $data === null) {
            throw new ApiException('upstream', 'City search service error (HTTP ' . $status . ').');
        }

        $out = [];
        foreach ((array) ($data['results'] ?? []) as $r) {
            $out[] = [
                'id'      => (int) ($r['id'] ?? 0),
                'name'    => (string) ($r['name'] ?? ''),
                'country' => (string) ($r['country'] ?? ''),
                'admin'   => (string) ($r['admin1'] ?? ''),
                'lat'     => (float) ($r['latitude'] ?? 0),
                'lon'     => (float) ($r['longitude'] ?? 0),
            ];
            if (count($out) >= $limit) {
                break;
            }
        }

        return $out;
    }

    /** @return list<array{...}> */
    private function geocodeOpenweather(string $query, int $limit): array
    {
        $url = 'https://api.openweathermap.org/geo/1.0/direct?' . http_build_query([
            'q'     => $query,
            'limit' => $limit,
            'appid' => $this->cfg['openweather_key'],
        ]);

        [$data, $status, $error] = Http::getJson($url);
        if ($error !== '') {
            throw new ApiException('upstream', 'Could not reach the city search service: ' . $error);
        }
        if ($status === 401) {
            throw new ApiException('auth', 'OpenWeatherMap rejected the API key.');
        }
        if ($status >= 400 || $data === null) {
            throw new ApiException('upstream', 'OpenWeatherMap geocoding error (HTTP ' . $status . ').');
        }

        $out = [];
        foreach ((array) $data as $r) {
            $out[] = [
                'id'      => crc32(($r['name'] ?? '') . ($r['country'] ?? '')),
                'name'    => (string) ($r['name'] ?? ''),
                'country' => (string) ($r['country'] ?? ''),
                'admin'   => (string) ($r['state'] ?? ''),
                'lat'     => (float) ($r['lat'] ?? 0),
                'lon'     => (float) ($r['lon'] ?? 0),
            ];
        }

        return $out;
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    /** Cache helper — falls through to the loader on failure. */
    private function cached(string $key, callable $loader): array
    {
        if ($this->cache->enabled()) {
            $hit = $this->cache->get($key);
            if ($hit !== null) {
                return $hit;
            }
        }

        $data = $loader();
        $this->cache->set($key, $data, $this->cfg['cache_ttl']);
        return $data;
    }

    /** Map an OWM condition id/icon to our icon groups. */
    private function owmGroup(string $id, string $icon): string
    {
        if ($icon === '50d' || $icon === '50n' || (int) $id >= 700 && (int) $id < 800) {
            return 'fog';
        }

        $n = (int) $id;
        if ($n >= 200 && $n < 300) return 'thunder';
        if ($n >= 300 && $n < 400) return 'drizzle';
        if ($n >= 500 && $n < 600) return 'rain';
        if ($n >= 600 && $n < 700) return 'snow';
        if ($n === 800)            return 'clear';
        if ($n > 800 && $n < 900)  return 'clouds';

        return 'clouds';
    }

    private function owmIsDay(string $icon): bool
    {
        return substr($icon, -1) !== 'n';
    }

    /** Icon key used by the frontend SVG icon set (e.g. "rain", "clear-night"). */
    private function groupIcon(string $group, bool $isDay): string
    {
        if ($group === 'clear' && !$isDay) {
            return 'clear-night';
        }
        if ($group === 'partly' && !$isDay) {
            return 'partly-night';
        }
        return $group;
    }

    /** Convert an Open-Meteo local ISO string to a Unix timestamp. */
    private function localToTs(string $local, int $tzOffset): int
    {
        $ts = strtotime($local);
        return $ts === false ? 0 : $ts - $tzOffset;
    }
}
