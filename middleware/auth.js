/** Authentication & authorization middleware. */
const { queryOne } = require('../db/supabase');
const labels = require('../lib/labels');

/** Makes the user, flash messages and view helpers available to every template. */
function injectUser(req, res, next) {
    res.locals.user = req.session.user || null;
    res.locals.success = req.session.success || null;
    res.locals.error = req.session.error || null;
    delete req.session.success;
    delete req.session.error;
    res.locals.h = labels;
    res.locals.currentPath = req.path;
    res.locals.errors = {};
    res.locals.formData = {};
    next();
}

function safeReturn(url) {
    return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/auth') ? url : null;
}

function requireAuth(req, res, next) {
    if (!req.session.user) {
        if (req.method === 'GET') req.session.returnTo = req.originalUrl;
        req.session.error = 'Please log in to continue.';
        return res.redirect('/auth/login');
    }
    next();
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.session.user) {
            if (req.method === 'GET') req.session.returnTo = req.originalUrl;
            req.session.error = 'Please log in to continue.';
            return res.redirect('/auth/login');
        }
        if (!roles.includes(req.session.user.role)) {
            req.session.error = 'That page is not available for your account type.';
            return res.redirect(homeFor(req.session.user));
        }
        next();
    };
}

function homeFor(user) {
    if (!user) return '/';
    return { seeker: '/seeker/dashboard', employer: '/employer/dashboard', admin: '/admin/dashboard' }[user.role] || '/';
}

/** A profile is "complete" once skills and education are filled in. */
const isProfileComplete = p => !!(p && p.skills && p.skills.trim() && p.education && p.education.trim());

async function loadProfileComplete(req) {
    const profile = await queryOne('profiles', { user_id: req.session.user.id },
        'skills, education');
    req.session.user.profileComplete = isProfileComplete(profile);
    return req.session.user.profileComplete;
}

/** Seekers must finish their profile before using their dashboard etc. */
async function requireProfileComplete(req, res, next) {
    if (!req.session.user || req.session.user.role !== 'seeker') return next();
    if (req.path === '/profile') return next();
    try {
        const ok = req.session.user.profileComplete !== undefined
            ? req.session.user.profileComplete
            : await loadProfileComplete(req);
        if (ok) return next();
        req.session.error = 'Please add your skills and education first. Employers need them to consider you.';
        return res.redirect('/seeker/profile');
    } catch (err) {
        console.error('Profile check error:', err.message);
        next();
    }
}

module.exports = { injectUser, requireAuth, requireRole, requireProfileComplete, isProfileComplete, loadProfileComplete, homeFor, safeReturn };
