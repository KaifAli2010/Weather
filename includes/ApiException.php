<?php
declare(strict_types=1);

/**
 * Domain exception carrying a machine-readable type that the API layer
 * maps onto an HTTP status and the frontend maps onto a friendly message.
 *
 * Types: bad_request | city | auth | rate | upstream | config | server
 */
final class ApiException extends RuntimeException
{
    public function __construct(public string $type, string $message)
    {
        parent::__construct($message);
    }

    public function httpStatus(): int
    {
        return match ($this->type) {
            'bad_request' => 400,
            'city'        => 404,
            'auth'        => 401,
            'rate'        => 429,
            'upstream'    => 502,
            default       => 500,
        };
    }
}
