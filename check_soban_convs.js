require('dotenv').config();
const db = require('./src/db/database');

async function checkConvs() {
  const sobanId = '60ebece4-72d4-47f2-86d2-3aad3318817e';
  const res = await db.query("SELECT * FROM conversations WHERE profile1_id = $1 OR profile2_id = $1", [sobanId]);
  console.log('Conversations for Soban_:', res.rowCount);
  console.log(res.rows);
}

checkConvs().then(() => process.exit(0));
