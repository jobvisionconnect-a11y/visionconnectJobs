/** /seeker — dashboard, profile, applications, saved jobs */
const express = require('express');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const { supabase, queryOne, runStmt } = require('../db/supabase');
const { requireAuth, requireRole, requireProfileComplete, isProfileComplete } = require('../middleware/auth');
const { verifyCsrf } = require('../middleware/security');
const { clean, isHttpUrl, isPhone, asList, toInt } = require('../lib/validate');
const L = require('../lib/labels');
const storage = require('../lib/storage');

router.use(requireAuth, requireRole('seeker'));

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        const ok = ['.pdf', '.doc', '.docx', '.txt'].includes(path.extname(file.originalname).toLowerCase());
        cb(ok ? null : Object.assign(new Error('BAD_TYPE'), { code: 'BAD_TYPE' }), ok);
    }
}).single('resume');

const attachStats = apps => ({
    total: apps.length,
    active: apps.filter(a => ['applied', 'reviewed'].includes(a.status)).length,
    shortlisted: apps.filter(a => a.status === 'shortlisted').length,
    hired: apps.filter(a => a.status === 'hired').length
});

// ── Dashboard ─────────────────────────────────────────────────────────────
router.get('/dashboard', requireProfileComplete, async (req, res) => {
    try {
        const uid = req.session.user.id;
        const [apps, profile, saved] = await Promise.all([
            supabase.from('applications').select('*, jobs!inner(id, title, company, location)')
                .eq('seeker_id', uid).order('applied_at', { ascending: false }),
            queryOne('profiles', { user_id: uid }),
            supabase.from('saved_jobs').select('id', { count: 'exact', head: true }).eq('user_id', uid)
        ]);
        if (apps.error) throw apps.error;
        const applications = apps.data || [];
        const missing = [];
        if (!profile.resume_path) missing.push('Upload your resume');
        if (!profile.phone) missing.push('Add a phone number');
        if (!profile.bio) missing.push('Write a short introduction about yourself');
        if (!profile.preferred_interview) missing.push('Tell employers how you prefer to be interviewed');
        res.render('seeker/dashboard', {
            title: 'My dashboard — VisionConnect Jobs',
            applications, stats: attachStats(applications), savedCount: saved.count || 0, missing
        });
    } catch (err) {
        console.error('Dashboard error:', err.message);
        req.session.error = 'We could not load your dashboard. Please try again.';
        res.redirect('/');
    }
});

// ── Profile ───────────────────────────────────────────────────────────────
async function renderProfile(req, res, { status = 200, errors = {}, overlay = {} } = {}) {
    const profile = { ...((await queryOne('profiles', { user_id: req.session.user.id })) || {}), ...overlay };
    res.status(status).render('seeker/profile', {
        title: 'My profile — VisionConnect Jobs',
        profile, errors,
        displayName: overlay.name !== undefined ? overlay.name : req.session.user.name,
        profileComplete: isProfileComplete(profile),
        firstTime: req.session.user.profileComplete === false
    });
}

router.get('/profile', async (req, res) => {
    try { await renderProfile(req, res); }
    catch (err) {
        console.error('Profile view error:', err.message);
        req.session.error = 'We could not load your profile. Please try again.';
        res.redirect('/');
    }
});

router.post('/profile', (req, res, next) => {
    upload(req, res, async err => {
        if (err) {
            const msg = err.code === 'LIMIT_FILE_SIZE' ? 'That resume is larger than 5 MB. Please choose a smaller file.'
                : err.code === 'BAD_TYPE' ? 'Resume must be a PDF, DOC, DOCX or TXT file.'
                : 'We could not read that file. Please try another one.';
            return verifyCsrf(req, res, () => renderProfile(req, res, { status: 400, errors: { resume: msg } }).catch(next));
        }
        verifyCsrf(req, res, () => saveProfile(req, res).catch(next));
    });
});

async function saveProfile(req, res) {
    const b = req.body;
    const uid = req.session.user.id;
    const data = {
        bio: clean(b.bio, 1500), skills: clean(b.skills, 600), education: clean(b.education, 800),
        work_experience: clean(b.work_experience, 1500), certifications: clean(b.certifications, 600),
        phone: clean(b.phone, 25), location: clean(b.location, 100), languages: clean(b.languages, 200),
        linkedin_url: clean(b.linkedin_url, 300), portfolio_url: clean(b.portfolio_url, 300),
        disability_category: L.DISABILITY_CATEGORIES[b.disability_category] ? b.disability_category : '',
        disability_percent: toInt(b.disability_percent, 0, 100),
        udid_number: clean(b.udid_number, 30),
        accessibility_needs: asList(b, 'accessibility_needs', L.ACCESSIBILITY_NEEDS),
        assistive_tech: asList(b, 'assistive_tech', L.ASSISTIVE_TECH),
        preferred_work_mode: L.WORK_MODES[b.preferred_work_mode] ? b.preferred_work_mode : '',
        preferred_interview: asList(b, 'preferred_interview', L.INTERVIEW_MODES)
    };
    const name = clean(b.name, 100);
    const errors = {};
    if (name.length < 2) errors.name = 'Enter your full name.';
    if (!data.skills) errors.skills = 'Add at least one skill, for example "MS Office, typing, customer service".';
    if (!data.education) errors.education = 'Tell us your education, for example "BA, second year".';
    if (data.phone && !isPhone(data.phone)) errors.phone = 'Enter a valid phone number, for example +91 98765 43210.';
    if (data.linkedin_url && !isHttpUrl(data.linkedin_url)) errors.linkedin_url = 'Enter a full web address starting with https://';
    if (data.portfolio_url && !isHttpUrl(data.portfolio_url)) errors.portfolio_url = 'Enter a full web address starting with https://';

    if (Object.keys(errors).length) {
        return renderProfile(req, res, { status: 400, errors, overlay: { ...data, name } });
    }

    const existing = await queryOne('profiles', { user_id: uid }, 'id, resume_path');
    if (req.file) {
        try {
            data.resume_path = await storage.saveResume(uid, req.file);
            if (existing && existing.resume_path) storage.removeResume(existing.resume_path);
        } catch (e) {
            console.error('Resume save error:', e.message);
            return renderProfile(req, res, { status: 500, errors: { resume: 'We could not save your resume. Please try again.' }, overlay: { ...data, name } });
        }
    }
    data.updated_at = new Date().toISOString();
    if (existing) await runStmt('update', 'profiles', data, { user_id: uid });
    else await runStmt('insert', 'profiles', { user_id: uid, ...data });
    await runStmt('update', 'users', { name }, { id: uid });
    req.session.user.name = name;
    const wasIncomplete = req.session.user.profileComplete === false;
    req.session.user.profileComplete = true;

    const back = req.session.returnTo;
    delete req.session.returnTo;
    req.session.success = wasIncomplete
        ? 'Your profile is saved and complete. You can now apply for jobs.'
        : 'Your profile is saved.';
    res.redirect(back && back.startsWith('/jobs/') ? back : (wasIncomplete ? '/jobs' : '/seeker/dashboard'));
}

// ── Applications ──────────────────────────────────────────────────────────
router.get('/applications', requireProfileComplete, async (req, res) => {
    try {
        const { data, error } = await supabase.from('applications')
            .select('*, jobs!inner(id, title, company, location, job_type)')
            .eq('seeker_id', req.session.user.id).order('applied_at', { ascending: false });
        if (error) throw error;
        res.render('seeker/applications', { title: 'My applications — VisionConnect Jobs', applications: data || [] });
    } catch (err) {
        console.error('Applications error:', err.message);
        req.session.error = 'We could not load your applications. Please try again.';
        res.redirect('/seeker/dashboard');
    }
});

router.post('/applications/:id(\\d+)/withdraw', async (req, res) => {
    try {
        const r = await runStmt('delete', 'applications', {}, { id: req.params.id, seeker_id: req.session.user.id });
        req.session.success = r.changes ? 'Your application was withdrawn.' : 'We could not find that application.';
    } catch (err) {
        console.error('Withdraw error:', err.message);
        req.session.error = 'We could not withdraw your application. Please try again.';
    }
    res.redirect('/seeker/applications');
});

// ── Saved jobs ────────────────────────────────────────────────────────────
router.get('/saved-jobs', async (req, res) => {
    try {
        const { data, error } = await supabase.from('saved_jobs')
            .select('id, saved_at, jobs!inner(id, title, company, location, job_type, description, is_active, is_approved)')
            .eq('user_id', req.session.user.id).order('saved_at', { ascending: false });
        if (error) throw error;
        res.render('seeker/saved-jobs', {
            title: 'Saved jobs — VisionConnect Jobs',
            jobs: (data || []).map(s => ({ ...s.jobs, saved_at: s.saved_at })).filter(j => j.is_active && j.is_approved)
        });
    } catch (err) {
        console.error('Saved jobs error:', err.message);
        req.session.error = 'We could not load your saved jobs. Please try again.';
        res.redirect('/seeker/dashboard');
    }
});

router.post('/saved-jobs/toggle', async (req, res) => {
    const wantsJson = (req.get('accept') || '').includes('application/json');
    const job_id = parseInt(req.body.job_id, 10);
    const user_id = req.session.user.id;
    const done = (status, message, code = 200) => {
        if (wantsJson) return res.status(code).json({ status, message });
        req.session[code === 200 ? 'success' : 'error'] = message;
        let dest = '/seeker/saved-jobs';
        try { const u = new URL(req.get('referer') || '', 'http://x'); if (u.pathname !== '/') dest = u.pathname + u.search; } catch (_) { /* keep default */ }
        res.redirect(dest);
    };
    if (!job_id) return done('error', 'Unknown job.', 400);
    try {
        const title = (await queryOne('jobs', { id: job_id }, 'title') || {}).title;
        if (!title) return done('error', 'That job no longer exists.', 404);
        if (await queryOne('saved_jobs', { user_id, job_id }, 'id')) {
            await runStmt('delete', 'saved_jobs', {}, { user_id, job_id });
            return done('removed', `Removed "${title}" from your saved jobs.`);
        }
        await runStmt('insert', 'saved_jobs', { user_id, job_id });
        return done('saved', `Saved "${title}".`);
    } catch (err) {
        console.error('Toggle save error:', err.message);
        return done('error', 'We could not update your saved jobs. Please try again.', 500);
    }
});

module.exports = router;
