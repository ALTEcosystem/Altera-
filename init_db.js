const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { pool } = require('./src/db/database');

async function runSchema() {
  try {
    const schemaPath = path.join(__dirname, 'src', 'db', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    console.log('[DB] Running schema.sql...');
    
    // Split schema into individual commands (ignoring comments and splitting by semicolon)
    // Note: Simple split by ; might break if there are semicolons in strings or triggers,
    // but the provided schema.sql seems safe or we can use pool.query(schema) directly.
    // pool.query can execute multiple statements separated by semicolons.
    
    await pool.query(schema);
    
    console.log('[DB] Schema initialized successfully!');
    process.exit(0);
  } catch (err) {
    console.error('[DB ERROR] Failed to initialize schema:', err);
    process.exit(1);
  }
}

runSchema();
