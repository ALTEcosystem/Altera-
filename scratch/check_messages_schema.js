const db = require('../src/db/database');

async function check() {
  try {
    const res = await db.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'messages'");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    process.exit();
  }
}

check();
