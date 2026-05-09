const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    await client.connect();
    console.log('Connected to DB. Fixing message conversation IDs...');

    // 1. Get all messages
    const res = await client.query('SELECT * FROM messages');
    console.log(`Processing ${res.rowCount} messages...`);

    for (const m of res.rows) {
      try {
        // If sender_profile_id is missing, default to sender_id (human)
        const sId = m.sender_profile_id || m.sender_id;
        const sType = m.sender_type || 'human';
        const rId = m.recipient_profile_id || m.recipient_id;
        const rType = m.recipient_type || 'human';

        if (!sId || !rId) {
            console.log(`Skipping message ${m.id} - missing participants`);
            continue;
        }

        const participants = [
          `${sType}:${sId}`,
          `${rType}:${rId}`
        ].sort();
        const newConvId = participants.join('|');

        if (m.conversation_id !== newConvId) {
          await client.query('UPDATE messages SET conversation_id = $1 WHERE id = $2', [newConvId, m.id]);
          console.log(`Updated message ${m.id}: ${m.conversation_id} -> ${newConvId}`);
        }
      } catch (e) {
        console.error(`Error processing message ${m.id}:`, e.message);
      }
    }

    // 2. Sync conversations table
    console.log('Syncing conversations table...');
    const convRes = await client.query('SELECT DISTINCT ON (conversation_id) * FROM messages ORDER BY conversation_id, created_at DESC');
    
    for (const m of convRes.rows) {
        const participants = m.conversation_id.split('|');
        if (participants.length !== 2) continue;

        const p1 = participants[0].split(':');
        const p2 = participants[1].split(':');

        await client.query(
          `INSERT INTO conversations 
           (id, user1_id, user2_id, profile1_id, profile1_type, profile2_id, profile2_type, last_message_at) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
           ON CONFLICT (id) DO UPDATE SET 
             last_message_at = EXCLUDED.last_message_at,
             is_archived = FALSE`,
          [m.conversation_id, m.sender_id, m.recipient_id, p1[1], p1[0], p2[1], p2[0], m.created_at]
        );
    }

    console.log('Done.');
  } catch (err) {
    console.error('Failed:', err);
  } finally {
    await client.end();
  }
}

run();
