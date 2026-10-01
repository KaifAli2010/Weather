<?php
declare(strict_types=1);

/**
 * Minimal HTTP GET client with cURL support and a streams fallback.
 * Returns [body, statusCode, error] — never throws.
 */
final class Http
{
    /** @return array{0:string,1:int,2:string} [body, status, error] */
    public static function get(string $url, int $timeout = 10): array
    {
        $verify = defined('SKY_VERIFY_SSL') ? SKY_VERIFY_SSL : true;

        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HEADER         => false,
                CURLOPT_TIMEOUT        => $timeout,
                CURLOPT_CONNECTTIMEOUT => 5,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_MAXREDIRS      => 3,
                CURLOPT_USERAGENT      => 'SkyCast/1.0 (local weather app)',
                CURLOPT_SSL_VERIFYPEER => $verify,
                CURLOPT_SSL_VERIFYHOST => $verify ? 2 : 0,
                CURLOPT_ENCODING       => '',
            ]);

            $body   = curl_exec($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $errNo  = curl_errno($ch);
            $errMsg = curl_error($ch);
            curl_close($ch);

            if ($body === false) {
                $hint = '';
                if (in_array($errNo, [60, 61, 77], true)) {
                    $hint = ' (SSL certificate problem — set SKY_VERIFY_SSL to false in api/config.php, ' .
                            'or install cacert.pem and set curl.cainfo in php.ini)';
                }
                return ['', 0, 'cURL error ' . $errNo . ': ' . $errMsg . $hint];
            }

            return [(string) $body, $status, ''];
        }

        // Fallback: HTTP streams wrapper (requires allow_url_fopen = On).
        $context = stream_context_create([
            'http' => [
                'method'        => 'GET',
                'timeout'       => $timeout,
                'ignore_errors' => true,
                'user_agent'    => 'SkyCast/1.0 (local weather app)',
            ],
            'ssl' => [
                'verify_peer'      => $verify,
                'verify_peer_name' => $verify,
            ],
        ]);

        $body = @file_get_contents($url, false, $context);
        if ($body === false) {
            return ['', 0, 'Unable to reach the weather service. Enable the cURL extension ' .
                '(extension=curl in php.ini) or set allow_url_fopen = On.'];
        }

        $status = 0;
        if (!empty($http_response_header) && is_array($http_response_header)) {
            foreach ($http_response_header as $line) {
                if (preg_match('#^HTTP/\S+\s+(\d{3})#i', $line, $m)) {
                    $status = (int) $m[1];
                }
            }
        }

        return [(string) $body, $status, ''];
    }

    /** @return array{0:?array,1:int,2:string} [decodedBody|null, status, error] */
    public static function getJson(string $url, int $timeout = 10): array
    {
        [$body, $status, $error] = self::get($url, $timeout);

        if ($error !== '') {
            return [null, $status, $error];
        }

        $decoded = json_decode($body, true);
        if (!is_array($decoded)) {
            return [null, $status, 'Weather service returned an invalid response.'];
        }

        return [$decoded, $status, ''];
    }
}
