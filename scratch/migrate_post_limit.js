const { Client } = require('pg');
require('dotenv').config();

async function migrate() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    await client.connect();
    console.log('Connected to database.');

    // 1. Drop the old constraint
    console.log('Dropping old constraint...');
    await client.query('ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_content_check');

    // 2. Add the new constraint (2000 chars should be plenty for now, but let's go with 5000)
    console.log('Adding new constraint (5000 chars)...');
    await client.query('ALTER TABLE posts ADD CONSTRAINT posts_content_check CHECK (LENGTH(content) <= 5000)');

    // 3. Do the same for comments if needed (currently 280)
    // await client.query('ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_content_check');
    // await client.query('ALTER TABLE comments ADD CONSTRAINT comments_content_check CHECK (LENGTH(content) <= 500)');

    console.log('Migration successful!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}

migrate();
