// migrate_to_neon.js
// Full data migration from local PostgreSQL (ALT) → NeonDB
// Respects foreign key insertion order to avoid constraint violations

require('dotenv').config();
const { Pool } = require('pg');

// ─── Source: Local PostgreSQL ────────────────────────────────────────────────
const sourcePool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'ALT',
  user: 'postgres',
  password: 'Tayyab123',
  connectionTimeoutMillis: 5000,
});

// ─── Target: NeonDB ───────────────────────────────────────────────────────────
const targetPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

// ─── Migration order respects FK dependencies ────────────────────────────────
// Each entry: { table, columns (optional override), conflictKey }
const MIGRATION_PLAN = [
  { table: 'users' },
  { table: 'ai_profiles' },
  { table: 'follows' },
  { table: 'posts' },
  { table: 'comments' },
  { table: 'likes' },
  { table: 'conversations' },
  { table: 'messages' },
  { table: 'notifications' },
  { table: 'stories' },
  { table: 'blocks' },
  { table: 'sessions' },
  { table: 'verification_otps' },
  { table: 'ai_jobs' },
  { table: 'blockchain_verifications' },
  { table: 'media_uploads' },
  { table: 'activity_log' },
  { table: 'ai_anomaly_flags' },
  { table: 'content_reports' },
];

// ─── Helper: build a batched INSERT with ON CONFLICT DO NOTHING ───────────────
function buildInsertSQL(table, columns, rows) {
  const colList = columns.map(c => `"${c}"`).join(', ');
  const values = rows.map((row, ri) => {
    const placeholders = columns.map((_, ci) => `$${ri * columns.length + ci + 1}`).join(', ');
    return `(${placeholders})`;
  }).join(',\n  ');
  const flatValues = rows.flatMap(row => columns.map(c => row[c]));
  return {
    text: `INSERT INTO "${table}" (${colList}) VALUES\n  ${values}\n  ON CONFLICT DO NOTHING`,
    values: flatValues,
  };
}

// ─── Migrate a single table ───────────────────────────────────────────────────
async function migrateTable(table) {
  // Fetch all rows from source
  let rows;
  try {
    const result = await sourcePool.query(`SELECT * FROM "${table}" ORDER BY created_at ASC NULLS FIRST`);
    rows = result.rows;
  } catch (e) {
    console.log(`   ⚠️  ${table.padEnd(30)} SKIPPED (source error: ${e.message.split('\n')[0]})`);
    return 0;
  }

  if (rows.length === 0) {
    console.log(`   ➖  ${table.padEnd(30)} 0 rows (empty)`);
    return 0;
  }

  const columns = Object.keys(rows[0]);
  const BATCH = 50; // Insert 50 rows at a time to stay within PG parameter limits
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    try {
      const { text, values } = buildInsertSQL(table, columns, batch);
      const result = await targetPool.query(text, values);
      inserted += result.rowCount;
    } catch (e) {
      console.error(`   ❌  ${table} batch ${Math.floor(i/BATCH)+1} ERROR:`, e.message.split('\n')[0]);
    }
  }

  const icon = inserted === rows.length ? '✅' : inserted > 0 ? '⚠️ ' : '❌ ';
  console.log(`   ${icon} ${table.padEnd(30)} ${inserted}/${rows.length} rows migrated`);
  return inserted;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  ALTERA — Local PostgreSQL → NeonDB Data Migration');
  console.log('═══════════════════════════════════════════════════════\n');

  // Verify both connections
  try {
    await sourcePool.query('SELECT 1');
    console.log('✅ Source (local PostgreSQL ALT) connected');
  } catch(e) {
    console.error('❌ Cannot connect to source DB:', e.message);
    process.exit(1);
  }

  try {
    await targetPool.query('SELECT 1');
    console.log('✅ Target (NeonDB) connected');
  } catch(e) {
    console.error('❌ Cannot connect to NeonDB:', e.message);
    process.exit(1);
  }

  // Disable FK checks during migration by deferring constraints
  // NeonDB supports DEFERRABLE constraints — we use a transaction with SET CONSTRAINTS ALL DEFERRED
  console.log('\n🔄 Starting migration...\n');

  // Disable triggers on target temporarily to avoid trigger errors on insert
  const targetClient = await targetPool.connect();
  try {
    await targetClient.query('BEGIN');
    await targetClient.query('SET CONSTRAINTS ALL DEFERRED');

    for (const { table } of MIGRATION_PLAN) {
      // Fetch rows from source
      let rows;
      try {
        const result = await sourcePool.query(
          `SELECT * FROM "${table}" ORDER BY created_at ASC NULLS FIRST`
        );
        rows = result.rows;
      } catch (e) {
        console.log(`   ⚠️  ${table.padEnd(30)} SKIPPED (${e.message.split('\n')[0]})`);
        continue;
      }

      if (rows.length === 0) {
        console.log(`   ➖  ${table.padEnd(30)} 0 rows (empty)`);
        continue;
      }

      const columns = Object.keys(rows[0]);
      const BATCH = 50;
      let inserted = 0;

      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        try {
          const { text, values } = buildInsertSQL(table, columns, batch);
          const result = await targetClient.query(text, values);
          inserted += result.rowCount;
        } catch (e) {
          console.error(`   ❌  ${table} batch error:`, e.message.split('\n')[0]);
        }
      }

      const icon = inserted === rows.length ? '✅' : inserted > 0 ? '⚠️ ' : '❌ ';
      console.log(`   ${icon} ${table.padEnd(30)} ${inserted}/${rows.length} rows`);
    }

    await targetClient.query('COMMIT');
    console.log('\n✅ Transaction committed successfully!\n');
  } catch(e) {
    await targetClient.query('ROLLBACK');
    console.error('\n❌ Migration failed, rolled back:', e.message);
  } finally {
    targetClient.release();
  }

  // ─── Final verification ──────────────────────────────────────────────────
  console.log('📊 Final NeonDB row counts:\n');
  let total = 0;
  for (const { table } of MIGRATION_PLAN) {
    try {
      const r = await targetPool.query(`SELECT COUNT(*) FROM "${table}"`);
      const count = parseInt(r.rows[0].count);
      total += count;
      if (count > 0) console.log(`   ✅ ${table.padEnd(30)} ${count} rows`);
    } catch(e) {}
  }
  console.log(`\n   🎉 Total rows in NeonDB: ${total}`);
  console.log('\n═══════════════════════════════════════════════════════\n');

  await sourcePool.end();
  await targetPool.end();
})();
