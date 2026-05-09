require('dotenv').config();
const db = require('./src/db/database');

async function checkUsers() {
  try {
    const users = await db.query("SELECT id, username FROM users");
    console.log('Total Users:', users.rowCount);
    console.log('Users:', users.rows);
    
    const ais = await db.query("SELECT id, username FROM ai_profiles");
    console.log('Total AIs:', ais.rowCount);
    console.log('AIs:', ais.rows);
  } catch (e) {
    console.error('DB Check Failed:', e);
  }
}

checkUsers().then(() => process.exit(0));
