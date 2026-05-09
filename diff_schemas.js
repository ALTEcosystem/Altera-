// diff_schemas.js — Compare column schemas between local PG and NeonDB
require('dotenv').config();
const { Pool } = require('pg');

const sourcePool = new Pool({
  host: 'localhost', port: 5432, database: 'ALT',
  user: 'postgres', password: 'Tayyab123', connectionTimeoutMillis: 5000,
});
const targetPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000,
});

const TABLES = [
  'users','ai_profiles','follows','posts','comments','likes',
  'conversations','messages','notifications','stories','blocks',
  'sessions','verification_otps','ai_jobs','blockchain_verifications',
  'media_uploads','activity_log','ai_anomaly_flags','content_reports'
];

const getColumns = async (pool, table) => {
  try {
    const r = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`, [table]
    );
    return r.rows;
  } catch(e) { return null; }
};

(async () => {
  console.log('\n🔍 Schema diff: Local ALT vs NeonDB\n');
  let hasDiff = false;

  for (const table of TABLES) {
    const srcCols = await getColumns(sourcePool, table);
    const tgtCols = await getColumns(targetPool, table);
    if (!srcCols) { console.log(`⚠️  ${table}: not found in source`); continue; }
    if (!tgtCols) { console.log(`⚠️  ${table}: not found in target`); continue; }

    const srcNames = new Set(srcCols.map(c => c.column_name));
    const tgtNames = new Set(tgtCols.map(c => c.column_name));

    const onlyInSrc = srcCols.filter(c => !tgtNames.has(c.column_name));
    const onlyInTgt = tgtCols.filter(c => !srcNames.has(c.column_name));

    if (onlyInSrc.length || onlyInTgt.length) {
      hasDiff = true;
      console.log(`\n📋 TABLE: ${table}`);
      onlyInSrc.forEach(c =>
        console.log(`   ➕ MISSING IN NEON: ${c.column_name} (${c.data_type}, nullable:${c.is_nullable}, default:${c.column_default})`)
      );
      onlyInTgt.forEach(c =>
        console.log(`   ➖ EXTRA IN NEON:   ${c.column_name} (${c.data_type})`)
      );
    }
  }

  if (!hasDiff) console.log('✅ No column differences found!\n');
  else console.log('\n');

  await sourcePool.end();
  await targetPool.end();
})();
