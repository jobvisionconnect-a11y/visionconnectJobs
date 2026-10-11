/**
 * Startup self-check. Prints clear, plain messages in the host log so a wrong
 * setting is found in seconds. It never crashes the app; it only warns.
 */
const { supabase } = require('../db/supabase');

const TABLES = ['users', 'profiles', 'jobs', 'applications', 'saved_jobs', 'sessions', 'password_resets'];

async function run() {
    const isProd = process.env.NODE_ENV === 'production';
    const warn = m => console.warn('[check] WARNING: ' + m);
    const ok = m => console.log('[check] ok: ' + m);

    if (isProd && (process.env.SESSION_SECRET || '').length < 16) warn('SESSION_SECRET is short. Use a long random value (32+ characters).');
    if (isProd && String(process.env.COOKIE_SECURE).toLowerCase() === 'false') warn('COOKIE_SECURE=false. Only use this if the site has no HTTPS.');
    if (isProd && !process.env.KEEP_ALIVE_URL && !process.env.RENDER_EXTERNAL_URL) warn('KEEP_ALIVE_URL is not set, so the self-ping is off. Add an external pinger (UptimeRobot) on /healthz?db=1.');
    if (!process.env.MAIL_FROM || !(process.env.BREVO_API_KEY || process.env.RESEND_API_KEY)) warn('Email is not set up (BREVO_API_KEY + MAIL_FROM). Forgot-password and status emails will not be sent.');
    if (!process.env.CONTACT_EMAIL) warn('CONTACT_EMAIL is empty. The Contact page will show no email address.');

    try {
        const missing = [];
        for (const t of TABLES) {
            const { error } = await supabase.from(t).select('*', { head: true, count: 'exact' }).limit(1);
            if (error) {
                if (/fetch failed|ENOTFOUND|ECONNREFUSED|timeout/i.test(error.message || '')) throw error;
                missing.push(t);
            }
        }
        if (missing.length) warn(`These tables are missing or not readable: ${missing.join(', ')}. Run db/schema.sql in the Supabase SQL Editor.`);
        else ok('database tables found');

        const { count, error } = await supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin');
        if (!error && !count) warn('No admin account yet. Run: npm run create-admin');
    } catch (e) {
        warn('Cannot reach Supabase: ' + e.message + '. Check SUPABASE_URL, the service role key, and that the project is not paused.');
    }
}

module.exports = { run };
