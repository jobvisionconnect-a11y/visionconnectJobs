/** /auth — register, login, logout */
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { queryOne, runStmt } = require('../db/supabase');
const { rateLimit } = require('../middleware/security');
const { homeFor, safeReturn, loadProfileComplete } = require('../middleware/auth');
const crypto = require('crypto');
const { clean, isEmail } = require('../lib/validate');
const { supabase } = require('../db/supabase');
const { requireAuth } = require('../middleware/auth');
const mail = require('../lib/mail');
const storage = require('../lib/storage');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 10,
    key: req => `${req.ip}|${clean(req.body && req.body.email, 120).toLowerCase()}`,
    message: 'Too many failed attempts. Please wait a few minutes and try again.'
});

function startSession(req, user, cb) {
    const returnTo = req.session.returnTo;
    req.session.regenerate(err => {
        if (err) return cb(err);
        req.session.user = { id: user.id, email: user.email, name: user.name, role: user.role };
        req.session.returnTo = safeReturn(returnTo) || undefined;
        cb(null);
    });
}

router.get('/register', (req, res) => {
    if (req.session.user) return res.redirect(homeFor(req.session.user));
    res.render('auth/register', { title: 'Create account — VisionConnect Jobs', formData: { role: req.query.role || '' }, errors: {} });
});

router.post('/register', async (req, res, next) => {
    const name = clean(req.body.name, 100);
    const email = clean(req.body.email, 160).toLowerCase();
    const { password = '', confirmPassword = '' } = req.body;
    const role = req.body.role;
    const errors = {};

    if (!['seeker', 'employer'].includes(role)) errors.role = 'Choose one: I want to find a job, or I want to hire.';
    if (name.length < 2) errors.name = 'Enter your full name (at least 2 letters).';
    if (!isEmail(email)) errors.email = 'Enter a valid email address, like name@example.com.';
    if (password.length < 8) errors.password = 'Choose a password with at least 8 characters.';
    else if (password.length > 72) errors.password = 'Password can be at most 72 characters.';
    if (!errors.password && password !== confirmPassword) errors.confirmPassword = 'The two passwords do not match.';

    const fail = () => res.status(400).render('auth/register', {
        title: 'Create account — VisionConnect Jobs', errors, formData: { name, email, role }
    });
    if (Object.keys(errors).length) return fail();

    try {
        if (await queryOne('users', { email }, 'id')) {
            errors.email = 'An account with this email already exists. Please log in instead.';
            return fail();
        }
        const created = await runStmt('insert', 'users', {
            email, name, role, password_hash: bcrypt.hashSync(password, 10)
        });
        const user = created.data[0];
        if (role === 'seeker') await runStmt('insert', 'profiles', { user_id: user.id });

        startSession(req, user, err => {
            if (err) return next(err);
            req.session.success = role === 'seeker'
                ? `Welcome, ${name}! Your account is ready. Please fill in your profile so employers can find you.`
                : `Welcome, ${name}! Your employer account is ready. You can post your first job now.`;
            res.redirect(role === 'seeker' ? '/seeker/profile' : '/employer/jobs/new');
        });
    } catch (err) {
        console.error('Registration error:', err.message);
        errors.form = 'We could not create your account right now. Please try again.';
        res.status(500).render('auth/register', { title: 'Create account — VisionConnect Jobs', errors, formData: { name, email, role } });
    }
});

router.get('/login', (req, res) => {
    if (req.session.user) return res.redirect(homeFor(req.session.user));
    res.render('auth/login', { title: 'Log in — VisionConnect Jobs', formData: {}, errors: {} });
});

router.post('/login', loginLimiter, async (req, res, next) => {
    const email = clean(req.body.email, 160).toLowerCase();
    const password = String(req.body.password || '');
    const errors = {};
    const fail = status => res.status(status || 400).render('auth/login', {
        title: 'Log in — VisionConnect Jobs', errors, formData: { email }
    });

    if (!email) errors.email = 'Enter your email address.';
    if (!password) errors.password = 'Enter your password.';
    if (Object.keys(errors).length) return fail();

    try {
        const user = await queryOne('users', { email });
        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
            errors.form = 'The email or password is not correct. Please check both and try again.';
            return fail(401);
        }
        if (!user.is_approved) {
            errors.form = 'Your account has been suspended. Please contact the VisionConnect team.';
            return fail(403);
        }
        startSession(req, user, async err => {
            if (err) return next(err);
            let dest = safeReturn(req.session.returnTo);
            delete req.session.returnTo;
            if (user.role === 'seeker') {
                const complete = await loadProfileComplete(req).catch(() => true);
                if (!complete) {
                    req.session.success = `Welcome, ${user.name}! Please finish your profile to get started.`;
                    return res.redirect('/seeker/profile');
                }
            }
            req.session.success = `Welcome back, ${user.name}.`;
            res.redirect(dest || homeFor(user));
        });
    } catch (err) {
        console.error('Login error:', err.message);
        errors.form = 'We could not log you in right now. Please try again.';
        fail(500);
    }
});

// Visiting /auth/logout directly (e.g. by voice command) asks for confirmation.
router.get('/logout', (req, res) => {
    if (!req.session.user) return res.redirect('/');
    res.render('auth/logout', { title: 'Log out — VisionConnect Jobs' });
});

router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('vc.sid');
        res.redirect('/');
    });
});


// ── Forgot / reset password ──────────────────────────────────────────────
const forgotLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: 'Too many reset requests. Please wait a few minutes and try again.' });
const sha = v => crypto.createHash('sha256').update(v).digest('hex');

router.get('/forgot', (req, res) => {
    res.render('auth/forgot', { title: 'Forgot password — VisionConnect Jobs', sent: false, emailReady: mail.configured() || process.env.NODE_ENV !== 'production', formData: {}, errors: {} });
});

router.post('/forgot', forgotLimiter, async (req, res) => {
    const email = clean(req.body.email, 160).toLowerCase();
    const view = (extra) => res.render('auth/forgot', Object.assign({ title: 'Forgot password — VisionConnect Jobs', sent: false, emailReady: true, formData: { email }, errors: {} }, extra));
    if (!isEmail(email)) return view({ errors: { email: 'Enter the email address you used to register.' } });
    try {
        const user = await queryOne('users', { email }, 'id, name, is_approved');
        if (user && user.is_approved) {
            const token = crypto.randomBytes(32).toString('hex');
            await supabase.from('password_resets').delete().eq('user_id', user.id);
            await runStmt('insert', 'password_resets', { user_id: user.id, token_hash: sha(token), expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
            const link = `${mail.baseUrl(req)}/auth/reset/${token}`;
            await mail.send({ to: email, subject: 'Reset your VisionConnect Jobs password',
                text: `Hello ${user.name},\n\nUse this link to choose a new password. It works for 1 hour and only once:\n${link}\n\nIf you did not ask for this, you can ignore this email. Your password will not change.\n\nVisionConnect Jobs` });
        }
    } catch (err) { console.error('Forgot error:', err.message); }
    // same answer whether or not the account exists, so nobody can probe for registered emails
    view({ sent: true });
});

async function findReset(token) {
    if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
    const row = await queryOne('password_resets', { token_hash: sha(token) });
    if (!row || row.used_at || new Date(row.expires_at) < new Date()) return null;
    return row;
}

router.get('/reset/:token', async (req, res) => {
    const row = await findReset(req.params.token).catch(() => null);
    res.status(row ? 200 : 400).render('auth/reset', { title: 'Choose a new password — VisionConnect Jobs', valid: !!row, token: req.params.token, errors: {} });
});

router.post('/reset/:token', async (req, res) => {
    const { password = '', confirmPassword = '' } = req.body;
    const row = await findReset(req.params.token).catch(() => null);
    const errors = {};
    if (row) {
        if (password.length < 8) errors.password = 'Choose a password with at least 8 characters.';
        else if (password.length > 72) errors.password = 'Password can be at most 72 characters.';
        else if (password !== confirmPassword) errors.confirmPassword = 'The two passwords do not match.';
    }
    if (!row || Object.keys(errors).length) {
        return res.status(400).render('auth/reset', { title: 'Choose a new password — VisionConnect Jobs', valid: !!row, token: req.params.token, errors });
    }
    try {
        await runStmt('update', 'users', { password_hash: bcrypt.hashSync(password, 10) }, { id: row.user_id });
        await runStmt('update', 'password_resets', { used_at: new Date().toISOString() }, { id: row.id });
        await supabase.from('sessions').delete().eq('sess->user->>id', String(row.user_id)); // sign out everywhere
        req.session.success = 'Your password was changed. Please log in with the new password.';
        res.redirect('/auth/login');
    } catch (err) {
        console.error('Reset error:', err.message);
        errors.form = 'We could not change your password. Please try again.';
        res.status(500).render('auth/reset', { title: 'Choose a new password — VisionConnect Jobs', valid: true, token: req.params.token, errors });
    }
});

// ── My account: change password, delete account ──────────────────────────
router.get('/account', requireAuth, (req, res) => {
    res.render('auth/account', { title: 'My account — VisionConnect Jobs', errors: {} });
});

router.post('/account/password', requireAuth, async (req, res) => {
    const { current = '', password = '', confirmPassword = '' } = req.body;
    const errors = {};
    const user = await queryOne('users', { id: req.session.user.id }, 'id, password_hash');
    if (!user || !bcrypt.compareSync(current, user.password_hash)) errors.current = 'Your current password is not correct.';
    if (password.length < 8) errors.password = 'Choose a new password with at least 8 characters.';
    else if (password.length > 72) errors.password = 'Password can be at most 72 characters.';
    else if (password !== confirmPassword) errors.confirmPassword = 'The two passwords do not match.';
    if (Object.keys(errors).length) return res.status(400).render('auth/account', { title: 'My account — VisionConnect Jobs', errors });
    await runStmt('update', 'users', { password_hash: bcrypt.hashSync(password, 10) }, { id: user.id });
    req.session.success = 'Your password was changed.';
    res.redirect('/auth/account');
});

router.post('/account/delete', requireAuth, async (req, res) => {
    const me = req.session.user;
    const user = await queryOne('users', { id: me.id }, 'id, password_hash, role');
    const errors = {};
    if (!user || !bcrypt.compareSync(String(req.body.delete_password || ''), user.password_hash)) errors.delete_password = 'Your password is not correct.';
    if (user && user.role === 'admin') errors.form = 'Admin accounts cannot be deleted here.';
    if (req.body.confirm !== 'DELETE') errors.confirm = 'Type DELETE in capital letters to confirm.';
    if (Object.keys(errors).length) return res.status(400).render('auth/account', { title: 'My account — VisionConnect Jobs', errors });
    try {
        const profile = await queryOne('profiles', { user_id: me.id }, 'resume_path');
        if (profile && profile.resume_path) await storage.removeResume(profile.resume_path);
        await runStmt('delete', 'users', {}, { id: me.id }); // cascades to profile, jobs, applications, saved jobs
        await supabase.from('sessions').delete().eq('sess->user->>id', String(me.id));
        req.session.destroy(() => { res.clearCookie('vc.sid'); res.redirect('/'); });
    } catch (err) {
        console.error('Delete account error:', err.message);
        errors.form = 'We could not delete your account. Please try again.';
        res.status(500).render('auth/account', { title: 'My account — VisionConnect Jobs', errors });
    }
});

module.exports = router;
