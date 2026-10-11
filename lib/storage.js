/**
 * Resume storage.
 *   STORAGE_DRIVER=supabase (default) -> private Supabase Storage bucket "resumes"
 *   STORAGE_DRIVER=local              -> files on local disk (dev only; Render disks are wiped on redeploy)
 * Files are NEVER served statically. They are downloaded through
 * GET /files/resume/:userId, which checks who is asking.
 */
const fs = require('fs');
const path = require('path');
const { supabase } = require('../db/supabase');

const BUCKET = 'resumes';
const driver = () => (process.env.STORAGE_DRIVER || 'supabase').toLowerCase();
const LOCAL_DIR = path.join(__dirname, '..', 'uploads', 'resumes');

async function init() {
    if (driver() === 'local') { fs.mkdirSync(LOCAL_DIR, { recursive: true }); return; }
    try {
        const { data } = await supabase.storage.getBucket(BUCKET);
        if (!data) {
            const { error } = await supabase.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 5 * 1024 * 1024 });
            if (error) console.warn('[storage] could not create bucket:', error.message);
        }
    } catch (e) {
        console.warn('[storage] bucket check failed:', e.message);
    }
}

const safeName = n => path.basename(n).replace(/[^\w.\-]+/g, '_').slice(0, 80);

/** Save an uploaded file (multer memory storage). Returns the value to store in profiles.resume_path */
async function saveResume(userId, file) {
    const key = `${userId}/${Date.now()}_${safeName(file.originalname)}`;
    if (driver() === 'local') {
        const full = path.join(LOCAL_DIR, key.replace('/', '_'));
        await fs.promises.writeFile(full, file.buffer);
        return `local:${key.replace('/', '_')}`;
    }
    const { error } = await supabase.storage.from(BUCKET).upload(key, file.buffer, {
        contentType: file.mimetype, upsert: false
    });
    if (error) throw error;
    return `sb:${key}`;
}

async function removeResume(stored) {
    try {
        if (!stored) return;
        if (stored.startsWith('sb:')) await supabase.storage.from(BUCKET).remove([stored.slice(3)]);
        else if (stored.startsWith('local:')) await fs.promises.unlink(path.join(LOCAL_DIR, path.basename(stored.slice(6))));
    } catch (_) { /* best effort */ }
}

/**
 * Send a stored resume to the browser.
 * Returns false when the file is missing.
 */
async function sendResume(stored, res) {
    if (!stored) return false;
    if (stored.startsWith('sb:')) {
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(stored.slice(3), 60, { download: true });
        if (error || !data) return false;
        res.redirect(data.signedUrl);
        return true;
    }
    // local files, plus legacy "/uploads/resumes/x" values from the old version
    const name = path.basename(stored.startsWith('local:') ? stored.slice(6) : stored);
    const full = path.join(LOCAL_DIR, name);
    if (!fs.existsSync(full)) return false;
    res.download(full, name.replace(/^\d+_\d+_/, ''));
    return true;
}

module.exports = { init, saveResume, removeResume, sendResume };
