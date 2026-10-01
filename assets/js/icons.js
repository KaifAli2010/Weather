/**
 * SkyCast — inline SVG weather icon set.
 * Animated, theme-aware icons keyed by condition group.
 */
(function (global) {
    'use strict';

    const S = 'http://www.w3.org/2000/svg';

    // Reusable SVG chunks
    const sun = `
        <g class="icon-sun">
            <circle cx="12" cy="12" r="5" fill="url(#scSunGrad)"/>
            <g class="icon-rays" stroke="url(#scSunGrad)" stroke-width="2" stroke-linecap="round">
                <line x1="12" y1="1.5" x2="12" y2="4"/>
                <line x1="12" y1="20" x2="12" y2="22.5"/>
                <line x1="1.5" y1="12" x2="4" y2="12"/>
                <line x1="20" y1="12" x2="22.5" y2="12"/>
                <line x1="4.6" y1="4.6" x2="6.4" y2="6.4"/>
                <line x1="17.6" y1="17.6" x2="19.4" y2="19.4"/>
                <line x1="4.6" y1="19.4" x2="6.4" y2="17.6"/>
                <line x1="17.6" y1="6.4" x2="19.4" y2="4.6"/>
            </g>
        </g>`;

    const moon = `
        <path class="icon-moon" d="M20.4 14.2A8.6 8.6 0 0 1 9.8 3.6a8.6 8.6 0 1 0 10.6 10.6z"
              fill="url(#scMoonGrad)"/>
        <g fill="url(#scMoonGrad)">
            <circle cx="17.5" cy="5" r="1" opacity=".8"/>
            <circle cx="21" cy="8.5" r=".8" opacity=".6"/>
        </g>`;

    const cloudSmall = (x = 0, y = 0, s = 1) => `
        <g transform="translate(${x} ${y}) scale(${s})" class="icon-cloud">
            <path d="M7 18a4.5 4.5 0 0 1-.4-8.98A5.5 5.5 0 0 1 17.3 9.6 4 4 0 0 1 16.5 18H7z"
                  fill="url(#scCloudGrad)"/>
        </g>`;

    const cloudBig = (x = 0, y = 0, s = 1) => `
        <g transform="translate(${x} ${y}) scale(${s})" class="icon-cloud-big">
            <path d="M7 18a4.5 4.5 0 0 1-.4-8.98A5.5 5.5 0 0 1 17.3 9.6 4 4 0 0 1 16.5 18H7z"
                  fill="url(#scCloudGrad)"/>
        </g>`;

    const drops = (n) => {
        let out = '<g class="icon-drops" stroke="url(#scRainGrad)" stroke-width="1.8" stroke-linecap="round">';
        const xs = n === 3 ? [8, 12, 16] : [9.5, 14.5];
        for (const x of xs) {
            out += `<line x1="${x}" y1="18.5" x2="${x - 1.2}" y2="21.5"/>`;
        }
        return out + '</g>';
    };

    const flakes = `
        <g class="icon-flakes" fill="none" stroke="url(#scSnowGrad)" stroke-width="1.5" stroke-linecap="round">
            <line x1="8.5" y1="18.5" x2="8.5" y2="21.5"/>
            <line x1="7.2" y1="20" x2="9.8" y2="20"/>
            <line x1="15.5" y1="18.5" x2="15.5" y2="21.5"/>
            <line x1="14.2" y1="20" x2="16.8" y2="20"/>
        </g>`;

    const bolt = `
        <path class="icon-bolt" d="M12.8 15.5 9 21.2l1.2-4.3-1.9-.4 3-5.3-.8 3.8 1.7.2.6.3z"
              fill="url(#scBoltGrad)"/>`;

    const fogLines = `
        <g class="icon-fog" stroke="url(#scCloudGrad)" stroke-width="1.8" stroke-linecap="round" opacity=".9">
            <line x1="4" y1="17" x2="18" y2="17"/>
            <line x1="6" y1="20" x2="20" y2="20"/>
        </g>`;

    const defs = `
        <defs>
            <linearGradient id="scSunGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#ffd94d"/>
                <stop offset="100%" stop-color="#ff9e2c"/>
            </linearGradient>
            <linearGradient id="scMoonGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#f4f7ff"/>
                <stop offset="100%" stop-color="#c2cdf2"/>
            </linearGradient>
            <linearGradient id="scCloudGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#ffffff"/>
                <stop offset="100%" stop-color="#c9d8ec"/>
            </linearGradient>
            <linearGradient id="scRainGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#6ec3ff"/>
                <stop offset="100%" stop-color="#2f7bd9"/>
            </linearGradient>
            <linearGradient id="scSnowGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#e8f4ff"/>
                <stop offset="100%" stop-color="#a8c8ec"/>
            </linearGradient>
            <linearGradient id="scBoltGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#ffe259"/>
                <stop offset="100%" stop-color="#ffa751"/>
            </linearGradient>
        </defs>`;

    const ICONS = {
        'clear':          `<svg viewBox="0 0 24 24">${defs}${sun}</svg>`,
        'clear-night':    `<svg viewBox="0 0 24 24">${defs}${moon}</svg>`,
        'partly':         `<svg viewBox="0 0 24 24">${defs}${sun}${cloudSmall(6, 4.5, .9)}</svg>`,
        'partly-night':   `<svg viewBox="0 0 24 24">${defs}${moon}${cloudSmall(6, 4.5, .9)}</svg>`,
        'clouds':         `<svg viewBox="0 0 24 24">${defs}${cloudBig(2, 2, 1)}${cloudSmall(9, 6, .75)}</svg>`,
        'fog':            `<svg viewBox="0 0 24 24">${defs}${cloudBig(2, 0, .95)}${fogLines}</svg>`,
        'drizzle':        `<svg viewBox="0 0 24 24">${defs}${cloudBig(2, 0, .95)}${drops(2)}</svg>`,
        'rain':           `<svg viewBox="0 0 24 24">${defs}${cloudBig(2, 0, .95)}${drops(3)}</svg>`,
        'snow':           `<svg viewBox="0 0 24 24">${defs}${cloudBig(2, 0, .95)}${flakes}</svg>`,
        'thunder':        `<svg viewBox="0 0 24 24">${defs}${cloudBig(2, 0, .95)}${bolt}${drops(2)}</svg>`,
    };

    const PLACEHOLDER = ICONS.clouds;

    /**
     * Render a weather icon.
     * @param {string} key icon key (clear, rain, snow, thunder, ...)
     * @param {string} [cls] extra CSS classes
     * @returns {string} SVG markup
     */
    function icon(key, cls) {
        const svg = ICONS[key] || PLACEHOLDER;
        if (cls) {
            return svg.replace('<svg ', `<svg class="${cls}" `);
        }
        return svg;
    }

    global.SkyIcons = { icon: icon, keys: Object.keys(ICONS) };
})(window);
