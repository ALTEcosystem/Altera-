const { Client } = require('pg');
require('dotenv').config();

async function checkUsers() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'ALT',
  });

  try {
    await client.connect();
    const res = await client.query('SELECT email, username FROM users');
    console.log('Users in DB:', res.rows);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}

checkUsers();
