/** /jobs — public search, job detail, applying */
const express = require('express');
const router = express.Router();
const { supabase, queryOne, runStmt } = require('../db/supabase');
const { requireAuth, requireRole, isProfileComplete } = require('../middleware/auth');
const { clean, filterSafe } = require('../lib/validate');
const mail = require('../lib/mail');
const { jobMatchesSeeker, isClosed, JOB_TYPES, WORK_MODES } = require('../lib/labels');

const PAGE_SIZE = 10;
const today = () => new Date().toISOString().slice(0, 10);

// ── GET /jobs ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    const filters = {
        q: clean(req.query.q, 80),
        type: JOB_TYPES[req.query.type] ? req.query.type : 'all',
        work_mode: WORK_MODES[req.query.work_mode] ? req.query.work_mode : 'all',
        location: clean(req.query.location, 80),
        screen_reader: req.query.screen_reader === '1',
        match: req.query.match === '1'
    };
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const isSeeker = req.session.user && req.session.user.role === 'seeker';
    const view = { title: 'Find jobs — VisionConnect Jobs', filters, page, pageSize: PAGE_SIZE };

    try {
        let profile = null;
        if (isSeeker) {
            profile = await queryOne('profiles', { user_id: req.session.user.id },
                'disability_category, disability_percent');
        }
        const canMatch = !!(profile && profile.disability_category && profile.disability_category !== 'undisclosed');

        let q = supabase.from('jobs').select('*, users!inner(name)', { count: 'exact' })
            .eq('is_approved', true).eq('is_active', true)
            .or(`application_deadline.is.null,application_deadline.gte.${today()}`);

        const term = filterSafe(filters.q);
        if (term) q = q.or(`title.ilike.%${term}%,company.ilike.%${term}%,description.ilike.%${term}%,requirements.ilike.%${term}%`);
        if (filters.type !== 'all') q = q.eq('job_type', filters.type);
        if (filters.work_mode !== 'all') q = q.eq('work_mode', filters.work_mode);
        const loc = filterSafe(filters.location);
        if (loc) q = q.ilike('location', `%${loc}%`);
        if (filters.screen_reader) q = q.ilike('assistive_tech_provided', '%screen_reader%');
        if (filters.match && canMatch) {
            q = q.or(`disability_categories.eq.all,disability_categories.ilike.%${profile.disability_category}%`)
                 .lte('min_disability_percent', profile.disability_percent || 0);
        }

        const from = (page - 1) * PAGE_SIZE;
        const { data, count, error } = await q.order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
        if (error) throw error;

        let saved = new Set();
        if (isSeeker) {
            const s = await supabase.from('saved_jobs').select('job_id').eq('user_id', req.session.user.id);
            saved = new Set((s.data || []).map(r => r.job_id));
        }
        const jobs = (data || []).map(j => ({
            ...j, employer_name: j.users ? j.users.name : '',
            is_saved: saved.has(j.id), fits: jobMatchesSeeker(j, profile)
        }));
        res.render('jobs/search', { ...view, jobs, resultCount: count || 0, totalPages: Math.max(1, Math.ceil((count || 0) / PAGE_SIZE)), canMatch, loadError: false });
    } catch (err) {
        console.error('Search error:', err.message);
        res.status(500).render('jobs/search', { ...view, jobs: [], resultCount: 0, totalPages: 1, canMatch: false, loadError: true });
    }
});

// ── GET /jobs/:id ─────────────────────────────────────────────────────────
router.get('/:id(\\d+)', async (req, res) => {
    try {
        const { data: job, error } = await supabase.from('jobs').select('*, users!inner(name)')
            .eq('id', req.params.id).eq('is_approved', true).eq('is_active', true).maybeSingle();
        if (error) throw error;
        if (!job) {
            req.session.error = 'That job is no longer available.';
            return res.redirect('/jobs');
        }
        let hasApplied = false, isSaved = false, profile = null;
        if (req.session.user && req.session.user.role === 'seeker') {
            const uid = req.session.user.id;
            const [a, s, p] = await Promise.all([
                supabase.from('applications').select('id, status').eq('job_id', job.id).eq('seeker_id', uid).maybeSingle(),
                supabase.from('saved_jobs').select('id').eq('job_id', job.id).eq('user_id', uid).maybeSingle(),
                queryOne('profiles', { user_id: uid }, 'skills, education, disability_category, disability_percent, udid_number')
            ]);
            hasApplied = a.data || false;
            isSaved = !!s.data;
            profile = p;
        }
        res.render('jobs/detail', {
            title: `${job.title} at ${job.company} — VisionConnect Jobs`,
            job: { ...job, employer_name: job.users.name },
            hasApplied, isSaved, profile,
            fits: jobMatchesSeeker(job, profile),
            closed: isClosed(job.application_deadline),
            profileReady: isProfileComplete(profile)
        });
    } catch (err) {
        console.error('Job detail error:', err.message);
        req.session.error = 'We could not load that job. Please try again.';
        res.redirect('/jobs');
    }
});

// ── Applying ──────────────────────────────────────────────────────────────
async function checkCanApply(req, res) {
    const jobId = parseInt(req.params.id, 10);
    const back = `/jobs/${jobId}`;
    const job = await queryOne('jobs', { id: jobId, is_approved: true, is_active: true }, 'id, title, application_deadline');
    if (!job || isClosed(job.application_deadline)) {
        req.session.error = 'This job is closed or no longer available.';
        res.redirect('/jobs'); return null;
    }
    const profile = await queryOne('profiles', { user_id: req.session.user.id }, 'skills, education');
    if (!isProfileComplete(profile)) {
        req.session.returnTo = back;
        req.session.error = 'Please add your skills and education to your profile before applying.';
        res.redirect('/seeker/profile'); return null;
    }
    if (await queryOne('applications', { job_id: jobId, seeker_id: req.session.user.id }, 'id')) {
        req.session.error = 'You have already applied for this job.';
        res.redirect(back); return null;
    }
    return job;
}

/** Tell the employer a new application arrived (best effort, never blocks the applicant). */
async function notifyEmployer(req, jobId, title) {
    try {
        const { data } = await supabase.from('jobs').select('users!inner(email, name)').eq('id', jobId).maybeSingle();
        if (!data) return;
        await mail.send({ to: data.users.email, subject: `New applicant for ${title}`,
            text: `Hello ${data.users.name},\n\n${req.session.user.name} has applied for "${title}".\nSee the application: ${mail.baseUrl(req)}/employer/jobs/${jobId}/applicants\n\nVisionConnect Jobs` });
    } catch (e) { console.error('notifyEmployer:', e.message); }
}

async function submit(req, res, quick) {
    try {
        const job = await checkCanApply(req, res);
        if (!job) return;
        const cover = quick ? 'Quick Apply: please see my profile for details.' : clean(req.body.cover_letter, 4000);
        await runStmt('insert', 'applications', {
            job_id: job.id, seeker_id: req.session.user.id, cover_letter: cover, is_quick_apply: quick
        });
        notifyEmployer(req, job.id, job.title);
        req.session.success = `Your application for "${job.title}" was sent. You can follow its progress on your dashboard.`;
        res.redirect('/seeker/applications');
    } catch (err) {
        if (err && err.code === '23505') { // unique violation: double submit
            req.session.error = 'You have already applied for this job.';
            return res.redirect(`/jobs/${req.params.id}`);
        }
        console.error('Apply error:', err.message);
        req.session.error = 'We could not send your application. Please try again.';
        res.redirect(`/jobs/${req.params.id}`);
    }
}
router.post('/:id(\\d+)/apply', requireAuth, requireRole('seeker'), (req, res) => submit(req, res, false));
router.post('/:id(\\d+)/quick-apply', requireAuth, requireRole('seeker'), (req, res) => submit(req, res, true));

module.exports = router;
