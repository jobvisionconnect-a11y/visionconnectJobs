/* VisionConnect Jobs — progressive enhancement. Every page works without this file. */
(function () {
    'use strict';
    var root = document.documentElement;

    function load() { try { return JSON.parse(localStorage.getItem('vc-prefs') || '{}') || {}; } catch (e) { return {}; } }
    function save(p) { try { localStorage.setItem('vc-prefs', JSON.stringify(p)); } catch (e) { /* storage blocked */ } }

    /* ---- Screen-reader announcements -------------------------------- */
    var polite = document.getElementById('sr-polite');
    function announce(msg) {
        if (!polite) return;
        polite.textContent = '';
        setTimeout(function () { polite.textContent = msg; }, 60);
    }
    window.VC = { announce: announce };

    /* ---- Accessibility panel ---------------------------------------- */
    var toggle = document.getElementById('a11y-toggle');
    var panel = document.getElementById('a11y-panel');
    if (toggle && panel) {
        toggle.addEventListener('click', function () {
            var open = toggle.getAttribute('aria-expanded') === 'true';
            toggle.setAttribute('aria-expanded', String(!open));
            panel.hidden = open;
            if (!open) { var first = panel.querySelector('button, select, input'); if (first) first.focus(); }
        });
        panel.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { toggle.setAttribute('aria-expanded', 'false'); panel.hidden = true; toggle.focus(); }
        });
    }

    var current = {
        theme: root.getAttribute('data-theme') || 'light',
        text: root.getAttribute('data-text') || 'normal',
        spacing: root.getAttribute('data-spacing') || 'normal',
        motion: root.getAttribute('data-motion') || 'normal'
    };
    var NAMES = { theme: { light: 'Light theme', dark: 'Dark theme', contrast: 'High contrast theme' },
                  text: { normal: 'Normal text size', large: 'Large text', xlarge: 'Extra large text' },
                  spacing: { normal: 'Normal spacing', wide: 'Wide spacing' },
                  motion: { normal: 'Animations on', reduce: 'Animations off' } };

    function paint() {
        var chips = document.querySelectorAll('[data-pref]');
        for (var i = 0; i < chips.length; i++) {
            var c = chips[i];
            c.setAttribute('aria-pressed', String(current[c.getAttribute('data-pref')] === c.getAttribute('data-value')));
        }
    }
    function apply(key, value, quiet) {
        current[key] = value;
        if (key === 'theme') root.setAttribute('data-theme', value);
        else if (value === 'normal') root.removeAttribute('data-' + key);
        else root.setAttribute('data-' + key, value);
        var p = load(); p[key] = value; if (value === 'normal' && key !== 'theme') delete p[key];
        save(p); paint();
        if (!quiet) announce((NAMES[key] && NAMES[key][value]) || 'Setting changed');
    }
    document.addEventListener('click', function (e) {
        var chip = e.target.closest && e.target.closest('[data-pref]');
        if (chip) apply(chip.getAttribute('data-pref'), chip.getAttribute('data-value'));
        if (e.target.closest && e.target.closest('[data-reset-prefs]')) {
            try { localStorage.removeItem('vc-prefs'); } catch (x) {}
            ['text', 'spacing', 'motion'].forEach(function (k) { root.removeAttribute('data-' + k); current[k] = 'normal'; });
            var dark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
            current.theme = dark ? 'dark' : 'light'; root.setAttribute('data-theme', current.theme);
            paint(); announce('Accessibility settings reset');
        }
    });
    paint();

    /* ---- Read page aloud -------------------------------------------- */
    var synth = window.speechSynthesis, reading = false, queue = [];
    function chunks(text) {
        var out = [], parts = text.split(/(?<=[.!?।])\s+|\n+/);
        var buf = '';
        parts.forEach(function (s) {
            if ((buf + ' ' + s).length > 180 && buf) { out.push(buf); buf = s; } else { buf = buf ? buf + ' ' + s : s; }
        });
        if (buf) out.push(buf);
        return out;
    }
    function speakNext() {
        if (!reading || !queue.length) { reading = false; updateRead(); return; }
        var u = new SpeechSynthesisUtterance(queue.shift());
        u.lang = root.lang || 'en'; u.onend = speakNext; u.onerror = function () { reading = false; updateRead(); };
        synth.speak(u);
    }
    function updateRead() {
        var b = document.getElementById('read-aloud');
        if (b) { b.setAttribute('aria-pressed', String(reading)); b.textContent = reading ? 'Stop reading' : 'Read this page aloud'; }
    }
    window.VC.startReading = function () {
        if (!synth) return false;
        synth.cancel();
        var main = document.getElementById('main');
        queue = chunks((main ? main.innerText : document.body.innerText).trim());
        reading = true; updateRead(); speakNext(); return true;
    };
    window.VC.stopReading = function () { reading = false; if (synth) synth.cancel(); updateRead(); };
    var readBtn = document.getElementById('read-aloud');
    if (readBtn) {
        if (!synth) { readBtn.disabled = true; readBtn.textContent = 'Read aloud is not supported in this browser'; }
        else readBtn.addEventListener('click', function () { reading ? window.VC.stopReading() : window.VC.startReading(); });
    }
    window.addEventListener('pagehide', function () { if (synth) synth.cancel(); });

    /* ---- Focus the first message / error summary on load ------------- */
    var af = document.querySelector('[data-autofocus]');
    if (af) { af.setAttribute('tabindex', '-1'); af.focus(); }

    /* ---- Error summary links focus the field itself ------------------ */
    document.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('.error-summary a[href^="#"]');
        if (!a) return;
        var el = document.getElementById(a.getAttribute('href').slice(1));
        if (!el) return;
        e.preventDefault();
        var target = /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName) ? el : (el.querySelector('input, select, textarea') || el);
        target.focus(); if (target.scrollIntoView) target.scrollIntoView({ block: 'center' });
    });

    /* ---- Confirm destructive actions --------------------------------- */
    document.addEventListener('submit', function (e) {
        var msg = e.target.getAttribute && e.target.getAttribute('data-confirm');
        if (msg && !window.confirm(msg)) e.preventDefault();
    });

    /* ---- "All categories" checkbox is exclusive ---------------------- */
    document.addEventListener('change', function (e) {
        var cb = e.target;
        if (!cb.matches || !cb.matches('[data-exclusive-group] input[type=checkbox]')) return;
        var group = cb.closest('[data-exclusive-group]');
        var all = group.querySelector('[data-exclusive]');
        if (cb === all && cb.checked) {
            group.querySelectorAll('input[type=checkbox]').forEach(function (o) { if (o !== all) o.checked = false; });
        } else if (cb !== all && cb.checked && all) { all.checked = false; }
    });

    /* ---- Save / unsave a job without leaving the page ---------------- */
    document.addEventListener('submit', function (e) {
        var form = e.target;
        if (!form.matches || !form.matches('.js-save') || !window.fetch) return;
        e.preventDefault();
        var btn = form.querySelector('button');
        var body = {}; new FormData(form).forEach(function (v, k) { body[k] = v; });
        btn.disabled = true;
        fetch(form.action, { method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(body) })
            .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
            .then(function (res) {
                if (!res.ok) throw new Error(res.d.error || res.d.message || 'failed');
                btn.setAttribute('aria-pressed', String(res.d.status === 'saved'));
                announce(res.d.message);
            })
            .catch(function () { announce('Sorry, that did not work. Please try again.'); })
            .then(function () { btn.disabled = false; });
    });
})();
