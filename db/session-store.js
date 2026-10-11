/**
 * express-session store backed by the `sessions` table in Supabase, so users
 * stay logged in across server restarts (Render free tier sleeps often).
 */
const session = require('express-session');
const { supabase } = require('./supabase');

class SupabaseStore extends session.Store {
    constructor(opts = {}) {
        super();
        this.ttl = opts.ttl || 24 * 60 * 60; // seconds
        this.timer = setInterval(() => this.prune(), 60 * 60 * 1000);
        this.timer.unref();
    }
    _expiry(sess) {
        const ms = sess && sess.cookie && sess.cookie.expires
            ? new Date(sess.cookie.expires).getTime()
            : Date.now() + this.ttl * 1000;
        return new Date(ms).toISOString();
    }
    get(sid, cb) {
        supabase.from('sessions').select('sess, expire').eq('sid', sid).maybeSingle()
            .then(({ data, error }) => {
                if (error) return cb(error);
                if (!data) return cb(null, null);
                if (new Date(data.expire).getTime() < Date.now()) return this.destroy(sid, () => cb(null, null));
                cb(null, data.sess);
            }, cb);
    }
    set(sid, sess, cb = () => {}) {
        supabase.from('sessions').upsert({ sid, sess, expire: this._expiry(sess) })
            .then(({ error }) => cb(error || null), cb);
    }
    touch(sid, sess, cb = () => {}) {
        supabase.from('sessions').update({ expire: this._expiry(sess) }).eq('sid', sid)
            .then(({ error }) => cb(error || null), cb);
    }
    destroy(sid, cb = () => {}) {
        supabase.from('sessions').delete().eq('sid', sid)
            .then(({ error }) => cb(error || null), cb);
    }
    prune() {
        supabase.from('sessions').delete().lt('expire', new Date().toISOString())
            .then(() => {}, () => {});
    }
}

module.exports = SupabaseStore;
