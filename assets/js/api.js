/**
 * SkyCast — frontend API client.
 * Wraps fetch() with timeouts, abort control and friendly error mapping.
 */
(function (global) {
    'use strict';

    const TIMEOUT_MS = 15000;

    /** In-flight requests by name, so we can cancel superseded searches. */
    const controllers = new Map();

    /**
     * @param {string} url
     * @param {{timeout?: number, signalKey?: string}} [opts]
     * @returns {Promise<any>} resolved with response.data
     */
    async function request(url, opts = {}) {
        const key = opts.signalKey || null;
        if (key && controllers.has(key)) {
            controllers.get(key).abort();
        }

        const controller = new AbortController();
        if (key) {
            controllers.set(key, controller);
        }

        const timer = setTimeout(() => controller.abort(), opts.timeout || TIMEOUT_MS);

        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: { Accept: 'application/json' },
                signal: controller.signal,
                cache: 'no-store',
            });

            let body = null;
            try {
                body = await res.json();
            } catch (_) {
                if (!res.ok) {
                    throw apiError(`The server returned an error (HTTP ${res.status}).`, res.status, 'server');
                }
                throw apiError('The server returned an unexpected response format.', 0, 'server');
            }

            if (!res.ok || body && body.success === false) {
                const err = (body && body.error) || {};
                throw apiError(
                    err.message || `Request failed (HTTP ${res.status}).`,
                    res.status,
                    err.type || 'server'
                );
            }

            return body ? body.data : null;
        } catch (e) {
            if (e && e.isSkyError) throw e;

            if (e && e.name === 'AbortError') {
                throw apiError('The request took too long and was cancelled. Check your connection and try again.', 0, 'timeout');
            }

            throw apiError(
                'Unable to reach the weather service. Check your internet connection and make sure the API is available.',
                0,
                'network'
            );
        } finally {
            clearTimeout(timer);
            if (key && controllers.get(key) === controller) {
                controllers.delete(key);
            }
        }
    }

    function apiError(message, status, type) {
        const err = new Error(message);
        err.isSkyError = true;
        err.status = status;
        err.type = type;
        return err;
    }

    const esc = (v) => encodeURIComponent(String(v == null ? '' : v));

    const Api = {
        /** Current weather + forecast for a city name. */
        weatherByCity(city) {
            return request(`api/weather.php?city=${esc(city)}`, { signalKey: 'weather' });
        },

        /** Current weather + forecast for coordinates (browser geolocation). */
        weatherByCoords(lat, lon) {
            return request(`api/weather.php?lat=${esc(lat)}&lon=${esc(lon)}`, { signalKey: 'weather' });
        },

        /** Weather for coordinates with a known display name (skips reverse lookup). */
        weatherByCoordsNamed(lat, lon, name, country) {
            return request(
                `api/weather.php?lat=${esc(lat)}&lon=${esc(lon)}&name=${esc(name)}&country=${esc(country)}`,
                { signalKey: 'weather' }
            );
        },

        /** City search suggestions. */
        geocode(query, limit = 6) {
            return request(`api/geocode.php?q=${esc(query)}&limit=${limit}`, { signalKey: 'geocode', timeout: 10000 });
        },

        /** Backend self-test. */
        health() {
            return request('api/health.php', { timeout: 20000 });
        },
    };

    global.SkyApi = Api;
})(window);
