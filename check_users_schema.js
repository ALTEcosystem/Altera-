const db = require('./src/db/database');
require('dotenv').config();

async function check() {
  try {
    await db.initialize();
    const res = await db.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users'");
    console.log('--- USERS TABLE ---');
    console.log(JSON.stringify(res.rows, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
