/* Runs before the page paints, so saved accessibility settings apply with no flash. */
(function () {
    var d = document.documentElement, p = {};
    try { p = JSON.parse(localStorage.getItem('vc-prefs') || '{}') || {}; } catch (e) { p = {}; }
    var theme = p.theme;
    if (!theme) {
        var mm = function (q) { return window.matchMedia && window.matchMedia(q).matches; };
        theme = mm('(prefers-contrast: more)') ? 'contrast' : (mm('(prefers-color-scheme: dark)') ? 'dark' : 'light');
    }
    d.setAttribute('data-theme', theme);
    if (p.text) d.setAttribute('data-text', p.text);
    if (p.spacing) d.setAttribute('data-spacing', p.spacing);
    if (p.motion) d.setAttribute('data-motion', p.motion);
})();
