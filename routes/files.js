/** /files/resume/:userId — resumes are private; only the owner, an admin, or an employer who received an application can open one. */
const express = require('express');
const router = express.Router();
const { supabase, queryOne } = require('../db/supabase');
const { requireAuth } = require('../middleware/auth');
const storage = require('../lib/storage');

router.get('/resume/:userId(\\d+)', requireAuth, async (req, res) => {
    const me = req.session.user;
    const ownerId = parseInt(req.params.userId, 10);
    try {
        let allowed = me.role === 'admin' || me.id === ownerId;
        if (!allowed && me.role === 'employer') {
            const { data } = await supabase.from('applications')
                .select('id, jobs!inner(employer_id)').eq('seeker_id', ownerId).eq('jobs.employer_id', me.id).limit(1);
            allowed = !!(data && data.length);
        }
        if (!allowed) {
            return res.status(403).render('error', { title: 'Not allowed — VisionConnect Jobs', code: 403,
                message: 'You do not have permission to open this file.' });
        }
        const profile = await queryOne('profiles', { user_id: ownerId }, 'resume_path');
        if (!profile || !profile.resume_path || !(await storage.sendResume(profile.resume_path, res))) {
            return res.status(404).render('error', { title: 'File not found — VisionConnect Jobs', code: 404,
                message: 'This resume is not available. Ask the applicant to upload it again.' });
        }
    } catch (err) {
        console.error('Resume error:', err.message);
        res.status(500).render('error', { title: 'Something went wrong — VisionConnect Jobs', code: 500,
            message: 'We could not open that file. Please try again.' });
    }
});

module.exports = router;
