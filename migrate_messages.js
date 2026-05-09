const db = require('./src/db/database');
require('dotenv').config();

async function migrate() {
  try {
    console.log('Migrating messages table...');
    await db.query(`
      ALTER TABLE messages 
      ADD COLUMN IF NOT EXISTS is_forwarded BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS deleted_by UUID[] DEFAULT '{}'
    `);
    console.log('Migration successful.');
  } catch (e) {
    console.error('Migration failed:', e);
  } finally {
    process.exit();
  }
}

migrate();
