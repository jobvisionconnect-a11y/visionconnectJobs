/** Shared option lists + display helpers (also exposed to every EJS view as `h`). */

const DISABILITY_CATEGORIES = {
    visual: 'Visual impairment (blind / low vision)',
    hearing: 'Hearing impairment (deaf / hard of hearing)',
    mobility: 'Locomotor / mobility disability',
    cerebral: 'Cerebral palsy',
    intellectual: 'Intellectual disability',
    autism: 'Autism spectrum disorder',
    speech: 'Speech and language disability',
    mental: 'Mental illness',
    dwarfism: 'Dwarfism',
    acid: 'Acid attack survivor',
    multiple: 'Multiple disabilities',
    other: 'Other',
    undisclosed: 'Prefer not to say'
};
const JOB_DISABILITY_CATEGORIES = (() => {
    const o = { ...DISABILITY_CATEGORIES };
    delete o.undisclosed; delete o.dwarfism; delete o.acid;
    return o;
})();

const ACCESSIBILITY_NEEDS = {
    screen_reader: 'Screen reader software (JAWS, NVDA, VoiceOver)',
    braille: 'Braille display or printer',
    magnification: 'Screen magnification software',
    wheelchair: 'Wheelchair-accessible workspace',
    sign_interpreter: 'Sign language interpreter',
    captioning: 'Live captioning or subtitles',
    flexible_hours: 'Flexible working hours',
    remote_option: 'Remote / work-from-home option',
    ergonomic: 'Ergonomic furniture or equipment',
    large_print: 'Large print materials',
    mental_support: 'Quiet space or mental health support',
    transport: 'Accessible transport or parking'
};
const ASSISTIVE_TECH = {
    jaws: 'JAWS screen reader',
    nvda: 'NVDA screen reader',
    voiceover: 'VoiceOver (Apple)',
    talkback: 'TalkBack (Android)',
    zoomtext: 'ZoomText / magnifier',
    braille_dev: 'Braille device',
    hearing_aid: 'Hearing aid or cochlear implant',
    voice_ctrl: 'Voice control software',
    switch: 'Switch access device',
    eye_tracker: 'Eye tracking device',
    none: 'None'
};
const TECH_PROVIDED = {
    screen_reader: 'Screen reader software (JAWS, NVDA, VoiceOver)',
    braille: 'Braille display or printer',
    magnification: 'Magnification software',
    hearing_loop: 'Hearing loop or FM system',
    captioning: 'Live captioning service',
    voice_ctrl: 'Voice control software',
    none: 'None right now, but willing to arrange'
};
const INTERVIEW_MODES = {
    video: 'Video call',
    phone: 'Phone call',
    in_person: 'In person',
    written: 'Written / email-based',
    voice: 'Voice-only (audio call)',
    chat: 'Text chat (WhatsApp / messenger)',
    sign: 'With a sign language interpreter',
    captioned_video: 'Video call with live captions',
    accessible_venue: 'In person, at a wheelchair-accessible venue'
};
const WORK_MODES = { office: 'Office / on-site', remote: 'Remote / work from home', hybrid: 'Hybrid' };
const JOB_TYPES = {
    'full-time': 'Full time', 'part-time': 'Part time', internship: 'Internship',
    contract: 'Contract', freelance: 'Freelance', remote: 'Remote'
};
const STATUS = {
    applied:     { label: 'Applied',     icon: '●', help: 'Sent. The employer has not looked at it yet.' },
    reviewed:    { label: 'In review',   icon: '◐', help: 'The employer has opened your application.' },
    shortlisted: { label: 'Shortlisted', icon: '★', help: 'Good news. You are on the shortlist.' },
    rejected:    { label: 'Not selected',icon: '✕', help: 'The employer chose other candidates this time.' },
    hired:       { label: 'Hired',       icon: '✓', help: 'Congratulations. You got the job.' }
};

const csv = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const labelList = (v, map) => csv(v).map(k => map[k] || k);
const fmtDate = d => {
    if (!d) return '';
    const dt = new Date(d);
    if (isNaN(dt)) return '';
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
const excerpt = (s, n = 160) => {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s;
};
const daysLeft = d => {
    if (!d) return null;
    const end = new Date(String(d).slice(0, 10) + 'T23:59:59');
    return Math.ceil((end - new Date()) / 86400000);
};
const isClosed = d => { const n = daysLeft(d); return n !== null && n < 0; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

/** Does this job welcome this seeker? (used for the "Suits your profile" hint) */
function jobMatchesSeeker(job, profile) {
    if (!profile || !profile.disability_category || profile.disability_category === 'undisclosed') return null;
    const cats = csv(job.disability_categories || 'all');
    const catOk = cats.includes('all') || cats.includes(profile.disability_category);
    const pctOk = (profile.disability_percent || 0) >= (job.min_disability_percent || 0);
    return catOk && pctOk;
}

module.exports = {
    DISABILITY_CATEGORIES, JOB_DISABILITY_CATEGORIES, ACCESSIBILITY_NEEDS, ASSISTIVE_TECH, TECH_PROVIDED,
    INTERVIEW_MODES, WORK_MODES, JOB_TYPES, STATUS,
    csv, labelList, fmtDate, excerpt, daysLeft, isClosed, plural, jobMatchesSeeker
};
