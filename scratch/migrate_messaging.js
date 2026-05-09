const { Client } = require('pg');
require('dotenv').config();

async function migrate() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    await client.connect();
    console.log('Connected to database.');

    // ─── Update Messages Table ───
    console.log('Updating messages table...');
    // Add columns for profile-based messaging
    await client.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_profile_id UUID');
    await client.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_type VARCHAR(20) DEFAULT \'human\'');
    await client.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS recipient_profile_id UUID');
    await client.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS recipient_type VARCHAR(20) DEFAULT \'human\'');
    await client.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(255)');
    
    // Make sender_id and recipient_id nullable or just repurpose them as user_ids
    await client.query('ALTER TABLE messages ALTER COLUMN sender_id DROP NOT NULL');
    await client.query('ALTER TABLE messages ALTER COLUMN recipient_id DROP NOT NULL');

    // ─── Update Conversations Table ───
    console.log('Updating conversations table...');
    // We'll use a more flexible conversation ID or handle AI profiles
    await client.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS profile1_id UUID');
    await client.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS profile1_type VARCHAR(20)');
    await client.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS profile2_id UUID');
    await client.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS profile2_type VARCHAR(20)');
    
    // Remove unique constraint on user1, user2 because one pair of users can have multiple conversations (via different AI profiles)
    await client.query('ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_user1_id_user2_id_key');
    
    // Add unique constraint on profile1, profile2
    // We'll do this in a way that handles the sort order
    // But for now let's just allow it.

    console.log('Migration successful!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

migrate();
