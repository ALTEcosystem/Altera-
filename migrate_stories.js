require('dotenv').config();
const db = require('./src/db/database');

async function migrate() {
  await db.initialize();
  console.log('Creating story_views table...');
  await db.query(`
    CREATE TABLE IF NOT EXISTS story_views (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(story_id, user_id)
    );
  `);
  console.log('Done!');
  await db.close();
}

migrate();
