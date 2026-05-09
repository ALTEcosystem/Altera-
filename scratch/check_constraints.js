const { Client } = require('pg');
require('dotenv').config();

async function checkConstraints() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    await client.connect();
    const res = await client.query("SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'posts'::regclass;");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

checkConstraints();
