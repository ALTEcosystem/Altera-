require('dotenv').config();
const db = require('./src/db/database');

(async () => {
  try {
    await db.initialize();
    
    // Simulate a post creation
    const userId = '3f0e08c4-1234-4567-8901-234567890123'; // Mock user ID or find one
    const user = await db.queryOne('SELECT id FROM users LIMIT 1');
    if (!user) {
      console.log('No users found to test with');
      process.exit(0);
    }
    
    const pid = user.id;
    const postId = 'test-post-' + Date.now();
    
    console.log('Inserting test post for user:', pid);
    await db.query(
      `INSERT INTO posts (id, user_id, content, status) VALUES ($1, $2, $3, $4)`,
      [postId, pid, 'Test post at ' + new Date().toISOString(), 'published']
    );
    
    // Now try to fetch it via the same logic as feed.js
    const query = `
      SELECT p.* FROM posts p
      WHERE p.id = $1 AND p.deleted_at IS NULL AND p.status = 'published'
    `;
    const res = await db.queryOne(query, [postId]);
    
    if (res) {
      console.log('✅ Post found in query!');
    } else {
      console.log('❌ Post NOT found in query!');
    }
    
    // Clean up
    await db.query('DELETE FROM posts WHERE id = $1', [postId]);
    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
})();
