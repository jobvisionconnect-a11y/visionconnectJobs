/** /admin — approve jobs, manage users */
const express = require('express');
const router = express.Router();
const { supabase, queryOne, runStmt } = require('../db/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { clean } = require('../lib/validate');

router.use(requireAuth, requireRole('admin'));

const count = async (table, filter = {}) => {
    let q = supabase.from(table).select('*', { count: 'exact', head: true });
    for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
    const { count: c, error } = await q;
    if (error) throw error;
    return c || 0;
};

router.get('/', (req, res) => res.redirect('/admin/dashboard'));
router.get('/dashboard', async (req, res) => {
    try {
        const [totalUsers, seekers, employers, totalJobs, pendingJobs, liveJobs, applications, recent, users] = await Promise.all([
            count('users'), count('users', { role: 'seeker' }), count('users', { role: 'employer' }),
            count('jobs'), count('jobs', { is_approved: false }), count('jobs', { is_approved: true }), count('applications'),
            supabase.from('jobs').select('id, title, company, is_approved, rejection_reason, created_at, users!inner(name)')
                .order('created_at', { ascending: false }).limit(5),
            supabase.from('users').select('id, name, email, role, created_at').order('created_at', { ascending: false }).limit(5)
        ]);
        res.render('admin/dashboard', {
            title: 'Admin dashboard — VisionConnect Jobs',
            stats: { totalUsers, seekers, employers, totalJobs, pendingJobs, liveJobs, applications },
            recentJobs: recent.data || [], recentUsers: users.data || []
        });
    } catch (err) {
        console.error('Admin dashboard error:', err.message);
        req.session.error = 'We could not load the dashboard.';
        res.redirect('/');
    }
});

router.get('/users', async (req, res) => {
    const role = ['seeker', 'employer', 'admin'].includes(req.query.role) ? req.query.role : 'all';
    try {
        let q = supabase.from('users').select('id, name, email, role, is_approved, created_at').order('created_at', { ascending: false });
        if (role !== 'all') q = q.eq('role', role);
        const { data, error } = await q;
        if (error) throw error;
        res.render('admin/users', { title: 'Manage users — VisionConnect Jobs', users: data || [], filterRole: role });
    } catch (err) {
        console.error('Admin users error:', err.message);
        res.redirect('/admin/dashboard');
    }
});

router.post('/users/:id(\\d+)/toggle', async (req, res) => {
    try {
        const user = await queryOne('users', { id: req.params.id }, 'id, name, is_approved');
        if (!user) req.session.error = 'User not found.';
        else if (user.id === req.session.user.id) req.session.error = 'You cannot suspend your own account.';
        else {
            await runStmt('update', 'users', { is_approved: !user.is_approved }, { id: user.id });
            req.session.success = user.is_approved ? `${user.name} was suspended.` : `${user.name} can log in again.`;
        }
    } catch (err) {
        console.error('User toggle error:', err.message);
        req.session.error = 'We could not update that user.';
    }
    res.redirect('/admin/users' + (req.body.role ? `?role=${encodeURIComponent(req.body.role)}` : ''));
});

router.get('/jobs', async (req, res) => {
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'all';
    try {
        let q = supabase.from('jobs').select('*, users!inner(name, email)').order('created_at', { ascending: false });
        if (status === 'pending') q = q.eq('is_approved', false).is('rejection_reason', null);
        if (status === 'rejected') q = q.eq('is_approved', false).not('rejection_reason', 'is', null);
        if (status === 'approved') q = q.eq('is_approved', true);
        const { data, error } = await q;
        if (error) throw error;
        res.render('admin/jobs', { title: 'Manage jobs — VisionConnect Jobs', jobs: data || [], filterStatus: status });
    } catch (err) {
        console.error('Admin jobs error:', err.message);
        res.redirect('/admin/dashboard');
    }
});

router.post('/jobs/:id(\\d+)/approve', async (req, res) => {
    try {
        await runStmt('update', 'jobs', { is_approved: true, rejection_reason: null }, { id: req.params.id });
        req.session.success = 'Job approved. It is now visible to job seekers.';
    } catch (err) { console.error(err.message); req.session.error = 'We could not approve that job.'; }
    res.redirect('/admin/jobs?status=pending');
});

router.post('/jobs/:id(\\d+)/reject', async (req, res) => {
    const reason = clean(req.body.reason, 300) || 'Does not meet our posting guidelines.';
    try {
        await runStmt('update', 'jobs', { is_approved: false, rejection_reason: reason }, { id: req.params.id });
        req.session.success = 'Job rejected. The employer can see your reason and edit the job.';
    } catch (err) { console.error(err.message); req.session.error = 'We could not reject that job.'; }
    res.redirect('/admin/jobs?status=pending');
});

router.post('/jobs/:id(\\d+)/delete', async (req, res) => {
    try {
        await runStmt('delete', 'jobs', {}, { id: req.params.id });
        req.session.success = 'Job and its applications were permanently deleted.';
    } catch (err) { console.error(err.message); req.session.error = 'We could not delete that job.'; }
    res.redirect('/admin/jobs');
});

module.exports = router;
