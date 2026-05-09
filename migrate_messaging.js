require('dotenv').config();
const db = require('./src/db/database');

async function migrate() {
  try {
    console.log('Migrating database...');
    
    // Messages table
    await db.query(`
      ALTER TABLE messages 
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'sent',
      ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS is_unsended BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS reactions JSONB DEFAULT '[]'::jsonb;
    `);
    console.log('Messages table updated.');

    // Conversations table
    await db.query(`
      ALTER TABLE conversations 
      ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS is_muted BOOLEAN DEFAULT FALSE;
    `);
    console.log('Conversations table updated.');

    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
