require('dotenv').config();
const db = require('./src/db/database');

async function fixReactions() {
  console.log('--- FIX START ---');
  // 1. Update any empty objects to empty arrays
  const res = await db.query("UPDATE messages SET reactions = '[]' WHERE reactions::text = '{}'");
  console.log(`Updated ${res.rowCount} messages with empty object reactions.`);

  // 2. Double check if any are still not arrays
  const suspicious = await db.query("SELECT id, reactions FROM messages WHERE jsonb_typeof(reactions) != 'array'");
  console.log(`Found ${suspicious.rowCount} messages with non-array reactions:`);
  for (const row of suspicious.rows) {
      console.log(`- Msg ${row.id}: ${JSON.stringify(row.reactions)} (Type: ${typeof row.reactions})`);
      // Force it to be an array if it's a map (common in some JS/PG drivers)
      const forced = [];
      await db.query("UPDATE messages SET reactions = $1 WHERE id = $2", [JSON.stringify(forced), row.id]);
  }
  console.log('--- FIX END ---');
}

fixReactions().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
