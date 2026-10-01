<?php
declare(strict_types=1);

/**
 * GET api/weather.php
 *
 * Params (one of):
 *   ?city=<name>            e.g. ?city=Karachi
 *   ?lat=<float>&lon=<float> e.g. ?lat=24.86&lon=67.01
 *
 * Returns normalised current conditions + 5-day forecast.
 */

require_once __DIR__ . '/bootstrap.php';

Response::preflight();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    Response::error('Only GET requests are supported.', 405, 'bad_request');
}

$city = isset($_GET['city']) ? trim((string) $_GET['city']) : '';
$lat  = isset($_GET['lat'])  ? filter_var($_GET['lat'], FILTER_VALIDATE_FLOAT) : false;
$lon  = isset($_GET['lon'])  ? filter_var($_GET['lon'], FILTER_VALIDATE_FLOAT) : false;
$name = isset($_GET['name']) ? trim((string) $_GET['name']) : '';
$country = isset($_GET['country']) ? trim((string) $_GET['country']) : '';

$coords = null;
if ($lat !== false && $lon !== false && $lat !== null && $lon !== null) {
    if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) {
        Response::error('Invalid coordinates. Latitude must be between -90 and 90 and longitude between -180 and 180.', 400, 'bad_request');
    }

    if ($name !== '') {
        // Client already knows the place name (search suggestion / favourite).
        $coords = [
            'lat'     => (float) $lat,
            'lon'     => (float) $lon,
            'name'    => mb_substr($name, 0, 80),
            'country' => mb_substr($country, 0, 80),
            'admin'   => '',
        ];
    } else {
        // Raw coordinates (browser geolocation) — resolve a display name.
        $coords = sky_service()->reverseGeocode((float) $lat, (float) $lon);
    }
} elseif ($city !== '') {
    if (mb_strlen($city) > 80) {
        Response::error('That city name is too long. Please try a shorter name.', 400, 'bad_request');
    }
    if (!preg_match('/^[\p{L}\p{N}\s\.\,\-\'()]+$/u', $city)) {
        Response::error('City names can only contain letters, spaces, hyphens and apostrophes.', 400, 'bad_request');
    }
} else {
    Response::error('Please provide a city name (?city=London) or coordinates (?lat=..&lon=..).', 400, 'bad_request');
}

try {
    $weather = sky_service()->getWeather($coords, $city !== '' ? $city : null);
    Response::ok($weather);
} catch (ApiException $e) {
    Response::error($e->getMessage(), $e->httpStatus(), $e->type);
}
