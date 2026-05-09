require('dotenv').config();
const { pool } = require('./src/db/database');

async function migrate() {
  try {
    console.log('[DB] Running migration: Adding ai_profile_id to posts...');
    await pool.query('ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_profile_id UUID REFERENCES ai_profiles(id) ON DELETE SET NULL');
    console.log('[DB] Migration successful!');
    process.exit(0);
  } catch (err) {
    console.error('[DB ERROR] Migration failed:', err);
    process.exit(1);
  }
}

migrate();
