require('dotenv').config();
const db = require('./src/db/database');
const jwt = require('jsonwebtoken');


async function dumpUsers() {
  await db.initialize();
  const authorInfo = await db.queryOne(
    'SELECT id, username, full_name as display_name, avatar_url as avatar, is_verified FROM users WHERE id = $1',
    ['7654c0c0-4318-4dc1-bcc3-058bd22470f9']
  );
  console.log("AuthorInfo:", authorInfo);
  process.exit(0);
}

dumpUsers();
