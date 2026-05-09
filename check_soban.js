require('dotenv').config();
const db = require('./src/db/database');

async function checkSoban() {
  const res = await db.query("SELECT id, username, health_score FROM users WHERE username = 'Soban_'");
  console.log('Soban_ Data:', res.rows[0]);
  
  const reports = await db.query("SELECT COUNT(*) FROM content_reports WHERE reported_profile_id = $1", [res.rows[0]?.id]);
  console.log('Total Reports:', reports.rows[0].count);
}

checkSoban().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
