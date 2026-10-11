/** /employer — post/edit jobs, review applicants */
const express = require('express');
const router = express.Router();
const { supabase, queryOne, runStmt } = require('../db/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { clean, asList, toInt } = require('../lib/validate');
const L = require('../lib/labels');
const mail = require('../lib/mail');

router.use(requireAuth, requireRole('employer'));

// ── Dashboard ─────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
    try {
        const { data, error } = await supabase.from('jobs')
            .select('*, applications(status)').eq('employer_id', req.session.user.id)
            .order('created_at', { ascending: false });
        if (error) throw error;
        const jobs = (data || []).map(j => ({
            ...j,
            applicationCount: j.applications.length,
            newCount: j.applications.filter(a => a.status === 'applied').length
        }));
        const stats = {
            totalJobs: jobs.length,
            live: jobs.filter(j => j.is_active && j.is_approved).length,
            pending: jobs.filter(j => !j.is_approved && !j.rejection_reason).length,
            applicants: jobs.reduce((n, j) => n + j.applicationCount, 0),
            fresh: jobs.reduce((n, j) => n + j.newCount, 0)
        };
        res.render('employer/dashboard', { title: 'Employer dashboard — VisionConnect Jobs', jobs, stats });
    } catch (err) {
        console.error('Employer dashboard error:', err.message);
        req.session.error = 'We could not load your dashboard. Please try again.';
        res.redirect('/');
    }
});

// ── Job form (new + edit) ─────────────────────────────────────────────────
const blankJob = () => ({
    title: '', company: '', location: '', job_type: 'full-time', work_mode: 'office', description: '',
    requirements: '', salary_range: '', experience_required: '', openings: 1, application_deadline: '',
    disability_categories: 'all', min_disability_percent: 0, udid_required: false,
    accessibility_features: '', accommodation_details: '', assistive_tech_provided: '', interview_modes: ''
});

function parseJob(b) {
    const cats = asList(b, 'disability_categories', { all: 1, ...L.JOB_DISABILITY_CATEGORIES });
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(b.application_deadline || '') ? b.application_deadline : null;
    return {
        title: clean(b.title, 120), company: clean(b.company, 120), location: clean(b.location, 120),
        job_type: L.JOB_TYPES[b.job_type] ? b.job_type : 'full-time',
        work_mode: L.WORK_MODES[b.work_mode] ? b.work_mode : 'office',
        description: clean(b.description, 6000), requirements: clean(b.requirements, 3000),
        salary_range: clean(b.salary_range, 80), experience_required: clean(b.experience_required, 120),
        openings: toInt(b.openings, 1, 1000, 1), application_deadline: deadline,
        disability_categories: !cats || cats.split(',').includes('all') ? 'all' : cats,
        min_disability_percent: toInt(b.min_disability_percent, 0, 100),
        udid_required: b.udid_required === '1',
        accessibility_features: clean(b.accessibility_features, 2000),
        accommodation_details: clean(b.accommodation_details, 2000),
        assistive_tech_provided: asList(b, 'assistive_tech_provided', L.TECH_PROVIDED),
        interview_modes: asList(b, 'interview_modes', L.INTERVIEW_MODES)
    };
}

function validateJob(j) {
    const e = {};
    if (j.title.length < 3) e.title = 'Enter a job title (at least 3 letters).';
    if (j.company.length < 2) e.company = 'Enter your company or organisation name.';
    if (j.description.length < 30) e.description = 'Describe the job in at least 30 characters, so candidates understand what they would do.';
    if (j.application_deadline && j.application_deadline < new Date().toISOString().slice(0, 10)) {
        e.application_deadline = 'The last date to apply cannot be in the past.';
    }
    return e;
}

router.get('/jobs/new', (req, res) => {
    res.render('employer/job-form', {
        title: 'Post a job — VisionConnect Jobs', mode: 'new',
        job: { ...blankJob(), company: '' }, errors: {}
    });
});

router.post('/jobs/new', async (req, res) => {
    const job = parseJob(req.body);
    const errors = validateJob(job);
    if (Object.keys(errors).length) {
        return res.status(400).render('employer/job-form', { title: 'Post a job — VisionConnect Jobs', mode: 'new', job, errors });
    }
    try {
        await runStmt('insert', 'jobs', { ...job, employer_id: req.session.user.id, is_approved: false });
        req.session.success = 'Your job was submitted. It will appear on the site once our team approves it, usually within one working day.';
        res.redirect('/employer/dashboard');
    } catch (err) {
        console.error('Job post error:', err.message);
        errors.form = 'We could not save your job. Please try again.';
        res.status(500).render('employer/job-form', { title: 'Post a job — VisionConnect Jobs', mode: 'new', job, errors });
    }
});

async function ownJob(req, res) {
    const job = await queryOne('jobs', { id: req.params.id, employer_id: req.session.user.id });
    if (!job) {
        req.session.error = 'We could not find that job in your account.';
        res.redirect('/employer/dashboard');
    }
    return job;
}

router.get('/jobs/:id(\\d+)/edit', async (req, res) => {
    try {
        const job = await ownJob(req, res);
        if (!job) return;
        res.render('employer/job-form', { title: `Edit ${job.title} — VisionConnect Jobs`, mode: 'edit', job, errors: {} });
    } catch (err) {
        console.error('Edit view error:', err.message);
        res.redirect('/employer/dashboard');
    }
});

router.post('/jobs/:id(\\d+)/edit', async (req, res) => {
    try {
        const existing = await ownJob(req, res);
        if (!existing) return;
        const job = parseJob(req.body);
        const errors = validateJob(job);
        if (Object.keys(errors).length) {
            return res.status(400).render('employer/job-form', { title: `Edit ${existing.title} — VisionConnect Jobs`, mode: 'edit', job: { ...job, id: existing.id }, errors });
        }
        await runStmt('update', 'jobs', { ...job, is_approved: false, rejection_reason: null, updated_at: new Date().toISOString() }, { id: existing.id });
        req.session.success = 'Your changes were saved. The job will be checked again before it shows on the site.';
        res.redirect('/employer/dashboard');
    } catch (err) {
        console.error('Job edit error:', err.message);
        req.session.error = 'We could not save your changes. Please try again.';
        res.redirect('/employer/dashboard');
    }
});

// ── Applicants ────────────────────────────────────────────────────────────
router.get('/jobs/:id(\\d+)/applicants', async (req, res) => {
    try {
        const job = await ownJob(req, res);
        if (!job) return;
        const { data: apps, error } = await supabase.from('applications')
            .select('*, users!inner(name, email)').eq('job_id', job.id).order('applied_at', { ascending: false });
        if (error) throw error;
        const ids = (apps || []).map(a => a.seeker_id);
        let profiles = {};
        if (ids.length) {
            const p = await supabase.from('profiles').select('*').in('user_id', ids);
            if (p.error) throw p.error;
            profiles = Object.fromEntries((p.data || []).map(r => [r.user_id, r]));
        }
        const filter = L.STATUS[req.query.status] ? req.query.status : 'all';
        const all = (apps || []).map(a => ({ ...a, profile: profiles[a.seeker_id] || {} }));
        const counts = Object.fromEntries(Object.keys(L.STATUS).map(s => [s, all.filter(a => a.status === s).length]));
        res.render('employer/applicants', {
            title: `Applicants for ${job.title} — VisionConnect Jobs`,
            job, filter, counts, total: all.length,
            applicants: filter === 'all' ? all : all.filter(a => a.status === filter)
        });
    } catch (err) {
        console.error('Applicants error:', err.message);
        req.session.error = 'We could not load the applicants. Please try again.';
        res.redirect('/employer/dashboard');
    }
});

/** Email the job seeker about a status change (best effort). */
async function notifySeeker(req, app, status) {
    try {
        const [u, j] = await Promise.all([queryOne('users', { id: app.seeker_id }, 'email, name'), queryOne('jobs', { id: app.job_id }, 'title, company')]);
        if (!u || !j || status === 'applied') return;
        await mail.send({ to: u.email, subject: `Your application for ${j.title}: ${L.STATUS[status].label}`,
            text: `Hello ${u.name},\n\nYour application for "${j.title}" at ${j.company} is now: ${L.STATUS[status].label}.\n${L.STATUS[status].help}\n\nSee all your applications: ${mail.baseUrl(req)}/seeker/applications\n\nVisionConnect Jobs` });
    } catch (e) { console.error('notifySeeker:', e.message); }
}

router.post('/jobs/:jobId(\\d+)/applicants/:appId(\\d+)/status', async (req, res) => {
    const back = `/employer/jobs/${req.params.jobId}/applicants`;
    const { status } = req.body;
    if (!L.STATUS[status]) { req.session.error = 'Choose a valid status.'; return res.redirect(back); }
    try {
        if (!(await queryOne('jobs', { id: req.params.jobId, employer_id: req.session.user.id }, 'id'))) {
            req.session.error = 'We could not find that job in your account.';
            return res.redirect('/employer/dashboard');
        }
        const r = await runStmt('update', 'applications', { status }, { id: req.params.appId, job_id: req.params.jobId });
        if (r.changes) notifySeeker(req, r.data[0], status);
        req.session.success = r.changes ? `Status changed to "${L.STATUS[status].label}".` : 'We could not find that application.';
    } catch (err) {
        console.error('Status error:', err.message);
        req.session.error = 'We could not change the status. Please try again.';
    }
    res.redirect(back + (req.body.filter && L.STATUS[req.body.filter] ? `?status=${req.body.filter}` : ''));
});

router.post('/jobs/:id(\\d+)/toggle', async (req, res) => {
    try {
        const job = await ownJob(req, res);
        if (!job) return;
        await runStmt('update', 'jobs', { is_active: !job.is_active }, { id: job.id });
        req.session.success = job.is_active ? `"${job.title}" is now closed to new applications.` : `"${job.title}" is open again.`;
        res.redirect('/employer/dashboard');
    } catch (err) {
        console.error('Toggle job error:', err.message);
        req.session.error = 'We could not update that job. Please try again.';
        res.redirect('/employer/dashboard');
    }
});

module.exports = router;
