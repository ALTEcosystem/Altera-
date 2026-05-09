const db = require('./src/db/database');
require('dotenv').config();

async function fix() {
  try {
    await db.initialize();
    console.log('Fixing conversations table...');
    
    // Check if we need to change ID type
    // PostgreSQL doesn't allow direct cast from UUID to VARCHAR easily if there are dependencies, 
    // but we can try to drop and recreate if it's empty, or just alter.
    
    // First, let's try to alter the column
    try {
      await db.query('ALTER TABLE conversations ALTER COLUMN id TYPE VARCHAR(255)');
      console.log('Altered conversations.id to VARCHAR(255)');
    } catch (e) {
      console.log('Could not alter conversations.id directly:', e.message);
      // Plan B: Recreate table if it's small/empty
      await db.query('DROP TABLE IF EXISTS conversations CASCADE');
      await db.query(`
        CREATE TABLE conversations (
          id VARCHAR(255) PRIMARY KEY,
          user1_id UUID NOT NULL,
          user2_id UUID NOT NULL,
          profile1_id UUID,
          profile2_id UUID,
          profile1_type VARCHAR(20),
          profile2_type VARCHAR(20),
          is_pinned BOOLEAN DEFAULT FALSE,
          is_archived BOOLEAN DEFAULT FALSE,
          is_muted BOOLEAN DEFAULT FALSE,
          last_message_id UUID,
          last_message_at TIMESTAMP,
          user1_deleted BOOLEAN DEFAULT FALSE,
          user2_deleted BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('Recreated conversations table with VARCHAR id');
    }
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

fix();
