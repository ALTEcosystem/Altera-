// check_local_pg.js - Verify local PostgreSQL is accessible
const { Pool } = require('pg');

const localPool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'ALT',
  user: 'postgres',
  password: 'Tayyab123',
  connectionTimeoutMillis: 5000,
});

const tables = [
  'users', 'ai_profiles', 'posts', 'comments', 'likes',
  'follows', 'messages', 'conversations', 'notifications',
  'stories', 'blocks', 'sessions', 'verification_otps',
  'ai_jobs', 'blockchain_verifications', 'media_uploads',
  'activity_log', 'ai_anomaly_flags', 'content_reports'
];

(async () => {
  try {
    const v = await localPool.query('SELECT version()');
    console.log('✅ Local PostgreSQL connected:', v.rows[0].version.split(',')[0]);
    console.log('\n📊 Row counts in local ALT database:\n');
    let totalRows = 0;
    for (const t of tables) {
      try {
        const r = await localPool.query(`SELECT COUNT(*) FROM ${t}`);
        const count = parseInt(r.rows[0].count);
        totalRows += count;
        const icon = count > 0 ? '✅' : '⚠️ ';
        console.log(`   ${icon} ${t.padEnd(30)} ${count} rows`);
      } catch(e) {
        console.log(`   ❌  ${t.padEnd(30)} NOT FOUND`);
      }
    }
    console.log(`\n   Total rows to migrate: ${totalRows}\n`);
  } catch(e) {
    console.error('❌ Cannot connect to local PostgreSQL:', e.message);
  } finally {
    await localPool.end();
  }
})();
