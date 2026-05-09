require('dotenv').config();
const db = require('./src/db/database');

async function debugConversations() {
  console.log('--- DEBUG START ---');
  
  // 1. Find all users starting with Soban
  const users = await db.queryMany("SELECT id, username, health_score FROM users WHERE username ILIKE 'Soban%'");
  console.log('Target Users:', users);

  for (const user of users) {
    console.log(`\nChecking conversations for ${user.username} (${user.id}):`);
    const convs = await db.queryMany(
      "SELECT id, profile1_id, profile2_id, profile1_type, profile2_type, is_archived FROM conversations WHERE profile1_id = $1 OR profile2_id = $1",
      [user.id]
    );
    console.log(`Found ${convs.length} conversations.`);
    for (const c of convs) {
      console.log(`- Conv ${c.id}: ${c.profile1_type}:${c.profile1_id} <-> ${c.profile2_type}:${c.profile2_id} (Archived: ${c.is_archived})`);
      const msgCount = await db.queryOne("SELECT COUNT(*) FROM messages WHERE conversation_id = $1", [c.id]);
      console.log(`  - Message count: ${msgCount.count}`);
    }
  }

  console.log('--- DEBUG END ---');
}

debugConversations().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
