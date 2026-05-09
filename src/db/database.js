const { Pool, types } = require('pg');

const PG_TIMESTAMP_OID = 1114;

// Treat Postgres TIMESTAMP values as UTC so client-relative timeago labels
// don't drift by the server/database offset.
types.setTypeParser(PG_TIMESTAMP_OID, (value) => {
  if (value == null) return value;
  return new Date(`${value}Z`);
});

/**
 * NeonDB (PostgreSQL) Connection Pool
 * Manages all database connections for ALTERA API
 * Uses a single DATABASE_URL connection string with SSL required by NeonDB
 */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Required for NeonDB / Neon serverless
  },
  max: 20,                       // Neon's free tier supports limited concurrent connections
  idleTimeoutMillis: 30000,      // 30s idle timeout
  connectionTimeoutMillis: 10000, // 10s connection timeout (accounts for cold starts)
});

// Log connection errors
pool.on('error', (err) => {
  console.error('[DB ERROR] Unexpected error on idle client', err);
});

/**
 * Query helper function
 * @param {string} text - SQL query text
 * @param {array} params - Query parameters
 * @returns {Promise<QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    // Log queries in development
    if (process.env.NODE_ENV === 'development') {
      console.log('[DB QUERY]', { text, duration: `${duration}ms`, rows: result.rowCount });
    }
    return result;
  } catch (err) {
    console.error('[DB ERROR]', err, { text, params });
    throw err;
  }
}

/**
 * Execute a query and return the first row
 */
async function queryOne(text, params) {
  const result = await query(text, params);
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Execute a query and return all rows
 */
async function queryMany(text, params) {
  const result = await query(text, params);
  return result.rows;
}

/**
 * Initialize database - verify connection and create schema if needed
 */
async function initialize() {
  try {
    const client = await pool.connect();
    const version = await client.query('SELECT version()');
    console.log('[DB INIT] Connected to PostgreSQL');
    console.log('[DB INIT]', version.rows[0].version.split(',')[0]);
    client.release();
    return true;
  } catch (err) {
    console.error('[DB INIT ERROR] Failed to connect to PostgreSQL', err.message);
    process.exit(1);
  }
}

/**
 * Close all connections in the pool
 */
async function close() {
  try {
    await pool.end();
    console.log('[DB] Connection pool closed');
  } catch (err) {
    console.error('[DB ERROR] Failed to close connection pool', err);
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n[SERVER] Closing database connections...');
  await close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[SERVER] Closing database connections...');
  await close();
  process.exit(0);
});

module.exports = {
  query,
  queryOne,
  queryMany,
  pool,
  initialize,
  close,
};
