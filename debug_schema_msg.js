require('dotenv').config();
const db = require('./src/db/database');

async function debugSchema() {
  console.log('--- SCHEMA MESSAGES ---');
  const res = await db.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'messages'");
  console.log(res.rows);
  
  const sample = await db.query("SELECT * FROM messages LIMIT 1");
  console.log('Sample Row:', sample.rows[0]);
  console.log('--- END ---');
}

debugSchema().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
