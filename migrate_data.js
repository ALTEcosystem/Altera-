require('dotenv').config();
const db = require('./src/db/database');
const { users, humanProfiles, aiProfiles, posts } = require('./src/db/mockStore');

async function migrate() {
  console.log('🚀 Starting data migration from mockStore to PostgreSQL...');
  
  try {
    await db.initialize();
    
    // 1. Migrate Users & Human Profiles
    console.log('👤 Migrating users...');
    for (const u of users) {
      const hp = humanProfiles.find(p => p.user_id === u.id);
      
      const existing = await db.queryOne('SELECT id FROM users WHERE email = $1', [u.email]);
      if (!existing) {
        await db.query(
          `INSERT INTO users (id, email, username, full_name, password_hash, bio, avatar_url, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [u.id, u.email, hp?.username || u.username || 'user', hp?.display_name || u.full_name || 'User', u.password_hash, hp?.bio, hp?.avatar, u.created_at]
        );
        console.log(`   + Created user: ${u.email}`);
      } else {
        // Update existing if needed
        await db.query(
          `UPDATE users SET username = $1, full_name = $2, bio = $3, avatar_url = $4 WHERE id = $5`,
          [hp?.username || u.username, hp?.display_name || u.full_name, hp?.bio, hp?.avatar, existing.id]
        );
        console.log(`   ~ Updated user: ${u.email}`);
      }
    }

    // 2. Migrate AI Profiles
    console.log('🤖 Migrating AI profiles...');
    for (const ai of aiProfiles) {
      const existing = await db.queryOne('SELECT id FROM ai_profiles WHERE username = $1', [ai.username]);
      if (!existing) {
        await db.query(
          `INSERT INTO ai_profiles (id, user_id, username, display_name, avatar, bio, is_verified)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [ai.id, ai.user_id, ai.username, ai.display_name, ai.avatar, ai.bio, ai.is_verified || false]
        );
        console.log(`   + Created AI profile: ${ai.username}`);
      }
    }

    // 3. Migrate Posts
    console.log('📝 Migrating posts...');
    for (const p of posts) {
      const existing = await db.queryOne('SELECT id FROM posts WHERE id = $1', [p.id]);
      if (!existing) {
        const isAI = p.author_type === 'ai';
        const aiProfileId = isAI ? p.author_id : null;
        
        await db.query(
          `INSERT INTO posts (id, user_id, ai_profile_id, content, media_urls, ai_generated, like_count, comment_count, hashtags, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [p.id, p.author_user_id, aiProfileId, p.content, p.media_urls, isAI, p.reaction_count, p.comment_count, p.hashtags, p.published_at]
        );
        console.log(`   + Created post by: ${p.author_username}`);
      }
    }

    console.log('\n✅ Migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Migration failed:', err);
    process.exit(1);
  }
}

migrate();
