const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function setup() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };

  const dbName = process.env.DB_NAME || 'ALT';

  // 1. Connect to default 'postgres' db to create our app db
  const client = new Client({ ...config, database: 'postgres' });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL server.');

    // Check if database exists
    const res = await client.query(`SELECT 1 FROM pg_database WHERE datname = '${dbName}'`);
    if (res.rowCount === 0) {
      console.log(`Creating database "${dbName}"...`);
      await client.query(`CREATE DATABASE ${dbName}`);
      console.log(`Database "${dbName}" created.`);
    } else {
      console.log(`Database "${dbName}" already exists.`);
    }
  } catch (err) {
    console.error('Error during database creation:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }

  // 2. Connect to the app database and run schema
  const appClient = new Client({ ...config, database: dbName });
  try {
    await appClient.connect();
    console.log(`Connected to database "${dbName}".`);

    const schemaPath = path.join(__dirname, 'src', 'db', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      console.log('Running schema.sql...');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      
      // Split by semicolon and filter empty lines (naive approach but often works for simple schemas)
      // A better way is to use a migration tool, but for initial setup this is okay.
      // However, schema.sql might contain functions or triggers with internal semicolons.
      // So we'll try running it as one block first.
      await appClient.query(schema);
      console.log('Schema applied successfully.');
    } else {
      console.warn('schema.sql not found at', schemaPath);
    }
  } catch (err) {
    console.error('Error applying schema:', err.message);
    process.exit(1);
  } finally {
    await appClient.end();
  }

  console.log('\n✅ Database setup complete!');
}

setup();
