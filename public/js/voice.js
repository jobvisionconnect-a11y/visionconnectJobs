/* Voice commands (Chrome / Edge). English, Hindi and Marathi. Optional and off by default. */
(function () {
    'use strict';
    var btn = document.getElementById('voice-toggle');
    var status = document.getElementById('voice-status');
    var langSel = document.getElementById('voice-lang');
    var speakBox = document.getElementById('voice-speak');
    if (!btn || !status) return;

    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        btn.disabled = true;
        status.textContent = 'Voice commands need Google Chrome or Microsoft Edge.';
        return;
    }
    var role = document.body.getAttribute('data-role') || '';
    var rec = null, listening = false;
    try { var saved = localStorage.getItem('vc-voice-lang'); if (saved && langSel) langSel.value = saved; } catch (e) {}
    if (langSel) langSel.addEventListener('change', function () { try { localStorage.setItem('vc-voice-lang', langSel.value); } catch (e) {} });

    function say(msg, urgent) {
        status.textContent = msg;
        if (window.VC) window.VC.announce(msg);
        if (speakBox && speakBox.checked && window.speechSynthesis) {
            var u = new SpeechSynthesisUtterance(msg); u.lang = langSel ? langSel.value : 'en-IN';
            speechSynthesis.cancel(); speechSynthesis.speak(u);
        }
    }
    function go(url, msg) { say(msg); setTimeout(function () { window.location.href = url; }, 700); }
    function needLogin() { say('Please log in first. Say "log in" to open the login page.'); }

    var dash = { seeker: '/seeker/dashboard', employer: '/employer/dashboard', admin: '/admin/dashboard' };

    /* word lists — English plus Hindi and Marathi */
    var W = {
        home: ['home', 'homepage', 'main page', 'होम', 'मुख्यपृष्ठ', 'मुख्य पृष्ठ'],
        jobs: ['jobs', 'job', 'vacancies', 'vacancy', 'openings', 'नोकरी', 'नौकरी', 'जॉब', 'रोजगार'],
        login: ['log in', 'login', 'sign in', 'लॉगिन', 'लॉग इन', 'प्रवेश'],
        register: ['register', 'sign up', 'signup', 'create account', 'रजिस्टर', 'नोंदणी', 'साइन अप', 'खाता बनाएं', 'खाते'],
        logout: ['log out', 'logout', 'sign out', 'लॉग आउट', 'लॉगआउट', 'बाहर'],
        dashboard: ['dashboard', 'my area', 'डैशबोर्ड', 'डॅशबोर्ड'],
        applications: ['applications', 'applied', 'my applications', 'अर्ज', 'आवेदन'],
        saved: ['saved', 'bookmarks', 'favourites', 'favorites', 'सेव्ह', 'सेव', 'जतन'],
        profile: ['profile', 'my profile', 'प्रोफाइल', 'प्रोफ़ाइल'],
        post: ['post job', 'post a job', 'new job', 'नोकरी पोस्ट', 'नौकरी पोस्ट'],
        help: ['help', 'accessibility', 'commands', 'मदद', 'मदत', 'सहायता'],
        read: ['read', 'read aloud', 'read page', 'वाचा', 'पढ़ो', 'पढ़ें'],
        stop: ['stop', 'quiet', 'be quiet', 'थांबा', 'रुको', 'बंद'],
        back: ['back', 'go back', 'previous', 'मागे', 'पीछे', 'वापस'],
        down: ['scroll down', 'down', 'खाली', 'नीचे'],
        up: ['scroll up', 'up', 'वर', 'ऊपर'],
        bigger: ['bigger', 'larger', 'zoom in', 'increase text', 'मोठा', 'बड़ा'],
        smaller: ['smaller', 'zoom out', 'decrease text', 'लहान', 'छोटा'],
        dark: ['dark mode', 'dark theme', 'डार्क'],
        light: ['light mode', 'light theme', 'लाइट'],
        contrast: ['high contrast', 'contrast', 'कॉन्ट्रास्ट']
    };
    function has(text, key) {
        return W[key].some(function (w) {
            if (/^[\x00-\x7f]+$/.test(w)) return new RegExp('(^|[^a-z])' + w.replace(/\s+/g, '\\s+') + '($|[^a-z])').test(text);
            return text.indexOf(w) !== -1;
        });
    }

    function handle(raw) {
        var t = raw.toLowerCase().trim();
        var m = t.match(/^(?:search|find|look for|search for|शोधा|खोजो|खोजें|ढूंढो)\s+(?:for\s+)?(.+?)(?:\s+jobs?)?$/);
        if (m && m[1]) return go('/jobs?q=' + encodeURIComponent(m[1]), 'Searching for ' + m[1]);

        if (has(t, 'stop')) { if (window.VC) window.VC.stopReading(); return say('Stopped.'); }
        if (has(t, 'read')) { return window.VC && window.VC.startReading() ? say('Reading the page.') : say('Reading aloud is not available here.'); }
        if (has(t, 'back')) { say('Going back.'); return history.back(); }
        if (has(t, 'bigger')) { var b = document.querySelector('[data-pref="text"][data-value="large"]'); if (b) b.click(); return say('Larger text.'); }
        if (has(t, 'smaller')) { var s = document.querySelector('[data-pref="text"][data-value="normal"]'); if (s) s.click(); return say('Normal text size.'); }
        if (has(t, 'contrast')) { var c = document.querySelector('[data-pref="theme"][data-value="contrast"]'); if (c) c.click(); return say('High contrast on.'); }
        if (has(t, 'dark')) { var d = document.querySelector('[data-pref="theme"][data-value="dark"]'); if (d) d.click(); return say('Dark theme on.'); }
        if (has(t, 'light')) { var l = document.querySelector('[data-pref="theme"][data-value="light"]'); if (l) l.click(); return say('Light theme on.'); }

        if (has(t, 'logout')) return role ? go('/auth/logout', 'Opening log out') : say('You are not logged in.');
        if (has(t, 'login')) return go('/auth/login', 'Opening log in');
        if (has(t, 'register')) return go('/auth/register', 'Opening create account');
        if (has(t, 'post')) return role === 'employer' ? go('/employer/jobs/new', 'Opening post a job') : say('Only employers can post jobs.');
        if (has(t, 'dashboard')) return role ? go(dash[role], 'Opening your dashboard') : needLogin();
        if (has(t, 'applications')) return role === 'seeker' ? go('/seeker/applications', 'Opening your applications') : needLogin();
        if (has(t, 'saved')) return role === 'seeker' ? go('/seeker/saved-jobs', 'Opening saved jobs') : needLogin();
        if (has(t, 'profile')) return role === 'seeker' ? go('/seeker/profile', 'Opening your profile') : needLogin();
        if (has(t, 'help')) return go('/accessibility', 'Opening help');
        if (has(t, 'down')) { window.scrollBy({ top: window.innerHeight * 0.8 }); return say('Scrolled down.'); }
        if (has(t, 'up')) { window.scrollBy({ top: -window.innerHeight * 0.8 }); return say('Scrolled up.'); }
        if (has(t, 'home')) return go('/', 'Going home');
        if (has(t, 'jobs')) return go('/jobs', 'Opening jobs');
        say('Sorry, I did not understand "' + raw + '". Try "jobs", "search for accountant", "profile", "read page" or "help".');
    }

    function start() {
        rec = new SR();
        rec.lang = langSel ? langSel.value : 'en-IN';
        rec.interimResults = false; rec.maxAlternatives = 1;
        rec.onstart = function () { listening = true; btn.setAttribute('aria-pressed', 'true'); btn.textContent = 'Stop listening'; status.textContent = 'Listening…'; };
        rec.onresult = function (e) { handle(e.results[0][0].transcript); };
        rec.onerror = function (e) {
            var msg = e.error === 'not-allowed' ? 'Microphone permission was blocked. Allow it in your browser settings.'
                    : e.error === 'no-speech' ? 'I did not hear anything. Press the button and try again.'
                    : 'Voice error: ' + e.error;
            say(msg);
        };
        rec.onend = function () { listening = false; btn.setAttribute('aria-pressed', 'false'); btn.textContent = 'Start voice commands'; };
        rec.start();
    }
    btn.addEventListener('click', function () { if (listening && rec) rec.stop(); else start(); });
})();
