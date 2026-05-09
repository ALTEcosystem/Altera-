require('dotenv').config();
const db = require('./src/db/database');

async function fixMissingConversations() {
  try {
    await db.initialize();
    
    console.log('Fetching unique conversation IDs from messages...');
    const messages = await db.queryMany('SELECT DISTINCT conversation_id FROM messages');
    
    console.log(`Found ${messages.length} unique conversations in messages.`);
    
    for (const m of messages) {
      const convId = m.conversation_id;
      if (!convId) continue;
      
      const exists = await db.queryOne('SELECT id FROM conversations WHERE id = $1', [convId]);
      if (!exists) {
        console.log(`Creating missing conversation: ${convId}`);
        // Extract parts
        const parts = convId.split('|');
        if (parts.length === 2) {
          const p1 = parts[0].split(':');
          const p2 = parts[1].split(':');
          
          // Get the message to find real IDs
          const firstMsg = await db.queryOne(
            'SELECT sender_id, recipient_id, sender_profile_id, recipient_profile_id FROM messages WHERE conversation_id = $1 LIMIT 1',
            [convId]
          );
          
          if (firstMsg) {
            try {
              await db.query(
                `INSERT INTO conversations 
                 (id, user1_id, user2_id, profile1_id, profile2_id, updated_at) 
                 VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP) 
                 ON CONFLICT DO NOTHING`,
                [
                  convId, 
                  firstMsg.sender_id, 
                  firstMsg.recipient_id, 
                  firstMsg.sender_profile_id, 
                  firstMsg.recipient_profile_id
                ]
              );
            } catch (e) {
              console.error(`Failed to insert ${convId}: ${e.message}`);
            }
          }
        }
      }
    }
    
    console.log('Fix complete.');
    process.exit(0);
  } catch (err) {
    console.error('Error fixing conversations:', err);
    process.exit(1);
  }
}

fixMissingConversations();
