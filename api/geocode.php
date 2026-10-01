<?php
declare(strict_types=1);

/**
 * GET api/geocode.php?q=<name>&limit=<n>
 *
 * City search suggestions. Returns a list of matching locations.
 */

require_once __DIR__ . '/bootstrap.php';

Response::preflight();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    Response::error('Only GET requests are supported.', 405, 'bad_request');
}

if (!isset($_GET['q'])) {
    Response::error('Missing required parameter: q', 400, 'bad_request');
}

$query = trim((string) $_GET['q']);

if ($query === '') {
    Response::error('Please type a city name to search.', 400, 'bad_request');
}

if (mb_strlen($query) > 80) {
    Response::error('That search is too long. Please try a shorter name.', 400, 'bad_request');
}

if (!preg_match('/^[\p{L}\p{N}\s\.\,\-\'()]+$/u', $query)) {
    Response::error('Search can only contain letters, spaces, hyphens and apostrophes.', 400, 'bad_request');
}

$limit = 6;
if (isset($_GET['limit'])) {
    $limit = (int) $_GET['limit'];
    if ($limit < 1)     $limit = 1;
    if ($limit > 10)    $limit = 10;
}

try {
    Response::ok([
        'query' => $query,
        'results' => sky_service()->search($query, $limit),
    ]);
} catch (ApiException $e) {
    Response::error($e->getMessage(), $e->httpStatus(), $e->type);
}
