/**
 * Email sending over plain HTTPS APIs (no extra npm packages).
 *   MAIL_PROVIDER=brevo  + BREVO_API_KEY   (free: 300 emails/day, you can verify a single sender address, no domain needed)
 *   MAIL_PROVIDER=resend + RESEND_API_KEY  (free tier, needs a verified domain to email other people)
 *   MAIL_FROM="VisionConnect <you@example.com>"   (must be a verified sender at your provider)
 * If nothing is configured, emails are NOT sent. In development they are kept in `outbox` and printed in the console.
 */
const outbox = [];
const provider = () => (process.env.MAIL_PROVIDER || (process.env.BREVO_API_KEY ? 'brevo' : process.env.RESEND_API_KEY ? 'resend' : '')).toLowerCase();
const configured = () => !!provider() && !!process.env.MAIL_FROM;

function parseFrom(from) {
    const m = String(from).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
    return m ? { name: m[1].replace(/^"|"$/g, '') || 'VisionConnect Jobs', email: m[2] } : { name: 'VisionConnect Jobs', email: String(from).trim() };
}

/** Best-effort: never throws. Resolves true if the provider accepted the email. */
async function send({ to, subject, text }) {
    try {
        if (!configured()) {
            if (process.env.NODE_ENV !== 'production') {
                outbox.push({ to, subject, text });
                if (outbox.length > 50) outbox.shift();
                if (!process.env.MAIL_QUIET) console.log(`[mail:dev] to=${to} subject="${subject}"\n${text}\n`);
            }
            return false;
        }
        const from = parseFrom(process.env.MAIL_FROM);
        const signal = AbortSignal.timeout(15000);
        let res;
        if (provider() === 'brevo') {
            res = await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST', signal,
                headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
                body: JSON.stringify({ sender: from, to: [{ email: to }], subject, textContent: text })
            });
        } else {
            res = await fetch('https://api.resend.com/emails', {
                method: 'POST', signal,
                headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
                body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text })
            });
        }
        if (!res.ok) console.error('[mail] provider error', res.status, (await res.text()).slice(0, 200));
        return res.ok;
    } catch (e) {
        console.error('[mail] failed:', e.message);
        return false;
    }
}

const baseUrl = req => (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

module.exports = { send, configured, outbox, baseUrl };
