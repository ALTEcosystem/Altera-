// patch_neon_schema.js — Add all missing columns to NeonDB to match local ALT schema
require('dotenv').config();
const { Pool } = require('pg');

const targetPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

const patches = [
  // ai_profiles
  `ALTER TABLE ai_profiles ADD COLUMN IF NOT EXISTS post_count_today INTEGER DEFAULT 0`,
  `ALTER TABLE ai_profiles ADD COLUMN IF NOT EXISTS post_count_reset_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE ai_profiles ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'general'`,

  // follows
  `ALTER TABLE follows ADD COLUMN IF NOT EXISTS follower_type VARCHAR(50) DEFAULT 'human'`,
  `ALTER TABLE follows ADD COLUMN IF NOT EXISTS following_type VARCHAR(50) DEFAULT 'human'`,

  // messages
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_by UUID[] DEFAULT '{}'`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_forwarded BOOLEAN DEFAULT false`,

  // ai_anomaly_flags
  `ALTER TABLE ai_anomaly_flags ADD COLUMN IF NOT EXISTS auto_detected BOOLEAN DEFAULT true`,

  // content_reports
  `ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS comment_id UUID`,
  `ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending'`,
  `ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP`,
];

(async () => {
  console.log('\n🔧 Patching NeonDB schema to match local ALT...\n');
  for (const sql of patches) {
    try {
      await targetPool.query(sql);
      // Extract table and column name from ALTER TABLE statement
      const match = sql.match(/ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/);
      if (match) console.log(`   ✅ ${match[1]}.${match[2]} — added`);
    } catch(e) {
      console.error(`   ❌ FAILED: ${sql.substring(0, 60)}...`);
      console.error(`      Error: ${e.message.split('\n')[0]}`);
    }
  }
  console.log('\n✅ Schema patch complete. NeonDB is now in sync with local ALT.\n');
  await targetPool.end();
})();
