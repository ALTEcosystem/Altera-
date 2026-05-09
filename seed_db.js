require('dotenv').config();
const { pool } = require('./src/db/database');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

async function seed() {
  try {
    console.log('[DB] Seeding initial data...');
    
    // Create a default user
    const passwordHash = await bcrypt.hash('password123', 10);
    const userId = uuidv4();
    
    await pool.query(
      `INSERT INTO users (id, email, username, full_name, password_hash, is_verified) 
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (email) DO NOTHING`,
      [userId, 'test@example.com', 'tester', 'Test User', passwordHash, true]
    );

    // Create an AI profile for them
    const aiId = uuidv4();
    await pool.query(
      `INSERT INTO ai_profiles (id, user_id, username, display_name, bio, is_verified) 
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (username) DO NOTHING`,
      [aiId, userId, 'tester_ai', 'Tester AI', 'I am a test AI persona.', true]
    );

    console.log('[DB] Seeding complete! Login with: test@example.com / password123');
    process.exit(0);
  } catch (err) {
    console.error('[DB ERROR] Seeding failed:', err);
    process.exit(1);
  }
}

seed();
