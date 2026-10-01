/**
 * SkyCast — application controller.
 * Handles state, search, suggestions, rendering, units, themes,
 * favourites, recents, clock and background animation.
 */
(function () {
    'use strict';

    /* ── State & persistence ──────────────────────────────────────── */

    const LS = {
        theme: 'skycast.theme',
        unit: 'skycast.unit',
        favs: 'skycast.favs',
        recents: 'skycast.recents',
        last: 'skycast.last',
    };

    const state = {
        unit: localStorage.getItem(LS.unit) || 'C',
        theme: localStorage.getItem(LS.theme) || 'dark',
        data: null,          // last weather payload (Celsius base)
        location: null,      // {name, country, admin, lat, lon}
        clockTimer: null,
        sugIndex: -1,
        sugItems: [],
        searchToken: 0,
    };

    let favs = loadList(LS.favs);
    let recents = loadList(LS.recents);

    function loadList(key) {
        try {
            const v = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(v) ? v : [];
        } catch (_) {
            return [];
        }
    }

    function saveList(key, list) {
        try {
            localStorage.setItem(key, JSON.stringify(list.slice(0, 12)));
        } catch (_) { /* storage full / disabled — non fatal */ }
    }

    /* ── DOM shortcuts ────────────────────────────────────────────── */

    const $ = (id) => document.getElementById(id);

    const el = {
        input: $('city-input'),
        searchBtn: $('search-btn'),
        clearBtn: $('clear-input'),
        suggestions: $('suggestions'),
        heroCity: $('hero-city'),
        heroCountry: $('hero-country'),
        heroIcon: $('hero-icon'),
        heroTemp: $('hero-temp'),
        heroUnit: document.querySelector('.hero-unit'),
        heroDesc: $('hero-desc'),
        heroFeels: $('hero-feels'),
        heroDate: $('hero-date'),
        heroTime: $('hero-time'),
        heroUpdated: $('hero-updated'),
        heroDetails: $('hero-details'),
        sunriseTime: $('sunrise-time'),
        sunsetTime: $('sunset-time'),
        sunProgress: $('sun-progress'),
        forecastGrid: $('forecast-grid'),
        forecastProvider: $('forecast-provider'),
        dashboard: $('dashboard'),
        themeToggle: $('theme-toggle'),
        unitToggle: $('unit-toggle'),
        refreshBtn: $('refresh-btn'),
        favBtn: $('fav-btn'),
        favList: $('fav-list'),
        favClear: $('fav-clear'),
        recentList: $('recent-list'),
        recentClear: $('recent-clear'),
        alertBanner: $('alert-banner'),
        toast: $('toast'),
        canvas: $('sky-canvas'),
    };

    /* ── Loading bar (created dynamically) ────────────────────────── */

    const loadingBar = document.createElement('div');
    loadingBar.className = 'loading-bar';
    loadingBar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(loadingBar);

    let barTimer = null;

    function barStart() {
        clearTimeout(barTimer);
        loadingBar.classList.remove('done');
        loadingBar.classList.add('active');
    }

    function barDone() {
        loadingBar.classList.remove('active');
        loadingBar.classList.add('done');
        barTimer = setTimeout(() => loadingBar.classList.remove('done'), 450);
    }

    /* ── Toast & alerts ───────────────────────────────────────────── */

    let toastTimer = null;

    function toast(message, kind) {
        el.toast.querySelector('.toast-text').textContent = message;
        el.toast.querySelector('.toast-icon').className =
            'bi toast-icon ' + (kind === 'error' ? 'bi-exclamation-triangle' : 'bi-check-circle');
        el.toast.classList.toggle('error', kind === 'error');
        el.toast.hidden = false;
        requestAnimationFrame(() => el.toast.classList.add('show'));

        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            el.toast.classList.remove('show');
            setTimeout(() => { el.toast.hidden = true; }, 320);
        }, 2600);
    }

    function showAlert(message, title, kind) {
        el.alertBanner.querySelector('.alert-title').textContent = title || '';
        el.alertBanner.querySelector('.alert-message').textContent = message || '';
        el.alertBanner.querySelector('.alert-icon').className =
            'bi alert-icon ' + (kind === 'info' ? 'bi-info-circle' : 'bi-exclamation-triangle');
        el.alertBanner.classList.toggle('info', kind === 'info');
        el.alertBanner.hidden = false;
    }

    function hideAlert() {
        el.alertBanner.hidden = true;
    }

    el.alertBanner.querySelector('.btn-close-custom').addEventListener('click', hideAlert);

    /** Map API/network errors to friendly messages. */
    function friendlyError(err) {
        const type = err && err.type ? err.type : 'server';
        const map = {
            city: ['City not found', null],
            bad_request: ['Invalid search', null],
            auth: ['API key problem', 'Your weather provider rejected the API key — check api/config.php.'],
            rate: ['Rate limit reached', 'The weather service is busy right now. Please wait a moment and try again.'],
            upstream: ['Weather service issue', 'The weather service is temporarily unavailable. Please try again shortly.'],
            config: ['Configuration needed', 'See api/config.php to finish setting up your weather provider.'],
            network: ['Connection problem', 'Could not reach the weather server. Check your internet connection.'],
            timeout: ['Request timed out', 'The request took too long. Check your connection and try again.'],
            server: ['Something went wrong', null],
        };
        const [title, hint] = map[type] || map.server;
        return { title, message: hint || (err && err.message) || 'Please try again.' };
    }

    /* ── Units & formatting ───────────────────────────────────────── */

    const isF = () => state.unit === 'F';

    function convertTemp(c) {
        return isF() ? (c * 9 / 5) + 32 : c;
    }

    function fmtTemp(c, withUnit) {
        const v = Math.round(convertTemp(c));
        return withUnit ? `${v}°${state.unit}` : `${v}°`;
    }

    function unitLabel() {
        return isF() ? '°F' : '°C';
    }

    /* Local time helpers — ts is UTC seconds, offset in seconds. */
    function localDate(ts, offsetSec) {
        return new Date((ts + offsetSec) * 1000);
    }

    function pad(n) {
        return String(n).padStart(2, '0');
    }

    function fmtHM(d) {
        return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    }

    function fmtDayLong(d) {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const months = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        return `${days[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }

    function compass(deg) {
        if (deg === null || deg === undefined) return '';
        const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        return points[Math.round(deg / 22.5) % 16];
    }

    function uvLabel(uv) {
        if (uv === null || uv === undefined) return '';
        if (uv < 3) return 'Low';
        if (uv < 6) return 'Moderate';
        if (uv < 8) return 'High';
        if (uv < 11) return 'Very high';
        return 'Extreme';
    }

    function locationLabel(loc) {
        return [loc.name, loc.admin && loc.admin !== loc.name ? loc.admin : null, loc.country]
            .filter(Boolean).join(', ');
    }

    function sameLocation(a, b) {
        return a && b &&
            a.name === b.name &&
            Math.abs((a.lat || 0) - (b.lat || 0)) < 0.05 &&
            Math.abs((a.lon || 0) - (b.lon || 0)) < 0.05;
    }

    /* ── Theme & unit toggles ─────────────────────────────────────── */

    function applyTheme() {
        document.documentElement.setAttribute('data-theme', state.theme);
        el.themeToggle.setAttribute('aria-pressed', String(state.theme === 'dark'));
        localStorage.setItem(LS.theme, state.theme);
        BackgroundArt.refresh();
    }

    function applyUnit() {
        document.documentElement.setAttribute('data-unit', state.unit);
        localStorage.setItem(LS.unit, state.unit);
        if (state.data) renderWeather(state.data);
    }

    el.themeToggle.addEventListener('click', () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        applyTheme();
    });

    el.unitToggle.addEventListener('click', () => {
        state.unit = isF() ? 'C' : 'F';
        applyUnit();
        toast(`Temperatures switched to ${unitLabel()}`);
    });

    /* ── Skeletons & loading states ───────────────────────────────── */

    const SKELETON_ELEMENTS = [
        el.heroCity, el.heroCountry, el.heroTemp, el.heroDesc,
        el.heroFeels, el.heroTime, el.heroDate, el.heroUpdated,
        el.sunriseTime, el.sunsetTime,
    ];

    function showSkeletons() {
        hideAlert();
        el.heroIcon.innerHTML = '';
        el.heroUnit.textContent = '°';
        SKELETON_ELEMENTS.forEach((node) => {
            node.classList.add('skeleton', 'sk-text');
            node.textContent = '████████';
        });

        el.heroDetails.innerHTML = Array.from({ length: 6 }, () =>
            `<div class="detail-tile skeleton">
                <div class="detail-head"><i class="bi bi-droplet"></i><span class="sk-text skeleton">████</span></div>
                <div class="detail-value skeleton sk-text">██████</div>
            </div>`).join('');

        el.sunProgress.style.width = '0%';

        el.forecastGrid.innerHTML = Array.from({ length: 5 }, (_, i) => {
            const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
            return `<div class="forecast-card skeleton">
                <div class="fc-day">${days[i]}</div>
                <div class="fc-icon sk-circle skeleton"></div>
                <div class="fc-desc skeleton sk-text">████</div>
                <div class="fc-max skeleton sk-text">██████</div>
            </div>`;
        }).join('');

        el.forecastProvider.textContent = '';
    }

    function clearSkeletons() {
        SKELETON_ELEMENTS.forEach((node) => node.classList.remove('skeleton', 'sk-text'));
        document.querySelectorAll('#dashboard .skeleton').forEach((node) => node.classList.remove('skeleton', 'sk-text'));
    }

    function setSearching(busy) {
        el.searchBtn.disabled = busy;
        el.searchBtn.querySelector('.spinner-border').classList.toggle('d-none', !busy);
        el.searchBtn.querySelector('.search-btn-text').classList.toggle('d-none', busy);
    }

    /* ── Weather loading & rendering ──────────────────────────────── */

    async function loadWeather(location, opts = {}) {
        const token = ++state.searchToken;

        setSearching(true);

        if (!state.data || opts.forceSkeleton) {
            showSkeletons();
        } else {
            el.dashboard.classList.add('loading');
            barStart();
        }

        el.refreshBtn.classList.add('spinning');
        el.refreshBtn.disabled = true;

        try {
            let data;
            if (location.lat !== undefined && location.lon !== undefined) {
                // "My Location" has no real name — let the server reverse-geocode it.
                data = (location.name && location.name !== 'My Location')
                    ? await SkyApi.weatherByCoordsNamed(location.lat, location.lon, location.name, location.country)
                    : await SkyApi.weatherByCoords(location.lat, location.lon);
            } else {
                data = await SkyApi.weatherByCity(location.name);
            }

            if (token !== state.searchToken) return; // a newer request superseded this one

            state.data = data;
            state.location = {
                name: data.location.name,
                country: data.location.country,
                admin: data.location.admin,
                lat: data.location.latitude,
                lon: data.location.longitude,
            };
            localStorage.setItem(LS.last, JSON.stringify(state.location));

            clearSkeletons();
            el.dashboard.classList.remove('loading');
            renderWeather(data);
            renderFavourites();
            if (opts.record) pushRecent({ ...state.location });
            hideAlert();
        } catch (err) {
            if (token !== state.searchToken) return;

            clearSkeletons();
            el.dashboard.classList.remove('loading');

            if (!state.data) {
                renderEmptyState();
            }

            const { title, message } = friendlyError(err);
            showAlert(message, title);
        } finally {
            barDone();
            setSearching(false);
            el.refreshBtn.classList.remove('spinning');
            el.refreshBtn.disabled = false;
        }
    }

    function renderEmptyState() {
        el.heroCity.textContent = '—';
        el.heroCountry.innerHTML = '&nbsp;';
        el.heroTemp.textContent = '--';
        el.heroUnit.textContent = '°';
        el.heroDesc.textContent = 'No weather data yet';
        el.heroFeels.textContent = '--°';
        el.heroDate.textContent = '—';
        el.heroTime.textContent = '--:--';
        el.heroUpdated.textContent = '—';
        el.heroIcon.innerHTML = '';
        el.heroDetails.innerHTML =
            '<div class="detail-tile"><div class="detail-head">Search for a city above to see live weather.</div></div>';
        el.sunriseTime.textContent = '--:--';
        el.sunsetTime.textContent = '--:--';
        el.sunProgress.style.width = '0%';
        el.forecastGrid.innerHTML = '';
        el.forecastProvider.textContent = '';
    }

    function renderWeather(data) {
        const cur = data.current;
        const loc = data.location;

        /* Hero */
        el.heroCity.textContent = loc.name;
        el.heroCountry.textContent = [loc.admin && loc.admin !== loc.name ? loc.admin : null, loc.country]
            .filter(Boolean).join(', ') || '\u00A0';
        el.heroIcon.innerHTML = SkyIcons.icon(cur.icon);
        el.heroTemp.textContent = fmtTemp(cur.temperature);
        el.heroUnit.textContent = unitLabel();
        el.heroDesc.textContent = cur.description || cur.condition;
        el.heroFeels.textContent = fmtTemp(cur.feels_like, true);
        el.heroUpdated.textContent = fmtHM(localDate(data.fetched_at, data.sun.timezone));

        /* Detail tiles */
        const tiles = [
            { icon: 'bi-droplet-half', label: 'Humidity', value: `${cur.humidity}%`, sub: 'Relative humidity' },
            { icon: 'bi-wind', label: 'Wind', value: `${cur.wind_speed}`, unit: 'km/h', sub: cur.wind_deg != null ? `From ${compass(cur.wind_deg)} (${cur.wind_deg}°)` : '' },
            { icon: 'bi-speedometer2', label: 'Pressure', value: `${cur.pressure}`, unit: 'hPa', sub: 'At surface level' },
            {
                icon: 'bi-eye', label: 'Visibility', unit: 'km',
                value: cur.visibility != null ? (cur.visibility >= 10 ? '10+' : cur.visibility) : '—',
                sub: cur.visibility != null ? (cur.visibility >= 10 ? 'Excellent' : cur.visibility >= 4 ? 'Good' : 'Poor') : '',
            },
            { icon: 'bi-clouds', label: 'Cloud cover', value: `${cur.clouds}%`, sub: cur.clouds > 60 ? 'Mostly cloudy sky' : cur.clouds > 25 ? 'Scattered clouds' : 'Mostly clear sky' },
            { icon: 'bi-sun', label: 'UV index', value: cur.uv_index != null ? cur.uv_index : '—', sub: cur.uv_index != null ? uvLabel(cur.uv_index) : '' },
            { icon: 'bi-geo', label: 'Coordinates', value: `${loc.latitude.toFixed(2)}°, ${loc.longitude.toFixed(2)}°`, sub: 'Latitude / Longitude' },
        ];

        el.heroDetails.innerHTML = tiles.map((t) => `
            <div class="detail-tile">
                <div class="detail-head"><i class="bi ${t.icon}" aria-hidden="true"></i><span>${t.label}</span></div>
                <div class="detail-value">${t.value}${t.unit ? `<small> ${t.unit}</small>` : ''}</div>
                ${t.sub ? `<div class="detail-sub">${t.sub}</div>` : ''}
            </div>`).join('');

        /* Sun card */
        const off = data.sun.timezone;
        el.sunriseTime.textContent = data.sun.sunrise ? fmtHM(localDate(data.sun.sunrise, off)) : '—';
        el.sunsetTime.textContent = data.sun.sunset ? fmtHM(localDate(data.sun.sunset, off)) : '—';

        // sunrise/sunset are plain UTC epochs — compare against UTC now directly.
        const nowEpoch = Date.now() / 1000;
        let pct = 0;
        if (data.sun.sunrise && data.sun.sunset) {
            if (nowEpoch < data.sun.sunrise) pct = 0;
            else if (nowEpoch > data.sun.sunset) pct = 100;
            else pct = ((nowEpoch - data.sun.sunrise) / (data.sun.sunset - data.sun.sunrise)) * 100;
        }
        el.sunProgress.style.width = `${Math.max(0, Math.min(100, pct))}%`;

        /* Forecast */
        el.forecastProvider.textContent = `Data · ${data.provider}`;
        el.forecastGrid.innerHTML = data.forecast.map((day, i) => {
            const d = parseYmd(day.date);
            const dayName = i === 0 ? 'Tomorrow' : shortDay(d);
            return `
            <div class="forecast-card" role="group" aria-label="${dayName} forecast">
                <div class="fc-day">${dayName}</div>
                <div class="fc-date">${shortDate(d)}</div>
                <div class="fc-icon">${SkyIcons.icon(day.icon)}</div>
                <div class="fc-desc">${escapeHtml(day.desc || day.condition)}</div>
                <div class="fc-temps">
                    <span class="fc-max">${fmtTemp(day.temp_max)}</span>
                    <span class="fc-min">${fmtTemp(day.temp_min)}</span>
                </div>
                ${day.pop != null ? `<div class="fc-pop"><i class="bi bi-droplet" aria-hidden="true"></i>${day.pop}%</div>` : ''}
            </div>`;
        }).join('');

        startClock();
    }

    function parseYmd(ymd) {
        const [y, m, d] = ymd.split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    function shortDay(d) {
        return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    }

    function shortDate(d) {
        return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    /* ── Live clock (location local time) ─────────────────────────── */

    function startClock() {
        clearInterval(state.clockTimer);

        const tick = () => {
            if (!state.data) return;
            const off = state.data.sun.timezone;
            const d = localDate(Math.floor(Date.now() / 1000), off);
            el.heroTime.textContent = fmtHM(d);
            el.heroDate.textContent = fmtDayLong(d);
        };

        tick();
        state.clockTimer = setInterval(tick, 1000);
    }

    /* ── Search ───────────────────────────────────────────────────── */

    function runSearch() {
        const q = el.input.value.trim();

        if (q === '') {
            showAlert('Type a city name first — for example Karachi, London or Dubai.', 'Empty search', 'info');
            el.input.focus();
            return;
        }

        hideAlert();
        closeSuggestions();
        loadWeather({ name: q }, { record: true });
    }

    el.searchBtn.addEventListener('click', runSearch);

    el.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (state.sugIndex >= 0 && state.sugItems[state.sugIndex]) {
                selectSuggestion(state.sugItems[state.sugIndex]);
            } else {
                runSearch();
            }
        } else if (e.key === 'ArrowDown' && !el.suggestions.hidden) {
            e.preventDefault();
            moveSuggestion(1);
        } else if (e.key === 'ArrowUp' && !el.suggestions.hidden) {
            e.preventDefault();
            moveSuggestion(-1);
        } else if (e.key === 'Escape') {
            closeSuggestions();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === '/' && document.activeElement !== el.input && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            el.input.focus();
            el.input.select();
        }
    });

    el.clearBtn.addEventListener('click', () => {
        el.input.value = '';
        el.clearBtn.hidden = true;
        closeSuggestions();
        el.input.focus();
    });

    el.input.addEventListener('input', () => {
        el.clearBtn.hidden = el.input.value.length === 0;
        scheduleSuggestions();
    });

    /* ── Suggestions ──────────────────────────────────────────────── */

    let sugTimer = null;
    let sugToken = 0;

    function scheduleSuggestions() {
        clearTimeout(sugTimer);
        const q = el.input.value.trim();

        if (q.length < 2) {
            closeSuggestions();
            return;
        }

        const token = ++sugToken;
        sugTimer = setTimeout(() => fetchSuggestions(q, token), 280);
    }

    async function fetchSuggestions(query, token) {
        try {
            const data = await SkyApi.geocode(query, 6);
            if (token !== sugToken) return; // closed or superseded while loading
            state.sugItems = (data && data.results) || [];
            state.sugIndex = -1;
            renderSuggestions(query);
        } catch (_) {
            // Suggestions are best-effort — search itself will surface errors.
            if (token !== sugToken) return;
            closeSuggestions();
        }
    }

    function renderSuggestions(query) {
        if (state.sugItems.length === 0) {
            el.suggestions.innerHTML =
                `<div class="sug-empty">No matches for “${escapeHtml(query)}” — press Enter to search anyway.</div>`;
        } else {
            el.suggestions.innerHTML = state.sugItems.map((r, i) => `
                <button class="suggestion" type="button" role="option" data-idx="${i}"
                        aria-label="${escapeHtml(locationLabel(r))}">
                    <i class="bi bi-geo-alt" aria-hidden="true"></i>
                    <span>
                        <span class="sug-name">${escapeHtml(r.name)}</span><br>
                        <span class="sug-sub">${escapeHtml(locationLabel(r).substring(r.name.length + 2))}</span>
                    </span>
                </button>`).join('');

            el.suggestions.querySelectorAll('.suggestion').forEach((btn) => {
                btn.addEventListener('click', () => selectSuggestion(state.sugItems[Number(btn.dataset.idx)]));
            });
        }

        el.suggestions.hidden = false;
        el.input.setAttribute('aria-expanded', 'true');
    }

    function moveSuggestion(delta) {
        const buttons = el.suggestions.querySelectorAll('.suggestion');
        if (buttons.length === 0) return;

        state.sugIndex = (state.sugIndex + delta + buttons.length) % buttons.length;
        buttons.forEach((b, i) => b.classList.toggle('active', i === state.sugIndex));
        buttons[state.sugIndex].scrollIntoView({ block: 'nearest' });
    }

    function closeSuggestions() {
        clearTimeout(sugTimer);
        sugToken++;
        el.suggestions.hidden = true;
        el.input.setAttribute('aria-expanded', 'false');
        state.sugIndex = -1;
        state.sugItems = [];
    }

    function selectSuggestion(loc) {
        if (!loc) return;
        el.input.value = loc.name;
        closeSuggestions();
        hideAlert();
        const full = { name: loc.name, country: loc.country || '', admin: loc.admin || '', lat: loc.lat, lon: loc.lon };
        loadWeather(full, { record: true });
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-shell')) {
            closeSuggestions();
        }
    });

    /* ── Quick city chips ─────────────────────────────────────────── */

    document.querySelectorAll('.quick-cities .chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            const city = chip.dataset.city;
            el.input.value = city;
            el.clearBtn.hidden = false;
            hideAlert();
            loadWeather({ name: city }, { record: true });
        });
    });

    /* ── Geolocation ──────────────────────────────────────────────── */

    $('geo-btn').addEventListener('click', () => {
        if (!navigator.geolocation) {
            showAlert('Geolocation is not supported by this browser.', 'Not available');
            return;
        }

        showToastFor('Detecting your location…');

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                hideAlert();
                const loc = {
                    name: 'My Location',
                    lat: Number(pos.coords.latitude.toFixed(4)),
                    lon: Number(pos.coords.longitude.toFixed(4)),
                };
                loadWeather(loc);
            },
            (err) => {
                const msg = err.code === err.PERMISSION_DENIED
                    ? 'Location permission was denied. Search for a city by name instead.'
                    : 'Could not determine your location. Try searching for a city instead.';
                showAlert(msg, 'Location unavailable');
            },
            { timeout: 10000, maximumAge: 300000 }
        );
    });

    function showToastFor(text) {
        el.toast.querySelector('.toast-text').textContent = text;
        el.toast.querySelector('.toast-icon').className = 'bi toast-icon bi-geo';
        el.toast.hidden = false;
        requestAnimationFrame(() => el.toast.classList.add('show'));
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            el.toast.classList.remove('show');
            setTimeout(() => { el.toast.hidden = true; }, 320);
        }, 2600);
    }

    /* ── Favourites ───────────────────────────────────────────────── */

    el.favBtn.addEventListener('click', () => {
        if (!state.location) return;

        const idx = favs.findIndex((f) => sameLocation(f, state.location));
        if (idx >= 0) {
            favs.splice(idx, 1);
            toast('Removed from favourites');
        } else {
            favs.unshift({ ...state.location });
            favs = favs.slice(0, 8);
            toast('Added to favourites');
        }

        saveList(LS.favs, favs);
        renderFavourites();
    });

    el.favClear.addEventListener('click', () => {
        favs = [];
        saveList(LS.favs, favs);
        renderFavourites();
        toast('Favourites cleared');
    });

    function renderFavourites() {
        el.favClear.hidden = favs.length === 0;

        if (favs.length === 0) {
            el.favList.innerHTML = '<span class="empty-hint">No favourites yet — tap the star next to a city name.</span>';
        } else {
            el.favList.innerHTML = favs.map((f, i) => `
                <span class="chip" data-idx="${i}">
                    ${escapeHtml(f.name)}
                    <button class="chip-remove" type="button" data-remove="${i}" aria-label="Remove ${escapeHtml(f.name)}">
                        <i class="bi bi-x-lg" aria-hidden="true"></i>
                    </button>
                </span>`).join('');

            el.favList.querySelectorAll('.chip').forEach((chip) => {
                chip.addEventListener('click', (e) => {
                    if (e.target.closest('.chip-remove')) return;
                    hideAlert();
                    loadWeather(favs[Number(chip.dataset.idx)]);
                });
            });

            el.favList.querySelectorAll('.chip-remove').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    favs.splice(Number(btn.dataset.remove), 1);
                    saveList(LS.favs, favs);
                    renderFavourites();
                });
            });
        }

        const active = state.location && favs.some((f) => sameLocation(f, state.location));
        el.favBtn.classList.toggle('active', Boolean(active));
        el.favBtn.setAttribute('aria-pressed', String(Boolean(active)));
        el.favBtn.setAttribute('aria-label', active ? 'Remove from favourites' : 'Add to favourites');
    }

    /* ── Recents ──────────────────────────────────────────────────── */

    function pushRecent(loc) {
        recents = recents.filter((r) => !sameLocation(r, loc));
        recents.unshift(loc);
        recents = recents.slice(0, 8);
        saveList(LS.recents, recents);
        renderRecents();
    }

    el.recentClear.addEventListener('click', () => {
        recents = [];
        saveList(LS.recents, recents);
        renderRecents();
        toast('Recent searches cleared');
    });

    function renderRecents() {
        el.recentClear.hidden = recents.length === 0;

        if (recents.length === 0) {
            el.recentList.innerHTML = '<span class="empty-hint">Your recent searches will appear here.</span>';
            return;
        }

        el.recentList.innerHTML = recents.map((r, i) => `
            <span class="chip" data-idx="${i}">
                ${escapeHtml(r.name)}
                <button class="chip-remove" type="button" data-remove="${i}" aria-label="Remove ${escapeHtml(r.name)}">
                    <i class="bi bi-x-lg" aria-hidden="true"></i>
                </button>
            </span>`).join('');

        el.recentList.querySelectorAll('.chip').forEach((chip) => {
            chip.addEventListener('click', (e) => {
                if (e.target.closest('.chip-remove')) return;
                hideAlert();
                const loc = recents[Number(chip.dataset.idx)];
                el.input.value = loc.name;
                el.clearBtn.hidden = false;
                loadWeather(loc);
            });
        });

        el.recentList.querySelectorAll('.chip-remove').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                recents.splice(Number(btn.dataset.remove), 1);
                saveList(LS.recents, recents);
                renderRecents();
            });
        });
    }

    /* ── Refresh ──────────────────────────────────────────────────── */

    el.refreshBtn.addEventListener('click', () => {
        if (!state.location) return;
        hideAlert();
        loadWeather(state.location);
    });

    /* ── Background canvas art ────────────────────────────────────── */

    const BackgroundArt = (function () {
        const canvas = el.canvas;
        const ctx = canvas.getContext('2d');
        let particles = [];
        let raf = null;
        let w = 0;
        let h = 0;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            w = window.innerWidth;
            h = window.innerHeight;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            build();
        }

        function build() {
            const count = Math.min(90, Math.floor(w / 14));
            particles = Array.from({ length: count }, () => ({
                x: Math.random() * w,
                y: Math.random() * h,
                r: 0.8 + Math.random() * 2.2,
                vx: (Math.random() - 0.5) * 0.16,
                vy: -0.06 - Math.random() * 0.22,
                tw: Math.random() * Math.PI * 2,
                tws: 0.004 + Math.random() * 0.012,
            }));
        }

        function frame() {
            ctx.clearRect(0, 0, w, h);
            const light = state.theme === 'light';

            for (const p of particles) {
                p.x += p.vx;
                p.y += p.vy;
                p.tw += p.tws;

                if (p.y < -6) { p.y = h + 6; p.x = Math.random() * w; }
                if (p.x < -6) p.x = w + 6;
                if (p.x > w + 6) p.x = -6;

                const alpha = (0.28 + Math.abs(Math.sin(p.tw)) * 0.5) * (light ? 0.35 : 1);
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = light
                    ? `rgba(255, 255, 255, ${alpha})`
                    : `rgba(150, 205, 255, ${alpha})`;
                ctx.fill();
            }

            raf = requestAnimationFrame(frame);
        }

        function start() {
            if (raf) cancelAnimationFrame(raf);
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            frame();
        }

        window.addEventListener('resize', resize, { passive: true });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (raf) cancelAnimationFrame(raf);
                raf = null;
            } else {
                start();
            }
        });

        resize();
        start();

        return { refresh: build };
    })();

    /* ── Boot ─────────────────────────────────────────────────────── */

    applyTheme();
    applyUnit();
    renderFavourites();
    renderRecents();
    renderEmptyState();

    let initial = null;
    try {
        initial = JSON.parse(localStorage.getItem(LS.last) || 'null');
    } catch (_) { initial = null; }

    loadWeather(initial || { name: 'Karachi' }, { forceSkeleton: true });
})();
