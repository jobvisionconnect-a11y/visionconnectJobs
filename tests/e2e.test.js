/**
 * End-to-end tests. They run the real Express app against a real Supabase
 * (or PostgREST) project, so they need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Use a TEST project, never production: the tests create and delete data.
 *   STORAGE_DRIVER=local npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    test('e2e skipped', { skip: 'set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (a TEST project) to run' }, () => {});
    return;
}
process.env.STORAGE_DRIVER = process.env.STORAGE_DRIVER || 'local';
process.env.MAIL_QUIET = '1';
delete process.env.BREVO_API_KEY; delete process.env.RESEND_API_KEY; delete process.env.MAIL_PROVIDER;

const app = require('../server');
const { supabase } = require('../db/supabase');
const storage = require('../lib/storage');

let server, base;
const run = Date.now().toString(36);
const T = `QA${run}`;
const email = n => `${n}.${run}@test.example`;

class Client {
    constructor() { this.cookies = {}; }
    async req(method, path, { form, json, multipart, headers = {} } = {}) {
        const h = { ...headers };
        const c = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
        if (c) h.cookie = c;
        let body;
        if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; const u = new URLSearchParams();
            for (const [k, v] of Object.entries(form)) (Array.isArray(v) ? v : [v]).forEach(x => u.append(k, x));
            body = u.toString(); }
        if (json) { h['content-type'] = 'application/json'; h.accept = 'application/json'; body = JSON.stringify(json); }
        if (multipart) body = multipart;
        const res = await fetch(base + path, { method, headers: h, body, redirect: 'manual' });
        for (const sc of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
            const [kv] = sc.split(';'); const i = kv.indexOf('=');
            const k = kv.slice(0, i), v = kv.slice(i + 1);
            if (v === '' || /expires=Thu, 01 Jan 1970/i.test(sc)) delete this.cookies[k]; else this.cookies[k] = v;
        }
        const text = await res.text();
        return { status: res.status, headers: res.headers, text, location: res.headers.get('location') };
    }
    get(p, o) { return this.req('GET', p, o); }
    async token(path) {
        const r = await this.get(path);
        const m = r.text.match(/name="_csrf" value="([a-f0-9]+)"/);
        assert.ok(m, `no csrf token on ${path} (status ${r.status})`);
        return m[1];
    }
    async post(path, fields, tokenFrom) {
        const _csrf = await this.token(tokenFrom || path);
        return this.req('POST', path, { form: { _csrf, ...fields } });
    }
    async follow(res) { return res.location ? this.get(res.location) : res; }
}

const jobBody = (o = {}) => ({
    title: `Data Entry Operator ${T}`, company: 'Acme Accessibility', location: 'Pune', job_type: 'full-time', work_mode: 'office',
    description: 'Enter customer records into our system using a screen reader friendly tool.',
    requirements: 'Typing, MS Excel', salary_range: '15000', openings: '2',
    disability_categories: 'all', assistive_tech_provided: ['screen_reader', 'braille'], interview_modes: ['phone', 'voice'],
    accessibility_features: 'Ground floor office', ...o
});

test.before(async () => {
    await storage.init();
    await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
    const { data: users } = await supabase.from('users').select('id').like('email', `%.${run}@test.example`);
    if (users && users.length) await supabase.from('users').delete().in('id', users.map(u => u.id));
    await new Promise(r => server.close(r));
    setTimeout(() => process.exit(0), 100).unref();
});

const seeker = new Client(), employer = new Client(), admin = new Client(), other = new Client(), otherEmp = new Client();
let jobId, job2Id;

test('landing page is accessible HTML with strict security headers', async () => {
    const r = await new Client().get('/');
    assert.equal(r.status, 200);
    assert.match(r.text, /<html lang="en">/);
    assert.equal((r.text.match(/<h1[ >]/g) || []).length, 1, 'exactly one h1');
    assert.match(r.text, /Skip to main content/);
    assert.match(r.text, /<main id="main"/);
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.doesNotMatch(r.text, /<script>|<style>| style="/, 'no inline scripts or styles (CSP safe)');
});

test('static assets are served, and /uploads is not public', async () => {
    const c = new Client();
    for (const p of ['/css/main.css', '/js/app.js', '/js/voice.js', '/js/prefs-init.js', '/favicon.svg']) assert.equal((await c.get(p)).status, 200, p);
    assert.equal((await c.get('/uploads/resumes/.gitkeep')).status, 404);
});

test('register: validation errors are summarised, linked to fields, and keep input', async () => {
    const c = new Client();
    const r = await c.post('/auth/register', { name: 'A', email: 'nope', password: 'short', confirmPassword: 'x', role: '' });
    assert.equal(r.status, 400);
    assert.match(r.text, /There are 4 problems to fix/);
    assert.match(r.text, /href="#email"/);
    assert.match(r.text, /aria-invalid="true"/);
    assert.match(r.text, /role="alert"/);
});

test('register seeker, employer and admin; accounts need CSRF', async () => {
    const noCsrf = await new Client().req('POST', '/auth/register', { form: { name: 'X' } });
    assert.equal(noCsrf.status, 403);

    let r = await seeker.post('/auth/register', { name: 'Asha Seeker', email: email('seeker'), password: 'password123', confirmPassword: 'password123', role: 'seeker' });
    assert.equal(r.status, 302); assert.equal(r.location, '/seeker/profile');
    r = await employer.post('/auth/register', { name: 'Eve Employer', email: email('employer'), password: 'password123', confirmPassword: 'password123', role: 'employer' });
    assert.equal(r.status, 302); assert.equal(r.location, '/employer/jobs/new');
    await other.post('/auth/register', { name: 'Omar Other', email: email('other'), password: 'password123', confirmPassword: 'password123', role: 'seeker' });
    await otherEmp.post('/auth/register', { name: 'Olga OtherEmp', email: email('otheremp'), password: 'password123', confirmPassword: 'password123', role: 'employer' });
    const dup = await new Client().post('/auth/register', { name: 'Dup', email: email('seeker'), password: 'password123', confirmPassword: 'password123', role: 'seeker' });
    assert.equal(dup.status, 400); assert.match(dup.text, /already exists/);

    await supabase.from('users').insert({ email: email('admin'), name: 'Ada Admin', role: 'admin', password_hash: bcrypt.hashSync('adminpass123', 10) });
    const l = await admin.post('/auth/login', { email: email('admin'), password: 'adminpass123' });
    assert.equal(l.location, '/admin/dashboard');
});

test('login: wrong password gives a clear error and no account hint', async () => {
    const r = await new Client().post('/auth/login', { email: email('seeker'), password: 'wrongwrong' });
    assert.equal(r.status, 401);
    assert.match(r.text, /email or password is not correct/);
});

test('seeker must complete the profile before dashboard; profile validation works', async () => {
    let r = await seeker.get('/seeker/dashboard');
    assert.equal(r.location, '/seeker/profile');
    const bad = await seeker.req('POST', '/seeker/profile', { multipart: await profileForm(seeker, { skills: '', education: '', phone: 'abc' }) });
    assert.equal(bad.status, 400);
    assert.match(bad.text, /Add at least one skill/);
    assert.match(bad.text, /valid phone number/);
});

async function profileForm(client, fields, file) {
    const fd = new FormData();
    fd.set('_csrf', await client.token('/seeker/profile'));
    for (const [k, v] of Object.entries({ name: 'Asha Seeker', ...fields })) {
        if (Array.isArray(v)) v.forEach(x => fd.append(k, x)); else fd.set(k, v);
    }
    if (file) fd.set('resume', new Blob([file.content], { type: 'text/plain' }), file.name);
    return fd;
}

test('seeker saves a full profile with a resume', async () => {
    const fd = await profileForm(seeker, {
        skills: 'Typing, MS Excel, NVDA', education: 'BA second year', phone: '+91 98765 43210', location: 'Pune',
        disability_category: 'visual', disability_percent: '80', accessibility_needs: ['screen_reader', 'braille'],
        assistive_tech: ['nvda'], preferred_work_mode: 'remote', preferred_interview: ['phone', 'voice']
    }, { name: 'asha resume.txt', content: 'Asha - resume - 12345' });
    const r = await seeker.req('POST', '/seeker/profile', { multipart: fd });
    assert.equal(r.status, 302, r.text.slice(0, 300));
    assert.equal(r.location, '/jobs');
    const d = await seeker.get('/seeker/dashboard');
    assert.equal(d.status, 200);
    assert.match(d.text, /Hello, Asha Seeker/);
    // bad file type is rejected with a message
    const badFile = await profileForm(seeker, { skills: 'x', education: 'y' }, { name: 'virus.exe', content: 'MZ' });
    const br = await seeker.req('POST', '/seeker/profile', { multipart: badFile });
    assert.equal(br.status, 400); assert.match(br.text, /PDF, DOC, DOCX or TXT/);
});

test('employer: validation, posting, and jobs stay hidden until approved', async () => {
    let r = await employer.post('/employer/jobs/new', { title: 'x', company: '', description: 'short' }, '/employer/jobs/new');
    assert.equal(r.status, 400);
    assert.match(r.text, /There are 3 problems/);

    r = await employer.post('/employer/jobs/new', jobBody(), '/employer/jobs/new');
    assert.equal(r.status, 302); assert.equal(r.location, '/employer/dashboard');
    r = await employer.post('/employer/jobs/new', jobBody({ title: `Telecaller (Hindi) ${T}`, location: 'Mumbai', job_type: 'part-time', assistive_tech_provided: [] }), '/employer/jobs/new');
    assert.equal(r.status, 302);
    const { data } = await supabase.from('jobs').select('id, title').eq('company', 'Acme Accessibility').order('id');
    jobId = data[0].id; job2Id = data[1].id;

    const pub = await new Client().get(`/jobs?q=${T}`);
    assert.doesNotMatch(pub.text, /Data Entry Operator QA/, 'unapproved job must not show');
    const detail = await new Client().get(`/jobs/${jobId}`);
    assert.equal(detail.status, 302);
    const dash = await employer.get('/employer/dashboard');
    assert.match(dash.text, /Waiting for approval/);
});

test('admin: only admins can moderate; reject shows reason; approve publishes', async () => {
    assert.equal((await seeker.get('/admin/dashboard')).status, 302);
    assert.equal((await new Client().get('/admin/jobs')).status, 302);
    const forbidden = await seeker.req('POST', '/admin/jobs/' + jobId + '/approve', { form: { _csrf: await seeker.token('/jobs') } });
    assert.equal(forbidden.status, 302);
    assert.equal((await supabase.from('jobs').select('is_approved').eq('id', jobId).single()).data.is_approved, false);

    const page = await admin.get('/admin/jobs?status=pending');
    assert.match(page.text, /Data Entry Operator QA/);
    let r = await admin.post(`/admin/jobs/${job2Id}/reject`, { reason: 'Please add the salary.' }, '/admin/jobs?status=pending');
    assert.equal(r.status, 302);
    assert.match((await employer.get('/employer/dashboard')).text, /Please add the salary\./);
    r = await admin.post(`/admin/jobs/${jobId}/approve`, {}, '/admin/jobs?status=pending');
    assert.equal(r.status, 302);

    // employer edits the rejected job -> back to pending, reason cleared
    const edit = await employer.get(`/employer/jobs/${job2Id}/edit`);
    assert.equal(edit.status, 200); assert.match(edit.text, /value="Telecaller \(Hindi\) QA/);
    r = await employer.post(`/employer/jobs/${job2Id}/edit`, jobBody({ title: `Telecaller (Hindi) ${T}`, location: 'Mumbai', job_type: 'part-time', salary_range: '12000', assistive_tech_provided: [] }), `/employer/jobs/${job2Id}/edit`);
    assert.equal(r.status, 302);
    await admin.post(`/admin/jobs/${job2Id}/approve`, {}, '/admin/jobs?status=pending');
    // another employer cannot edit it
    assert.equal((await otherEmp.get(`/employer/jobs/${job2Id}/edit`)).location, '/employer/dashboard');
});

test('search: keyword, location, screen-reader filter, special characters, pagination', async () => {
    const c = new Client();
    let r = await c.get(`/jobs?q=${T}`);
    assert.match(r.text, /Data Entry Operator QA/); assert.match(r.text, /Telecaller \(Hindi\) QA/);
    assert.match(r.text, /2 jobs found/);
    r = await c.get(`/jobs?q=${T}`);
    assert.match(r.text, /2 jobs found/);
    r = await c.get(`/jobs?q=${T}&location=mumbai`); assert.match(r.text, /Telecaller \(Hindi\) QA/); assert.doesNotMatch(r.text, /Data Entry Operator QA/);
    r = await c.get(`/jobs?q=${T}&screen_reader=1`); assert.match(r.text, /Data Entry Operator QA/); assert.doesNotMatch(r.text, /Telecaller \(Hindi\) QA/);
    r = await c.get('/jobs?q=' + encodeURIComponent('a,b),(c%*"\'')); assert.equal(r.status, 200, 'special characters cannot break the query');
    r = await c.get(`/jobs?q=${T}&type=part-time`); assert.match(r.text, /1 job found/);
    // pagination
    const rows = Array.from({ length: 12 }, (_, i) => ({ employer_id: null, title: `Pagination job ${i}`, company: 'PageCo', job_type: 'full-time', description: 'x'.repeat(40), is_approved: true, is_active: true }));
    const { data: emp } = await supabase.from('users').select('id').eq('email', email('employer')).single();
    await supabase.from('jobs').insert(rows.map(x => ({ ...x, employer_id: emp.id })));
    r = await c.get('/jobs?q=Pagination');
    assert.match(r.text, /12 jobs found, page 1 of 2/); assert.match(r.text, /Next page/);
    r = await c.get('/jobs?q=Pagination&page=2'); assert.match(r.text, /page 2 of 2/); assert.match(r.text, /Previous page/);
    await supabase.from('jobs').delete().eq('company', 'PageCo');
});

test('job detail shows accessibility info; seeker sees the match hint', async () => {
    const r = await seeker.get(`/jobs/${jobId}`);
    assert.equal(r.status, 200);
    assert.match(r.text, /Screen reader software/); assert.match(r.text, /Voice-only/);
    assert.match(r.text, /Open to your disability category/);
    assert.match(r.text, /Quick apply/); assert.match(r.text, /Jump to apply/);
    const anon = await new Client().get(`/jobs/${jobId}`);
    assert.match(anon.text, /Log in or create a free account to apply/);
});

test('apply: quick apply, no duplicates, cover letter, withdraw', async () => {
    let r = await seeker.post(`/jobs/${jobId}/quick-apply`, {}, `/jobs/${jobId}`);
    assert.equal(r.status, 302); assert.equal(r.location, '/seeker/applications');
    r = await seeker.post(`/jobs/${jobId}/quick-apply`, {}, `/jobs/${jobId}`);
    assert.equal(r.location, `/jobs/${jobId}`);
    assert.match((await seeker.get(`/jobs/${jobId}`)).text, /You have applied/);
    r = await seeker.post(`/jobs/${job2Id}/apply`, { cover_letter: 'I am keen to work in telecalling.' }, `/jobs/${job2Id}`);
    assert.equal(r.status, 302);
    const apps = await seeker.get('/seeker/applications');
    assert.match(apps.text, /2 applications/); assert.match(apps.text, /Withdraw application/);
    // an employer cannot apply
    assert.equal((await employer.post(`/jobs/${jobId}/quick-apply`, {}, '/employer/dashboard')).status, 302);
    // incomplete-profile seeker is sent to the profile
    r = await other.post(`/jobs/${jobId}/quick-apply`, {}, '/seeker/profile');
    assert.equal(r.location, '/seeker/profile');
    // withdraw job2
    const { data: a } = await supabase.from('applications').select('id').eq('job_id', job2Id).single();
    r = await seeker.post(`/seeker/applications/${a.id}/withdraw`, {}, '/seeker/applications');
    assert.equal(r.status, 302);
    assert.equal((await supabase.from('applications').select('id').eq('job_id', job2Id)).data.length, 0);
});

test('employer sees applicants with readable labels; resume access is restricted', async () => {
    const r = await employer.get(`/employer/jobs/${jobId}/applicants`);
    assert.equal(r.status, 200);
    assert.match(r.text, /Asha Seeker/);
    assert.match(r.text, /Visual impairment \(blind \/ low vision\)/, 'human-readable category, not the raw code');
    assert.match(r.text, /Screen reader software/);
    assert.match(r.text, /Voice-only/);
    const { data: u } = await supabase.from('users').select('id').eq('email', email('seeker')).single();
    const resume = await employer.get(`/files/resume/${u.id}`);
    assert.equal(resume.status, 200); assert.match(resume.text, /Asha - resume - 12345/);
    assert.equal((await seeker.get(`/files/resume/${u.id}`)).status, 200, 'owner can open own resume');
    assert.equal((await admin.get(`/files/resume/${u.id}`)).status, 200, 'admin can');
    assert.equal((await otherEmp.get(`/files/resume/${u.id}`)).status, 403, 'employer with no application from this seeker cannot');
    assert.equal((await other.get(`/files/resume/${u.id}`)).status, 403, 'another seeker cannot');
    assert.equal((await new Client().get(`/files/resume/${u.id}`)).status, 302, 'anonymous is sent to log in');
    // another employer cannot see these applicants
    assert.equal((await otherEmp.get(`/employer/jobs/${jobId}/applicants`)).location, '/employer/dashboard');
});

test('status changes reach the seeker; filters work', async () => {
    const { data: a } = await supabase.from('applications').select('id').eq('job_id', jobId).single();
    let r = await employer.post(`/employer/jobs/${jobId}/applicants/${a.id}/status`, { status: 'shortlisted' }, `/employer/jobs/${jobId}/applicants`);
    assert.equal(r.status, 302);
    assert.match((await seeker.get('/seeker/applications')).text, /Shortlisted/);
    assert.match((await employer.get(`/employer/jobs/${jobId}/applicants?status=shortlisted`)).text, /Asha Seeker/);
    assert.match((await employer.get(`/employer/jobs/${jobId}/applicants?status=hired`)).text, /No applicants here/);
    r = await employer.post(`/employer/jobs/${jobId}/applicants/${a.id}/status`, { status: 'bogus' }, `/employer/jobs/${jobId}/applicants`);
    assert.match((await employer.get(r.location)).text, /Choose a valid status/);
    // employer closes the job -> disappears from search
    await employer.post(`/employer/jobs/${jobId}/toggle`, {}, '/employer/dashboard');
    assert.doesNotMatch((await new Client().get(`/jobs?q=${T}`)).text, /Data Entry Operator QA/);
    await employer.post(`/employer/jobs/${jobId}/toggle`, {}, '/employer/dashboard');
});

test('saved jobs: JSON toggle for scripts, form fallback without JS', async () => {
    const t = await seeker.token('/jobs');
    let r = await seeker.req('POST', '/seeker/saved-jobs/toggle', { json: { job_id: String(jobId), _csrf: t } });
    assert.equal(JSON.parse(r.text).status, 'saved');
    assert.match((await seeker.get('/seeker/saved-jobs')).text, /Data Entry Operator QA/);
    assert.match((await seeker.get('/jobs')).text, /aria-pressed="true"/);
    r = await seeker.req('POST', '/seeker/saved-jobs/toggle', { json: { job_id: String(jobId), _csrf: t } });
    assert.equal(JSON.parse(r.text).status, 'removed');
    r = await seeker.req('POST', '/seeker/saved-jobs/toggle', { form: { job_id: String(jobId), _csrf: t } });
    assert.equal(r.status, 302);
    r = await seeker.req('POST', '/seeker/saved-jobs/toggle', { json: { job_id: String(jobId) } });
    assert.equal(r.status, 403, 'CSRF enforced on JSON too');
});

test('admin pages render', async () => {
    for (const p of ['/admin/dashboard', '/admin/users', '/admin/users?role=seeker', '/admin/jobs', '/admin/jobs?status=approved']) {
        const r = await admin.get(p); assert.equal(r.status, 200, p);
    }
    assert.match((await admin.get('/admin/users')).text, /Suspend/);
});

test('suspended users cannot log in', async () => {
    const { data: u } = await supabase.from('users').select('id').eq('email', email('other')).single();
    await admin.post(`/admin/users/${u.id}/toggle`, {}, '/admin/users');
    const r = await new Client().post('/auth/login', { email: email('other'), password: 'password123' });
    assert.equal(r.status, 403); assert.match(r.text, /suspended/);
});

test('logout needs POST; GET shows a confirmation page; session really ends', async () => {
    const c = new Client();
    await c.post('/auth/login', { email: email('otheremp'), password: 'password123' });
    assert.match((await c.get('/auth/logout')).text, /Log out of VisionConnect/);
    assert.equal((await c.get('/employer/dashboard')).status, 200);
    await c.post('/auth/logout', {}, '/employer/dashboard');
    assert.equal((await c.get('/employer/dashboard')).location, '/auth/login');
});

test('login is rate limited', async () => {
    const c = new Client();
    let last;
    for (let i = 0; i < 12; i++) last = await c.post('/auth/login', { email: email('ratelimit'), password: 'nope-nope' });
    assert.equal(last.status, 429);
});

test('sessions persist in the database, and the anon key could never read users', async () => {
    const { count } = await supabase.from('sessions').select('*', { count: 'exact', head: true });
    assert.ok(count > 0);
    const r = await seeker.get('/this/does/not/exist');
    assert.equal(r.status, 404); assert.match(r.text, /Page not found/);
});


test('health check touches the database; keep-alive only runs when configured', async () => {
    const c = new Client();
    assert.equal((await c.get('/healthz')).text, 'ok');
    assert.equal((await c.get('/healthz?db=1')).status, 200);
    const ka = require('../lib/keepalive');
    delete process.env.RENDER_EXTERNAL_URL; delete process.env.KEEP_ALIVE_URL;
    assert.equal(ka.start(), null);
    process.env.KEEP_ALIVE_URL = base;
    const timer = ka.start();
    assert.ok(timer); clearInterval(timer);
    process.env.KEEP_ALIVE = 'off'; assert.equal(ka.start(), null); delete process.env.KEEP_ALIVE; delete process.env.KEEP_ALIVE_URL;
});

test('legal and contact pages render', async () => {
    const c = new Client();
    for (const p of ['/privacy', '/terms', '/contact', '/auth/forgot']) assert.equal((await c.get(p)).status, 200, p);
});

test('forgot / reset password: one-time link, same answer for unknown emails, signs out other sessions', async () => {
    const mail = require('../lib/mail');
    const c = new Client(), phone = new Client();
    await c.post('/auth/register', { name: 'Reset Rita', email: email('reset'), password: 'oldpassword1', confirmPassword: 'oldpassword1', role: 'seeker' });
    await phone.post('/auth/login', { email: email('reset'), password: 'oldpassword1' });
    assert.equal((await phone.get('/seeker/profile')).status, 200);

    mail.outbox.length = 0;
    const anon = new Client();
    let r = await anon.post('/auth/forgot', { email: email('nobody') });
    assert.match(r.text, /Check your email/); assert.equal(mail.outbox.length, 0, 'no email for unknown address');
    r = await anon.post('/auth/forgot', { email: email('reset') });
    assert.match(r.text, /Check your email/); assert.equal(mail.outbox.length, 1);
    const link = mail.outbox[0].text.match(/\/auth\/reset\/([a-f0-9]{64})/);
    assert.ok(link, 'email contains a reset link');
    const token = link[1];

    assert.equal((await anon.get(`/auth/reset/${token}`)).status, 200);
    assert.equal((await anon.get(`/auth/reset/${'0'.repeat(64)}`)).status, 400);
    r = await anon.post(`/auth/reset/${token}`, { password: 'short', confirmPassword: 'short' }, `/auth/reset/${token}`);
    assert.equal(r.status, 400);
    r = await anon.post(`/auth/reset/${token}`, { password: 'brandnewpass1', confirmPassword: 'brandnewpass1' }, `/auth/reset/${token}`);
    assert.equal(r.status, 302); assert.equal(r.location, '/auth/login');
    assert.equal((await anon.get(`/auth/reset/${token}`)).status, 400, 'link cannot be reused');
    assert.equal((await new Client().post('/auth/login', { email: email('reset'), password: 'oldpassword1' })).status, 401);
    assert.equal((await new Client().post('/auth/login', { email: email('reset'), password: 'brandnewpass1' })).status, 302);
    assert.equal((await phone.get('/seeker/profile')).location, '/auth/login', 'old session was signed out');
});

test('notifications are emailed to employer and seeker', async () => {
    const mail = require('../lib/mail');
    mail.outbox.length = 0;
    const emp = new Client(), sk = new Client();
    await emp.post('/auth/register', { name: 'Nina Notify', email: email('notifyemp'), password: 'password123', confirmPassword: 'password123', role: 'employer' });
    await sk.post('/auth/register', { name: 'Sam Notify', email: email('notifysk'), password: 'password123', confirmPassword: 'password123', role: 'seeker' });
    const fd = new FormData(); fd.set('_csrf', await sk.token('/seeker/profile')); fd.set('name', 'Sam Notify'); fd.set('skills', 'Typing'); fd.set('education', 'BA');
    await sk.req('POST', '/seeker/profile', { multipart: fd });
    const { data: e } = await supabase.from('users').select('id').eq('email', email('notifyemp')).single();
    const { data: job } = await supabase.from('jobs').insert({ employer_id: e.id, title: 'Notify job ' + T, company: 'N', job_type: 'full-time', description: 'x'.repeat(40), is_approved: true, is_active: true }).select().single();
    await sk.post(`/jobs/${job.id}/quick-apply`, {}, `/jobs/${job.id}`);
    await new Promise(r => setTimeout(r, 600));
    assert.ok(mail.outbox.find(m => m.to === email('notifyemp') && /New applicant/.test(m.subject)), 'employer emailed');
    const { data: a } = await supabase.from('applications').select('id').eq('job_id', job.id).single();
    await emp.post(`/employer/jobs/${job.id}/applicants/${a.id}/status`, { status: 'hired' }, `/employer/jobs/${job.id}/applicants`);
    await new Promise(r => setTimeout(r, 600));
    assert.ok(mail.outbox.find(m => m.to === email('notifysk') && /Hired/.test(m.subject)), 'seeker emailed');
});

test('account: change password and delete account (removes data)', async () => {
    const c = new Client();
    await c.post('/auth/register', { name: 'Del Dev', email: email('delete'), password: 'password123', confirmPassword: 'password123', role: 'seeker' });
    assert.equal((await c.get('/auth/account')).status, 200);
    let r = await c.post('/auth/account/password', { current: 'wrong', password: 'newpassword1', confirmPassword: 'newpassword1' }, '/auth/account');
    assert.equal(r.status, 400); assert.match(r.text, /current password is not correct/);
    r = await c.post('/auth/account/password', { current: 'password123', password: 'newpassword1', confirmPassword: 'newpassword1' }, '/auth/account');
    assert.equal(r.status, 302);
    r = await c.post('/auth/account/delete', { delete_password: 'bad', confirm: 'DELETE' }, '/auth/account');
    assert.equal(r.status, 400);
    r = await c.post('/auth/account/delete', { delete_password: 'newpassword1', confirm: 'nope' }, '/auth/account');
    assert.equal(r.status, 400); assert.match(r.text, /Type DELETE/);
    r = await c.post('/auth/account/delete', { delete_password: 'newpassword1', confirm: 'DELETE' }, '/auth/account');
    assert.equal(r.status, 302);
    assert.equal((await supabase.from('users').select('id').eq('email', email('delete'))).data.length, 0);
    assert.equal((await new Client().post('/auth/login', { email: email('delete'), password: 'newpassword1' })).status, 401);
    // admins cannot self-delete
    r = await admin.post('/auth/account/delete', { delete_password: 'adminpass123', confirm: 'DELETE' }, '/auth/account');
    assert.equal(r.status, 400);
});
