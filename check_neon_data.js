require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const tables = [
  'users', 'ai_profiles', 'posts', 'comments', 'likes',
  'follows', 'messages', 'conversations', 'notifications',
  'stories', 'blocks', 'sessions', 'verification_otps'
];

(async () => {
  console.log('\n📊 NeonDB Row Counts:\n');
  for (const t of tables) {
    try {
      const r = await pool.query(`SELECT COUNT(*) FROM ${t}`);
      const count = parseInt(r.rows[0].count);
      const icon = count > 0 ? '✅' : '⚠️ ';
      console.log(`   ${icon} ${t.padEnd(25)} ${count} rows`);
    } catch(e) {
      console.log(`   ❌  ${t.padEnd(25)} ERROR: ${e.message}`);
    }
  }
  console.log('');
  await pool.end();
})();
