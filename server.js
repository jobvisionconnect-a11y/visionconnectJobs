/**
 * VisionConnect Jobs — accessible job portal
 * Express + EJS (server-rendered HTML, works without JavaScript) + Supabase.
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const session = require('express-session');

const { injectUser } = require('./middleware/auth');
const { csrf } = require('./middleware/security');
const SupabaseStore = require('./db/session-store');
const storage = require('./lib/storage');
const { supabase } = require('./db/supabase');
const keepalive = require('./lib/keepalive');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

if (isProd) app.set('trust proxy', 1);          // Render / any reverse proxy
app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Security headers (no inline scripts or styles are used anywhere) ─────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'"],
            imgSrc: ["'self'", 'data:'],
            fontSrc: ["'self'"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            upgradeInsecureRequests: isProd ? [] : null
        }
    }
}));
app.use(compression());

// Safe defaults so error pages can render even if a later middleware fails
app.use((req, res, next) => {
    Object.assign(res.locals, {
        user: null, success: null, error: null, errors: {}, formData: {}, h: require('./lib/labels'),
        currentPath: req.path, csrfField: () => '', csrfToken: () => ''
    });
    next();
});

app.get('/healthz', async (req, res) => {
    if (req.query.db !== '1') return res.type('text').send('ok');
    const { error } = await supabase.from('users').select('id', { head: true, count: 'exact' }).limit(1);
    res.status(error ? 503 : 200).type('text').send(error ? 'db error' : 'ok');
});
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '1d' : 0 }));

// ── Body parsing, sessions, CSRF ─────────────────────────────────────────
app.use(express.urlencoded({ extended: true, limit: '200kb' }));
app.use(express.json({ limit: '50kb' }));

if (isProd && !process.env.SESSION_SECRET) {
    console.error('[VisionConnect] SESSION_SECRET must be set in production.');
    process.exit(1);
}
app.use(session({
    name: 'vc.sid',
    secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    resave: false,
    saveUninitialized: false,
    store: process.env.SESSION_STORE === 'memory' ? undefined : new SupabaseStore(),
    cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: isProd && String(process.env.COOKIE_SECURE).toLowerCase() !== 'false' }
}));
app.use(injectUser);
app.use(csrf);

// Remove trailing slashes so every page has one address
app.use((req, res, next) => {
    if (req.path.length > 1 && req.path.endsWith('/')) {
        return res.redirect(301, req.path.slice(0, -1) + req.url.slice(req.path.length));
    }
    next();
});

// ── Routes ───────────────────────────────────────────────────────────────
app.use('/auth', require('./routes/auth'));
app.use('/jobs', require('./routes/jobs'));
app.use('/seeker', require('./routes/seeker'));
app.use('/employer', require('./routes/employer'));
app.use('/admin', require('./routes/admin'));
app.use('/files', require('./routes/files'));

app.get('/accessibility', (req, res) => {
    res.render('pages/accessibility', { title: 'Accessibility & Help — VisionConnect Jobs' });
});
app.get('/privacy', (req, res) => res.render('pages/privacy', { title: 'Privacy policy — VisionConnect Jobs', contactEmail: process.env.CONTACT_EMAIL || '' }));
app.get('/terms', (req, res) => res.render('pages/terms', { title: 'Terms of use — VisionConnect Jobs', contactEmail: process.env.CONTACT_EMAIL || '' }));
app.get('/contact', (req, res) => res.render('pages/contact', { title: 'Contact — VisionConnect Jobs', contactEmail: process.env.CONTACT_EMAIL || '', contactPhone: process.env.CONTACT_PHONE || '' }));

app.get('/', async (req, res) => {
    const stats = { jobCount: 0, employerCount: 0, applicationCount: 0, latestJobs: [] };
    try {
        const count = async (table, f) => {
            let q = supabase.from(table).select('*', { count: 'exact', head: true });
            for (const [k, v] of Object.entries(f || {})) q = q.eq(k, v);
            const { count: c, error } = await q;
            if (error) throw error;
            return c || 0;
        };
        const [jobCount, employerCount, applicationCount, latest] = await Promise.all([
            count('jobs', { is_approved: true, is_active: true }),
            count('users', { role: 'employer', is_approved: true }),
            count('applications'),
            supabase.from('jobs').select('*, users!inner(name)')
                .eq('is_approved', true).eq('is_active', true)
                .order('created_at', { ascending: false }).limit(6)
        ]);
        if (latest.error) throw latest.error;
        Object.assign(stats, { jobCount, employerCount, applicationCount, latestJobs: latest.data || [] });
    } catch (err) {
        console.error('Landing page error:', err.message);
    }
    res.render('index', { title: 'VisionConnect Jobs — Accessible jobs for students with any disability', ...stats });
});

// ── Errors ───────────────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).render('error', {
        title: 'Page not found — VisionConnect Jobs', code: 404,
        message: 'We could not find that page. It may have moved, or the address may have a typo.'
    });
});
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    if (res.headersSent) return next(err);
    const tooBig = err && err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 500).render('error', {
        title: 'Something went wrong — VisionConnect Jobs',
        code: tooBig ? 413 : 500,
        message: tooBig ? 'That file is larger than 5 MB. Please choose a smaller file.'
                        : 'Something went wrong on our side. Please try again in a moment.'
    });
});

if (require.main === module) {
    process.on('unhandledRejection', e => console.error('[unhandledRejection]', e && e.message ? e.message : e));
    process.on('uncaughtException', e => console.error('[uncaughtException]', e && e.stack ? e.stack : e));
    storage.init().finally(() => {
        const server = app.listen(PORT, () => {
            console.log(`VisionConnect Jobs running on http://localhost:${PORT}`);
            keepalive.start();
            require('./lib/preflight').run().catch(() => {});
        });
        server.keepAliveTimeout = 65000;   // longer than most proxies, avoids random 502s
        server.headersTimeout = 70000;
        const stop = () => server.close(() => process.exit(0));
        process.on('SIGTERM', stop);
        process.on('SIGINT', stop);
    });
}
module.exports = app;
