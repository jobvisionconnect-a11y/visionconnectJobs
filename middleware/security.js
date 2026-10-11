/** CSRF protection + a tiny in-memory rate limiter (no extra dependencies). */
const crypto = require('crypto');

function token(req) {
    if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
    return req.session.csrf;
}

function valid(req, supplied) {
    const expected = req.session && req.session.csrf;
    if (!expected || !supplied) return false;
    const a = Buffer.from(String(supplied)), b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Global middleware: exposes csrfField()/csrfToken() to views, checks unsafe methods. */
function csrf(req, res, next) {
    res.locals.csrfToken = () => token(req);
    res.locals.csrfField = () => `<input type="hidden" name="_csrf" value="${token(req)}">`;
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    // multipart bodies are parsed by multer inside the route, which then calls verifyCsrf
    if ((req.headers['content-type'] || '').startsWith('multipart/form-data')) return next();
    return verifyCsrf(req, res, next);
}

function verifyCsrf(req, res, next) {
    const supplied = (req.body && req.body._csrf) || req.get('x-csrf-token');
    if (valid(req, supplied)) return next();
    const wantsJson = (req.get('accept') || '').includes('application/json');
    if (wantsJson) return res.status(403).json({ error: 'Your session expired. Please reload the page.' });
    return res.status(403).render('error', {
        title: 'Session expired — VisionConnect Jobs',
        code: 403,
        message: 'Your form expired for your safety. Please go back, reload the page, and try again.'
    });
}

/** rateLimit({ windowMs, max, key(req) }) */
function rateLimit({ windowMs, max, key = req => req.ip, message }) {
    const hits = new Map();
    setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
    return (req, res, next) => {
        const k = key(req), now = Date.now();
        let h = hits.get(k);
        if (!h || h.reset < now) { h = { count: 0, reset: now + windowMs }; hits.set(k, h); }
        h.count++;
        if (h.count > max) {
            const mins = Math.ceil((h.reset - now) / 60000);
            res.status(429);
            return res.render(req.rateLimitView || 'error', {
                title: 'Too many attempts — VisionConnect Jobs', code: 429,
                message: message || `Too many attempts. Please wait ${mins} minute${mins === 1 ? '' : 's'} and try again.`
            });
        }
        next();
    };
}

module.exports = { csrf, verifyCsrf, rateLimit };
