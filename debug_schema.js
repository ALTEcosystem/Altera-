require('dotenv').config();
const db = require('./src/db/database');

async function debugSchema() {
  console.log('--- SCHEMA START ---');
  const res = await db.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'conversations'");
  console.log(res.rows);
  
  const sample = await db.query("SELECT * FROM conversations LIMIT 1");
  console.log('Sample Row:', sample.rows[0]);
  console.log('--- SCHEMA END ---');
}

debugSchema().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
