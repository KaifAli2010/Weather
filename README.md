# SkyCast — Live Weather Forecast

A production-ready weather dashboard: current conditions, a 5-day forecast, city search with
suggestions, favourites, recent searches, dark/light mode and a °C/°F toggle — built on a
dependency-free PHP 8 backend that needs **no API key** to run.

---

## Features

| Feature | Details |
|---|---|
| City search | Debounced suggestions with keyboard navigation (↑ ↓ Enter Esc), validation and friendly errors |
| Live weather | Current conditions, feels-like, humidity, wind, pressure, visibility, UV index, precipitation |
| 5-day forecast | Daily min/max, condition icons, precipitation chance |
| Sun card | Sunrise / sunset with daylight progress bar |
| Geolocation | One-click "use my location" with graceful fallback when denied |
| Weather icons | 10 animated inline-SVG condition icons (incl. night variants), theme-aware |
| Loading states | Skeleton shimmer on first load, dimmed refresh with progress bar afterwards |
| Error handling | Typed errors (city not found, rate limit, upstream down…), dismissible alert banner, data preserved on failure |
| Recent searches | Stored in `localStorage`, only successful lookups recorded, individually clearable |
| Favourite cities | Star toggle + chip list, persisted in `localStorage` |
| Dark / light mode | Persisted, respects first-visit system preference |
| °C / °F toggle | Persisted; instant client-side conversion, no refetch |
| Refresh button | Manual re-fetch with visible spinner, bypasses nothing — always shows fresh data |
| Responsive | Mobile-first, tested at 390px / 531px / desktop widths |
| Caching | File-based response cache (10 min TTL) to be gentle with the upstream API |
| Security | Input validation + XSS-safe output escaping, directory listings disabled, internals blocked |

---

## Requirements

- **PHP 8.0 or newer** (uses `declare(strict_types=1)`, typed properties, `str_contains`)
- Any web server that can run PHP: **XAMPP / WAMP / MAMP / Laragon**, or the built-in PHP server
- Internet access (the weather data comes from a public API)
- No Composer, no database, no build step

---

## Setup Instructions (XAMPP)

1. **Copy the folder** into your XAMPP web root, e.g.
   `C:\xampp\htdocs\weather-forecast-website`
   (the folder already contains everything — there is nothing to install or compile).

2. **Start Apache** in the XAMPP Control Panel. (PHP's `file_get_contents` with SSL must be
   enabled — it is by default in XAMPP.)

3. **Open the site** in your browser:
   `http://localhost/weather-forecast-website/`

4. That's it. The default data provider (Open-Meteo) is keyless, so the dashboard loads live
   weather immediately. Search for a city or click a popular-city chip to begin.

### Alternative: PHP built-in server (no Apache needed)

```bash
cd weather-forecast-website
php -S localhost:8090
# then open http://localhost:8090/
```

Note: the bundled `.htaccess` files are only read by Apache. The built-in server ignores them,
which is fine for local testing.

### File permissions

The API writes its cache into `includes/cache/`. On Linux/macOS make sure the web server user
can write there:

```bash
chmod -R 775 includes/cache
```

On XAMPP (Windows) this works out of the box.

---

## API Configuration Instructions

### Default: Open-Meteo (no key required)

`api/config.php` ships with:

```php
'provider' => 'openmeteo',
```

Open-Meteo needs **no account, no API key and no registration**. Leave this as-is and the site
works out of the box.

### Optional: switch to OpenWeatherMap

1. Create a free account at <https://openweathermap.org/api> and copy your API key.
2. Open `api/config.php` and set:

   ```php
   'provider'       => 'openweathermap',
   'openweather_key' => 'YOUR_REAL_KEY_HERE',
   'providers'      => ['openweathermap'],   // optional: use as fallback only
   ```

   - `providers` controls failover order. With `['openweathermap','openmeteo']` the service
     tries OpenWeatherMap first and silently falls back to Open-Meteo if the key is missing
     or the request fails.
3. Reload the site — the footer under the forecast shows which provider answered.

> Note: brand-new OpenWeatherMap keys can take a few minutes to activate. If you get an "auth"
> error right after signing up, wait ~10 minutes and retry.

### Other settings in `api/config.php`

| Key | Default | Purpose |
|---|---|---|
| `cache_ttl` | `600` | Seconds a weather response is cached on disk |
| `cache_enabled` | `true` | Set `false` to disable disk caching entirely |
| `verify_ssl` | `true` | Keep `true` in production; set `false` only if your PHP install lacks a CA bundle (see Troubleshooting) |

---

## Folder Structure

```
weather-forecast-website/
├── index.html               # The dashboard (single page)
├── README.md                # This file
├── .htaccess                # Apache tuning: caching, compression, no directory listing
├── api/
│   ├── bootstrap.php        # Shared boot: autoload, config, error handler
│   ├── config.php           # ★ Provider + cache configuration (edit provider here)
│   ├── weather.php          # GET  /api/weather.php?city=…  or  ?lat=…&lon=…
│   ├── geocode.php          # GET  /api/geocode.php?q=…      (city search suggestions)
│   └── health.php           # GET  /api/health.php           (diagnostics)
├── includes/
│   ├── .htaccess            # Blocks direct HTTP access to internals
│   ├── ApiException.php     # Typed exceptions → HTTP status + error type
│   ├── Cache.php            # File-based response cache
│   ├── Http.php             # HTTP client (cURL w/ stream fallback, timeouts)
│   ├── Response.php         # JSON envelope + CORS/preflight helpers
│   ├── WeatherService.php   # Provider abstraction, normalisation, WMO codes
│   └── cache/               # Runtime cache (auto-created, safe to empty)
├── assets/
│   ├── css/
│   │   └── style.css        # Full design system (themes, tokens, glassmorphism, responsive)
│   ├── js/
│   │   ├── api.js           # Fetch wrapper: timeouts, cancellation, typed errors
│   │   ├── app.js           # UI logic: search, render, favourites, recents, toggles, canvas background
│   │   └── icons.js         # Animated inline-SVG weather icon set
│   ├── icons/
│   │   └── favicon.svg
│   └── images/
│       ├── og-image.jpg         # Social sharing preview (1200×686)
│       └── apple-touch-icon.png # iOS home-screen icon (180×180)
```

---

## How It Works

- **Provider abstraction** — `WeatherService` fetches from the configured provider and
  normalises everything into one JSON shape, so the frontend never knows or cares which API
  answered. Adding a provider means adding one method, not touching the UI.
- **Error contract** — every API response is `{"success":true,"data":…}` or
  `{"success":false,"error":{"message":"…","type":"…"}}`. Error types
  (`bad_request`, `city`, `auth`, `rate`, `upstream`, `config`, `server`) map to HTTP status
  codes and are rendered as friendly messages in the alert banner.
- **Caching** — identical weather queries within `cache_ttl` seconds are served from
  `includes/cache/`, keyed by a hash of provider+query. Upstream failures are never cached.
- **Units** — all temperatures are stored/transferred in Celsius; the °C/°F toggle converts
  in the browser. Local times (sunrise/sunset, observation time) use the location's UTC offset
  returned by the API, so they are correct wherever the city is.
- **Persistence** — theme, unit, favourites and recents live in `localStorage` under
  `skycast.*` keys.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| **"Could not reach the weather service"** | Check your internet connection; then open `api/health.php` — it reports provider reachability. |
| **SSL / certificate errors** (cURL error 60, `openssl` failures) | Your PHP lacks a CA bundle. Download `cacert.pem` from <https://curl.se/ca/cacert.pem>, save it somewhere permanent, set `curl.cainfo` and `openssl.cafile` in `php.ini` to its full path, restart Apache. As a temporary workaround set `'verify_ssl' => false` in `api/config.php` (not recommended for production). |
| **500 error after uploading to a host** | Some shared hosts forbid `Options -Indexes`. Delete the `Options -Indexes` line from `.htaccess` and retry. |
| **Cache never seems to refresh** | Responses are cached for 10 minutes by design (`cache_ttl`). Lower it in `api/config.php`, or empty `includes/cache/` (keep the `.htaccess` inside). |
| **OpenWeatherMap "auth" error** | New keys take ~10 minutes to activate; also double-check the key was pasted without spaces. |
| **Social preview image is missing** | `og:image` is a relative path that resolves against your deployed URL. For the best result on social platforms, change it in `index.html` to the full public URL of `assets/images/og-image.jpg`. |
| **Geolocation does nothing** | Browsers only allow it on `https://` or `localhost`. On a plain-HTTP LAN address it is blocked by the browser — search by city instead. |

---

## Credits

- Weather data: [Open-Meteo](https://open-meteo.com/) (default) and [OpenWeatherMap](https://openweathermap.org/) (optional)
- Icons: hand-drawn inline SVG set bundled with the project
- UI framework: [Bootstrap 5](https://getbootstrap.com/) (CDN) + custom design system

---

*SkyCast — no build step, no database, no API key. Unzip, serve, enjoy.*
