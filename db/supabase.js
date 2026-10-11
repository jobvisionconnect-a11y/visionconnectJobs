/**
 * Supabase data access.
 *
 * The server uses the SERVICE ROLE key only (it never leaves the server).
 * Row Level Security is locked for public roles in db/schema.sql, so the
 * public anon key cannot read or write anything.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
    console.error('\n[VisionConnect] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example).\n');
    if (process.env.NODE_ENV === 'production') process.exit(1);
}

const supabase = createClient(url || 'http://127.0.0.1:54321', key || 'missing-key', {
    auth: { persistSession: false, autoRefreshToken: false }
});

async function queryAll(table, match = {}, select = '*') {
    const { data, error } = await supabase.from(table).select(select).match(match);
    if (error) throw error;
    return data || [];
}

async function queryOne(table, match = {}, select = '*') {
    const { data, error } = await supabase.from(table).select(select).match(match).limit(1).maybeSingle();
    if (error) throw error;
    return data;
}

/** insert | update | delete. Returns { data, lastInsertRowid, changes } */
async function runStmt(method, table, payload = {}, match = {}) {
    let q = supabase.from(table);
    if (method === 'insert') q = q.insert(payload).select();
    else if (method === 'update') q = q.update(payload).match(match).select();
    else if (method === 'delete') q = q.delete().match(match).select();
    else throw new Error(`Unknown method ${method}`);
    const { data, error } = await q;
    if (error) throw error;
    return {
        data,
        lastInsertRowid: data && data.length ? data[0].id : null,
        changes: data ? data.length : 0
    };
}

/** Throw if a supabase result has an error, otherwise return its data. */
function unwrap({ data, error }) {
    if (error) throw error;
    return data;
}

module.exports = { supabase, queryAll, queryOne, runStmt, unwrap };
