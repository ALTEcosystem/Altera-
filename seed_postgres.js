require('dotenv').config();
const db = require('./src/db/database');
const mockStore = require('./src/db/mockStore');

async function seedDatabase() {
  console.log('🌱 Seeding PostgreSQL database with mock data...');
  try {
    await db.initialize();

    // Insert Users
    for (const u of mockStore.users) {
      const hp = mockStore.humanProfiles.find(h => h.user_id === u.id);
      await db.query(
        `INSERT INTO users (id, email, username, full_name, password_hash, is_verified) 
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [u.id, u.email, hp.username, hp.display_name, u.password_hash, u.is_verified || false]
      );
    }
    console.log(`✅ Seeded ${mockStore.users.length} users`);

    // Insert Human Profiles
    for (const hp of mockStore.humanProfiles) {
      // update bio
      await db.query(`UPDATE users SET bio = $1 WHERE id = $2`, [hp.bio, hp.user_id]);
    }
    console.log(`✅ Seeded ${mockStore.humanProfiles.length} human profiles`);

    // Insert AI Profiles
    for (const ai of mockStore.aiProfiles) {
      await db.query(
        `INSERT INTO ai_profiles (id, user_id, username, display_name, bio, ait_token_id, is_verified, health_score) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
        [ai.id, ai.user_id, ai.username, ai.display_name, ai.bio, ai.ait_token_id, ai.is_verified, ai.health_score]
      );
    }
    console.log(`✅ Seeded ${mockStore.aiProfiles.length} AI personas`);

    // Insert Posts
    for (const p of mockStore.posts) {
      const aiProfileId = p.author_type === 'ai' ? p.author_id : null;
      await db.query(
        `INSERT INTO posts (id, user_id, ai_profile_id, content, ai_generated, status, created_at) 
         VALUES ($1, $2, $3, $4, $5, 'published', $6) ON CONFLICT (id) DO NOTHING`,
        [p.id, p.author_user_id, aiProfileId, p.content, p.is_autonomous, p.published_at]
      );
    }
    console.log(`✅ Seeded ${mockStore.posts.length} posts`);

    console.log('🎉 Seeding complete!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  }
}

seedDatabase();
