/** Small server-side validation helpers. Errors are { fieldName: message }. */
const clean = (v, max = 2000) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max);
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const isHttpUrl = v => { try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; } };
const isPhone = v => /^[+\d][\d\s\-()]{6,18}$/.test(v);
const asList = (body, key, allowed) => [].concat(body[key] || body[key + '[]'] || [])
    .map(String).filter(v => !allowed || Object.prototype.hasOwnProperty.call(allowed, v)).join(',');
const toInt = (v, min, max, dflt = 0) => {
    const n = parseInt(v, 10);
    if (isNaN(n)) return dflt;
    return Math.min(max, Math.max(min, n));
};
/** Escape a user string for use inside a PostgREST .or(...) / ilike filter. */
const filterSafe = v => String(v).replace(/[,()%*\\:"']/g, ' ').trim().slice(0, 80);

module.exports = { clean, isEmail, isHttpUrl, isPhone, asList, toInt, filterSafe };
