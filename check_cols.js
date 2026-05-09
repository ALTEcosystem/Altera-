require('dotenv').config();
const db = require('./src/db/database');
(async () => {
  try {
    await db.initialize();
    const res = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'posts'");
    console.log('Columns in posts:', res.rows.map(r => r.column_name));
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
})();
