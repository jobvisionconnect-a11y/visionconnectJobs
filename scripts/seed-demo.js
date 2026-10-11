#!/usr/bin/env node
/**
 * Optional demo data for a TEST project (never run on production):
 *   node scripts/seed-demo.js
 * Creates: admin@demo.test / employer@demo.test / seeker@demo.test (password: demo12345) and 4 approved jobs.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { supabase } = require('../db/supabase');

(async () => {
    const hash = bcrypt.hashSync('demo12345', 10);
    const mk = async (email, name, role) => {
        const { data: ex } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
        if (ex) return ex.id;
        const { data, error } = await supabase.from('users').insert({ email, name, role, password_hash: hash }).select().single();
        if (error) throw error; return data.id;
    };
    await mk('admin@demo.test', 'Demo Admin', 'admin');
    const emp = await mk('employer@demo.test', 'Demo Employer', 'employer');
    const seeker = await mk('seeker@demo.test', 'Demo Seeker', 'seeker');
    await supabase.from('profiles').upsert({
        user_id: seeker, skills: 'Typing, MS Excel, NVDA', education: 'BA second year', phone: '+91 98765 43210', location: 'Pune',
        disability_category: 'visual', disability_percent: 80, assistive_tech: 'nvda', preferred_interview: 'phone,voice'
    }, { onConflict: 'user_id' });
    const jobs = [
        ['Data Entry Operator', 'Sunrise Services', 'Pune', 'full-time', 'office', 'Enter customer records using an accessible web tool. Training provided in the first two weeks.', 'screen_reader,braille', 'phone,voice'],
        ['Telecaller (Hindi and Marathi)', 'ConnectCare', 'Pune', 'part-time', 'remote', 'Call customers to share product updates. Work from home with flexible shifts.', 'screen_reader', 'phone'],
        ['Content Writer Intern', 'WordWorks', 'Mumbai', 'internship', 'hybrid', 'Write short articles and social posts. Mentorship from a senior editor.', '', 'video,written'],
        ['Customer Support Executive', 'HelpDesk Pro', 'Nashik', 'full-time', 'office', 'Answer email and chat queries. We provide JAWS licences and a quiet workstation.', 'screen_reader,magnification', 'in_person,phone']
    ];
    for (const [title, company, location, job_type, work_mode, description, tech, interviews] of jobs) {
        const { data: ex } = await supabase.from('jobs').select('id').eq('title', title).eq('company', company).maybeSingle();
        if (ex) continue;
        await supabase.from('jobs').insert({ employer_id: emp, title, company, location, job_type, work_mode, description,
            requirements: 'Good communication. Basic computer skills.', salary_range: '₹12,000 to ₹20,000 a month',
            assistive_tech_provided: tech, interview_modes: interviews, disability_categories: 'all',
            accessibility_features: 'Ground-floor office with a lift', is_approved: true, is_active: true });
    }
    console.log('Demo data ready. Log in with seeker@demo.test / employer@demo.test / admin@demo.test, password demo12345');
    process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
