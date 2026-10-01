<?php
declare(strict_types=1);

/**
 * Lightweight file-based response cache.
 * Reduces upstream API calls and keeps the free-tier quotas safe.
 * Degrades silently (no caching) when the directory is not writable.
 */
final class Cache
{
    private string $dir;
    private bool $enabled;

    public function __construct(string $dir, bool $enabled)
    {
        $this->dir     = rtrim($dir, '/\\');
        $this->enabled = $enabled;

        if ($this->enabled) {
            if (!is_dir($this->dir) && !@mkdir($this->dir, 0755, true)) {
                $this->enabled = false;
            } elseif (!is_writable($this->dir)) {
                $this->enabled = false;
            } else {
                $this->protectDirectory();
            }
        }
    }

    public function enabled(): bool
    {
        return $this->enabled;
    }

    public function get(string $key): ?array
    {
        if (!$this->enabled) {
            return null;
        }

        $path = $this->path($key);
        if (!is_file($path)) {
            return null;
        }

        $raw = @file_get_contents($path);
        if ($raw === false) {
            return null;
        }

        $entry = json_decode($raw, true);
        if (!is_array($entry) || !isset($entry['expires'], $entry['data']) || !is_array($entry['data'])) {
            return null;
        }

        if (time() > (int) $entry['expires']) {
            @unlink($path);
            return null;
        }

        return $entry['data'];
    }

    public function set(string $key, array $data, int $ttl): void
    {
        if (!$this->enabled) {
            return;
        }

        $payload = json_encode(
            ['expires' => time() + $ttl, 'data' => $data],
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        );

        if ($payload === false) {
            return;
        }

        $path = $this->path($key);
        $tmp  = $path . '.' . uniqid('tmp', true) . '.json';

        if (@file_put_contents($tmp, $payload) !== false) {
            @rename($tmp, $path);
        } else {
            @unlink($tmp);
        }
    }

    private function path(string $key): string
    {
        return $this->dir . '/' . sha1($key) . '.json';
    }

    /** Block direct web access to cached JSON via Apache. */
    private function protectDirectory(): void
    {
        $htaccess = $this->dir . '/.htaccess';
        if (!is_file($htaccess)) {
            @file_put_contents($htaccess, "# SkyCast cache - deny direct access\nRequire all denied\n");
        }
    }
}
