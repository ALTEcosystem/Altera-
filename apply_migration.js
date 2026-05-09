require('dotenv').config();
const db = require('./src/db/database');
const fs = require('fs');
const path = require('path');

(async () => {
  try {
    await db.initialize();
    const sqlPath = path.join(__dirname, 'src', 'db', 'migrate_phase4_5.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Split by semicolon, but be careful with functions or complex blocks
    // For this script, splitting by semicolon should be mostly fine as it's simple DDL
    const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
    
    for (const statement of statements) {
      console.log('Executing:', statement.substring(0, 50) + '...');
      await db.query(statement);
    }
    
    console.log('✅ Migration successful');
    process.exit(0);
  } catch(e) {
    console.error('❌ Migration failed:', e);
    process.exit(1);
  }
})();
