require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./src/db/database');

async function runMigration() {
  console.log('🔄 Running ALTERA DB Migration v2 (Modules 13-16)...\n');
  try {
    await db.initialize();
    const sql = fs.readFileSync(path.join(__dirname, 'src/db/migration_v2.sql'), 'utf8');
    
    // Strip comments, then split
    const cleanSql = sql.replace(/--.*$/gm, '');
    const statements = cleanSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const stmt of statements) {
      try {
        await db.query(stmt);
        const preview = stmt.slice(0, 70).replace(/\s+/g, ' ');
        console.log(`  ✅ ${preview}...`);
      } catch (err) {
        if (err.code === '42701' || err.message.includes('already exists')) {
          console.log(`  ⏭  Skipped (already exists): ${stmt.slice(0, 60)}...`);
        } else {
          console.error(`  ❌ Failed: ${stmt.slice(0, 60)}...\n     ${err.message}`);
        }
      }
    }

    console.log('\n✅ Migration v2 complete!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  }
}

runMigration();
