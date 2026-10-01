<?php
declare(strict_types=1);

/**
 * SkyCast — JSON response helpers for the API layer.
 *
 * Every endpoint returns a consistent envelope:
 *   Success: {"success": true,  "data": {...}}
 *   Failure: {"success": false, "error": {"message": "...", "type": "..."}}
 */
final class Response
{
    public static function json(array $payload, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, max-age=0');
        header('X-Content-Type-Options: nosniff');
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Methods: GET, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');

        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function ok(array $data): void
    {
        self::json(['success' => true, 'data' => $data]);
    }

    public static function error(string $message, int $status = 400, string $type = 'bad_request'): void
    {
        self::json([
            'success' => false,
            'error'   => ['message' => $message, 'type' => $type],
        ], $status);
    }

    /** Standard preflight handler — call at the top of every endpoint. */
    public static function preflight(): void
    {
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Methods: GET, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
            http_response_code(204);
            exit;
        }
    }
}
