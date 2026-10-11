/**
 * Keeps free hosting awake.
 *  - Render free web services sleep after ~15 minutes without incoming traffic.
 *    The server pings its own public address every 10 minutes (it goes through Render's public proxy,
 *    so it counts as traffic).  /healthz?db=1 also touches Supabase, so the free Supabase project
 *    never looks inactive (it pauses after about a week of no activity).
 *  - Render sets RENDER_EXTERNAL_URL automatically. Elsewhere set KEEP_ALIVE_URL=https://your-site.
 *  - Turn it off with KEEP_ALIVE=off.
 * A sleeping service cannot wake itself, so also add a free external pinger once (see README).
 */
function start() {
    const base = process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL;
    if (!base || String(process.env.KEEP_ALIVE).toLowerCase() === 'off') return null;
    const target = base.replace(/\/$/, '') + '/healthz?db=1';
    const every = Math.max(60, parseInt(process.env.KEEP_ALIVE_SECONDS, 10) || 600) * 1000;
    const ping = () => fetch(target, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'visionconnect-keepalive' } })
        .then(r => { if (!r.ok) console.warn('[keepalive] ping status', r.status); })
        .catch(e => console.warn('[keepalive] ping failed:', e.message));
    const t = setInterval(ping, every);
    t.unref();
    console.log(`[keepalive] pinging ${target} every ${every / 60000} min`);
    return t;
}
module.exports = { start };
