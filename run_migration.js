// run_migration.js
require('dotenv').config();
const db = require('./src/db/database');
const fs = require('fs');
const path = require('path');

async function run() {
  try {
    console.log('Starting migration...');
    const migrationPath = path.join(__dirname, 'src/db/migration_v2.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    await db.initialize();
    await db.query(sql);
    
    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

run();
