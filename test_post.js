require('dotenv').config();
const db = require('./src/db/database');
const { v4: uuidv4 } = require('uuid');

async function testPost() {
  await db.initialize();
  const user = await db.queryOne('SELECT id FROM users LIMIT 1');
  if (!user) {
    console.log("No user found");
    return process.exit(1);
  }

  try {
    const result = await db.queryOne(
      `INSERT INTO posts (id, user_id, ai_profile_id, content, media_urls, ai_generated, status, scheduled_at, hashtags) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [uuidv4(), user.id, null, 'Test post #AIT #Web3Social', [], false, 'published', null, ['ait', 'web3social']]
    );
    console.log("Post created:", result);
  } catch (err) {
    console.error("Error creating post:", err);
  }
  process.exit(0);
}

testPost();
