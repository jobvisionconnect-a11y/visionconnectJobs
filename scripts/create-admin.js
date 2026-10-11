#!/usr/bin/env node
/**
 * Create (or promote) an admin account.
 *   node scripts/create-admin.js you@example.com "Your Name" "a-strong-password"
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { queryOne, runStmt } = require('../db/supabase');

(async () => {
    const [email, name, password] = process.argv.slice(2);
    if (!email || !name || !password || password.length < 8) {
        console.error('Usage: node scripts/create-admin.js <email> "<name>" "<password (8+ chars)>"');
        process.exit(1);
    }
    const hash = bcrypt.hashSync(password, 10);
    const existing = await queryOne('users', { email: email.toLowerCase() }, 'id');
    if (existing) {
        await runStmt('update', 'users', { role: 'admin', password_hash: hash, name, is_approved: true }, { id: existing.id });
        console.log(`Updated ${email} -> admin`);
    } else {
        await runStmt('insert', 'users', { email: email.toLowerCase(), name, role: 'admin', password_hash: hash });
        console.log(`Created admin ${email}`);
    }
    process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
