require('dotenv').config();
const db = require('./src/db/database');

async function migrate() {
  try {
    await db.query(`ALTER TABLE ai_profiles ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'general';`);
    console.log('Done');
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

migrate();