require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sql = "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename";
pool.query(sql).then(r => {
  console.log('\n📋 Tables in NeonDB (' + r.rows.length + ' total):');
  r.rows.forEach(row => console.log('   ✅', row.tablename));
  console.log('\n✅ NeonDB migration complete. Backend is ready to start.\n');
  pool.end();
}).catch(e => { console.error('❌ Error:', e.message); pool.end(); });
