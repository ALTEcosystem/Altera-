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
    console.log('Connected to DB. Starting sync...');

    const res = await client.query('SELECT DISTINCT ON (conversation_id) * FROM messages ORDER BY conversation_id, created_at DESC');
    console.log(`Found ${res.rowCount} unique conversations in messages.`);

    for (const m of res.rows) {
      try {
        const participants = m.conversation_id.split('|');
        if (participants.length !== 2) continue;

        const p1 = participants[0].split(':');
        const p2 = participants[1].split(':');

        // Note: The logic for user1_id / user2_id should match how they are assigned in realtime.js
        // But for display purposes in inbox, as long as both are present it usually works.
        // In realtime.js: 
        // const user1Id = socket.userId < (receiverInfo.user_id || receiverInfo.id) ? socket.userId : (receiverInfo.user_id || receiverInfo.id);
        
        // Let's just use the sender and recipient IDs from the message
        const u1 = m.sender_id;
        const u2 = m.recipient_id;

        await client.query(
          `INSERT INTO conversations 
           (id, user1_id, user2_id, profile1_id, profile1_type, profile2_id, profile2_type, last_message_id, last_message_at) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
           ON CONFLICT (id) DO UPDATE SET 
             last_message_id = EXCLUDED.last_message_id,
             last_message_at = EXCLUDED.last_message_at`,
          [m.conversation_id, u1, u2, p1[1], p1[0], p2[1], p2[0], m.id, m.created_at]
        );
      } catch (e) {
        console.error(`Error syncing conversation ${m.conversation_id}:`, e.message);
      }
    }

    console.log('Sync complete.');
  } catch (err) {
    console.error('Sync failed:', err);
  } finally {
    await client.end();
  }
}

run();
