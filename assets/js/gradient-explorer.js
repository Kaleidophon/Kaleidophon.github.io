// Gradient explorer for the mesh background, an easter egg: mesh-bg.js loads this file
// when the one odd-looking dot in the background is double-clicked / double-tapped
// (or when the URL contains ?gradient). It drives window.meshBackground from mesh-bg.js.
(function () {
    'use strict';

    var api = window.meshBackground;
    if (!api || window.gradientExplorer) return;

    var MAX_STOPS = 8, STORE = 'gradient-explorer';
    var original = api.getPalette();
    var root = document.documentElement;
    function cssVar(name, fallback) {
        var v = getComputedStyle(root).getPropertyValue(name).trim().toLowerCase();
        return /^#[0-9a-f]{6}$/.test(v) ? v : fallback;
    }
    // The other colours that have to go with the gradient. null means "auto": the colour
    // is worked out from the current gradient (see the auto* functions below).
    // While the gradient is still the site's own, auto simply means the site's own colours,
    // so opening the explorer changes nothing until a colour is touched.
    var siteExtra = {
        sidebarText: cssVar('--sidebar-text', '#ffffff'),
        accent: cssVar('--accent', '#49bf9d'),
        dot: api.getDotColor(),
        glow: api.getGlowColor()
    };
    function untouched() { return effective().join() === original.join(); }
    function fresh() {
        return { stops: original.slice(), brightness: 100, extra: { sidebarText: null, accent: null, dot: null, glow: null } };
    }

    var state = fresh();
    try {
        var saved = JSON.parse(localStorage.getItem(STORE));
        if (saved && saved.stops && saved.stops.length >= 2) {
            state = saved;
            if (!state.extra) state.extra = fresh().extra;
        }
    } catch (e) {}

    function clamp255(v) { return Math.max(0, Math.min(255, Math.round(v))); }
    function hex2(v) { return (v < 16 ? '0' : '') + v.toString(16); }
    function scaled(hex, pct) {
        var n = parseInt(hex.slice(1), 16), f = pct / 100;
        var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        // above 100% the colour is moved towards white, below it towards black
        if (f > 1) { r += (255 - r) * (f - 1); g += (255 - g) * (f - 1); b += (255 - b) * (f - 1); }
        else { r *= f; g *= f; b *= f; }
        return '#' + hex2(clamp255(r)) + hex2(clamp255(g)) + hex2(clamp255(b));
    }
    function effective() {
        return state.stops.map(function (h) { return scaled(h, state.brightness); });
    }
    // --- automatic colours -------------------------------------------------------------
    function rgbOf(hex) { var n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    function hexOf(r, g, b) { return '#' + hex2(clamp255(r)) + hex2(clamp255(g)) + hex2(clamp255(b)); }
    function luminance(hex) {
        var c = rgbOf(hex).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }
    function contrast(a, b) {
        var la = luminance(a), lb = luminance(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }
    function toHsl(hex) {
        var c = rgbOf(hex), r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min, h = 0, sat = 0;
        if (d > 0) {
            sat = d / (1 - Math.abs(2 * l - 1));
            if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
            h = (h * 60 + 360) % 360;
        }
        return [h, sat, l];
    }
    function fromHsl(h, sat, l) {
        var c = (1 - Math.abs(2 * l - 1)) * sat, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
        var rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
        return hexOf((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255);
    }
    function average(stops) {
        var sum = [0, 0, 0];
        stops.forEach(function (h) { var c = rgbOf(h); sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; });
        return hexOf(sum[0] / stops.length, sum[1] / stops.length, sum[2] / stops.length);
    }
    // header / footer font: white, or a deep shade of the gradient, whichever stays more
    // readable across all colours of the gradient
    function autoText(stops) {
        var hsl = toHsl(average(stops));
        var dark = fromHsl(hsl[0], Math.min(hsl[1], 0.45), 0.16);
        function worst(c) { return Math.min.apply(null, stops.map(function (s) { return contrast(c, s); })); }
        return worst('#ffffff') >= worst(dark) ? '#ffffff' : dark;
    }
    // link highlight: the most colourful gradient colour, deepened until it reads on the white page
    function autoAccent(stops) {
        var best = null, bestChroma = -1;
        stops.forEach(function (h) {
            var hsl = toHsl(h), chroma = hsl[1] * (1 - Math.abs(2 * hsl[2] - 1));
            if (chroma > bestChroma) { bestChroma = chroma; best = hsl; }
        });
        var sat = Math.max(best[1], 0.5), l = Math.min(best[2], 0.55), out = fromHsl(best[0], sat, l);
        while (contrast(out, '#ffffff') < 3 && l > 0.2) { l -= 0.02; out = fromHsl(best[0], sat, l); }
        return out;
    }
    // ripple flare: pale cream on dark and medium gradients; on light ones a pale flare
    // would vanish, so the accent colour is used there
    function autoGlow(stops) {
        return luminance(average(stops)) > 0.45 ? autoAccent(stops) : '#fff7e0';
    }
    // dots: null lets mesh-bg.js shade them from the gradient under each dot
    var AUTO = { sidebarText: autoText, accent: autoAccent, glow: autoGlow, dot: function () { return null; } };
    function resolved(key) { return state.extra[key] || (untouched() ? siteExtra[key] : AUTO[key](effective())); }

    function parseHexes(text) {
        var found = text.match(/#?\b[0-9a-f]{6}\b/gi) || [];
        return found.slice(0, MAX_STOPS).map(function (h) { return '#' + h.replace('#', '').toLowerCase(); });
    }

    var panel = document.createElement('div');
    panel.id = 'gradient-explorer';
    var LOOK = 'background:rgba(20,22,26,0.92);color:#eee;box-sizing:border-box;color-scheme:dark;' +
               'font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0;text-transform:none;';
    // Wide screens: a floating card in the corner. Narrow screens (the single-column layout):
    // a full-width block at the very top of the page, which slides down and pushes the page
    // along, so the header with its background stays in view below it.
    var narrow = window.matchMedia ? window.matchMedia('(max-width: 980px)') : { matches: false };
    function place() {
        var top = document.getElementById('header');
        if (narrow.matches && top) {
            panel.style.cssText = LOOK + 'position:relative;z-index:1;width:100%;padding:14px 1.5em;font-size:13px;';
            top.parentNode.insertBefore(panel, top);
        } else {
            panel.style.cssText = LOOK + 'position:fixed;right:16px;bottom:16px;z-index:9000;width:310px;' +
                'max-height:calc(100vh - 32px);overflow:auto;padding:12px 14px;border-radius:10px;' +
                'box-shadow:0 6px 24px rgba(0,0,0,0.35);';
            document.body.appendChild(panel);
        }
    }
    function isOpen() { return !!panel.parentNode; }
    function open() {
        place();
        apply();
        render();
        if (narrow.matches) {
            // drop in from above the top edge
            var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (panel.animate && !reduce) {
                panel.animate([{ marginTop: -panel.offsetHeight + 'px' }, { marginTop: '0px' }],
                              { duration: 320, easing: 'ease-out' });
            }
            window.scrollTo(0, 0);
        }
    }
    // closing keeps the chosen colours on the page until it is reloaded
    function close() {
        if (isOpen()) panel.parentNode.removeChild(panel);
    }
    var relayout = function () { if (isOpen()) place(); };
    if (narrow.addEventListener) narrow.addEventListener('change', relayout);
    else if (narrow.addListener) narrow.addListener(relayout);

    // presses inside the panel must not reach the page (no ripples, no drags, no scroll blocking)
    ['mousedown', 'touchstart', 'touchmove', 'click'].forEach(function (type) {
        panel.addEventListener(type, function (e) { e.stopPropagation(); });
    });

    var BTN = 'background:#333;color:#eee;border:1px solid #555;border-radius:5px;padding:3px 8px;' +
              'font:inherit;line-height:1.4;height:auto;cursor:pointer;letter-spacing:0;text-transform:none;box-shadow:none;';
    var FIELD = 'background:#111;color:#eee;border:1px solid #555;border-radius:5px;padding:3px 6px;' +
                'font:inherit;line-height:1.4;height:auto;box-sizing:border-box;';

    function el(tag, css, text) {
        var node = document.createElement(tag);
        if (css) node.style.cssText = css;
        if (text !== undefined) node.textContent = text;
        return node;
    }
    function button(label, onClick, title) {
        var b = el('button', BTN, label);
        b.type = 'button';
        if (title) b.title = title;
        b.addEventListener('click', onClick);
        return b;
    }

    var collapsed = false;

    function summary() {
        function line(label, key) {
            return label + (resolved(key) || 'shade of gradient') + (state.extra[key] ? '' : ' (auto)');
        }
        return line('sidebar text: ', 'sidebarText') + '\n' + line('link accent:  ', 'accent') + '\n' +
               line('dots:         ', 'dot') + '\n' + line('ripple flare: ', 'glow');
    }

    function apply() {
        api.setPalette(effective());
        root.style.setProperty('--sidebar-text', resolved('sidebarText'));
        root.style.setProperty('--accent', resolved('accent'));
        api.setDotColor(resolved('dot'));
        api.setGlowColor(resolved('glow'));
        try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) {}
    }

    function render() {
        panel.innerHTML = '';

        var head = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;');
        head.appendChild(el('strong', 'font-size:13px;', 'Gradient explorer'));
        var headButtons = el('div', 'display:flex;gap:6px;');
        headButtons.appendChild(button(collapsed ? 'show' : 'hide', function () { collapsed = !collapsed; render(); }));
        var closer = button('×', close, 'close');
        closer.setAttribute('aria-label', 'Close gradient explorer');
        headButtons.appendChild(closer);
        head.appendChild(headButtons);
        panel.appendChild(head);
        if (collapsed) return;

        var bar = el('div', 'height:18px;border-radius:5px;margin-bottom:10px;border:1px solid #555;');
        panel.appendChild(bar);

        var out = el('div', 'margin:8px 0 6px 0;word-break:break-all;user-select:all;-webkit-user-select:all;');
        var rowRefreshers = [];
        var extraOut = el('div', 'margin:0 0 8px 0;white-space:pre;user-select:all;-webkit-user-select:all;');

        function refreshOutput() {
            var eff = effective();
            bar.style.background = 'linear-gradient(90deg,' + eff.join(',') + ')';
            out.textContent = eff.join(' → ');
            extraOut.textContent = summary();
            rowRefreshers.forEach(function (fn) { fn(); });
        }

        state.stops.forEach(function (hex, i) {
            var row = el('div', 'display:flex;align-items:center;gap:6px;margin-bottom:5px;');
            var pick = el('input', 'width:34px;height:24px;padding:0;border:1px solid #555;border-radius:5px;background:none;cursor:pointer;');
            pick.type = 'color';
            pick.value = hex;
            var text = el('input', FIELD + 'width:78px;');
            text.type = 'text';
            text.value = hex;
            text.spellcheck = false;

            pick.addEventListener('input', function () {
                state.stops[i] = pick.value.toLowerCase();
                text.value = state.stops[i];
                apply();
                refreshOutput();
            });
            text.addEventListener('input', function () {
                var parsed = parseHexes(text.value);
                if (parsed.length !== 1) return;
                state.stops[i] = parsed[0];
                pick.value = parsed[0];
                apply();
                refreshOutput();
            });

            row.appendChild(el('span', 'width:12px;color:#999;', String(i + 1)));
            row.appendChild(pick);
            row.appendChild(text);
            row.appendChild(button('↑', function () {
                if (i === 0) return;
                state.stops.splice(i - 1, 0, state.stops.splice(i, 1)[0]);
                apply(); render();
            }, 'move up'));
            row.appendChild(button('↓', function () {
                if (i === state.stops.length - 1) return;
                state.stops.splice(i + 1, 0, state.stops.splice(i, 1)[0]);
                apply(); render();
            }, 'move down'));
            row.appendChild(button('×', function () {
                if (state.stops.length <= 2) return;
                state.stops.splice(i, 1);
                apply(); render();
            }, 'remove'));
            panel.appendChild(row);
        });

        var tools = el('div', 'display:flex;gap:6px;margin:8px 0;flex-wrap:wrap;');
        tools.appendChild(button('+ colour', function () {
            if (state.stops.length >= MAX_STOPS) return;
            state.stops.push(state.stops[state.stops.length - 1]);
            apply(); render();
        }));
        tools.appendChild(button('reverse', function () { state.stops.reverse(); apply(); render(); }));
        tools.appendChild(button('reset', function () {
            state = fresh();
            apply(); render();
        }, 'back to the colours in the code'));
        panel.appendChild(tools);

        var bright = el('div', 'display:flex;align-items:center;gap:6px;margin-bottom:6px;');
        var label = el('span', 'width:112px;white-space:nowrap;', 'brightness ' + state.brightness + '%');
        var slider = el('input', 'flex:1;margin:0;');
        slider.type = 'range';
        slider.min = 50; slider.max = 150; slider.step = 1;
        slider.value = state.brightness;
        slider.addEventListener('input', function () {
            state.brightness = parseInt(slider.value, 10);
            label.textContent = 'brightness ' + state.brightness + '%';
            apply();
            refreshOutput();
        });
        bright.appendChild(label);
        bright.appendChild(slider);
        panel.appendChild(bright);

        // header / footer font, link highlight, dots and the ripple flare
        function colourRow(labelText, key) {
            var row = el('div', 'display:flex;align-items:center;gap:6px;margin-bottom:5px;');
            var pick = el('input', 'width:34px;height:24px;padding:0;border:1px solid #555;border-radius:5px;background:none;cursor:pointer;');
            pick.type = 'color';
            var text = el('input', FIELD + 'width:78px;');
            text.type = 'text';
            text.spellcheck = false;
            var auto = el('input', 'margin:0;-webkit-appearance:checkbox;appearance:auto;opacity:1;position:static;width:auto;height:auto;float:none;accent-color:#8ab4f8;');
            auto.type = 'checkbox';
            // in auto mode the fields show what the gradient currently works out to, greyed out
            function show() {
                var manual = !!state.extra[key], v = resolved(key);
                pick.value = v || '#000000';
                if (document.activeElement !== text) text.value = v || '';
                text.placeholder = 'shade';
                pick.disabled = text.disabled = !manual;
                pick.style.opacity = text.style.opacity = manual ? '1' : '0.45';
                auto.checked = !manual;
            }
            rowRefreshers.push(show);
            pick.addEventListener('input', function () {
                state.extra[key] = pick.value.toLowerCase();
                text.value = state.extra[key];
                apply(); refreshOutput();
            });
            text.addEventListener('input', function () {
                var parsed = parseHexes(text.value);
                if (parsed.length !== 1) return;
                state.extra[key] = parsed[0];
                pick.value = parsed[0];
                apply(); refreshOutput();
            });
            row.appendChild(el('span', 'flex:0 0 7.4em;white-space:nowrap;', labelText));
            row.appendChild(pick);
            row.appendChild(text);
            var wrap = el('label', 'display:flex;align-items:center;gap:3px;margin:0;color:#bbb;font:inherit;cursor:pointer;');
            auto.addEventListener('change', function () {
                // switching to manual starts from the colour auto had picked
                state.extra[key] = auto.checked ? null : (resolved(key) || '#33544a');
                apply(); refreshOutput();
            });
            wrap.appendChild(auto);
            wrap.appendChild(el('span', '', 'auto'));
            row.appendChild(wrap);
            show();
            panel.appendChild(row);
        }
        panel.appendChild(el('div', 'color:#999;margin:8px 0 5px 0;', 'other colours:'));
        colourRow('sidebar text', 'sidebarText');
        colourRow('link accent', 'accent');
        colourRow('dots', 'dot');
        colourRow('ripple flare', 'glow');

        var paste = el('input', FIELD + 'width:100%;margin:4px 0 6px 0;');
        paste.type = 'text';
        paste.placeholder = 'paste hex codes, then Enter';
        paste.spellcheck = false;
        paste.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            var parsed = parseHexes(paste.value);
            if (parsed.length < 2) return;
            state.stops = parsed;
            state.brightness = 100;
            apply(); render();
        });
        panel.appendChild(paste);

        panel.appendChild(el('div', 'color:#999;', 'current gradient (top → bottom):'));
        panel.appendChild(out);
        panel.appendChild(extraOut);

        var copy = button('copy all', function () {
            var textToCopy = 'gradient: ' + effective().join(', ') + '\n' + summary();
            var done = function () { copy.textContent = 'copied'; setTimeout(function () { copy.textContent = 'copy all'; }, 1200); };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(textToCopy).then(done, function () {});
        });
        panel.appendChild(copy);

        refreshOutput();
    }

    window.gradientExplorer = { open: open, close: close, isOpen: isOpen };
    open();
})();
