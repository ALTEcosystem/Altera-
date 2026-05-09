# PostgreSQL Setup Guide for ALTERA

## Quick Start with Docker Compose

The easiest way to get started is using Docker Compose, which automatically sets up PostgreSQL with your database schema:

### Prerequisites
- Docker & Docker Compose installed

### Steps

1. **Start the services** (from the project root):
   ```bash
   docker-compose up -d
   ```
   This will:
   - Start PostgreSQL 15 Alpine container
   - Initialize the `altera_db` database
   - Load the schema from `altera_backend/src/db/schema.sql`
   - Start the Node.js API server

2. **Verify PostgreSQL is running**:
   ```bash
   docker ps | grep postgres
   ```

3. **Access PostgreSQL directly** (if needed):
   ```bash
   docker exec -it altera_postgres psql -U postgres -d altera_db
   ```

4. **View logs**:
   ```bash
   docker-compose logs -f api      # API logs
   docker-compose logs -f postgres # PostgreSQL logs
   ```

---

## Manual PostgreSQL Setup (Local Development)

### On Windows (using WSL2 or native PostgreSQL)

1. **Download & Install PostgreSQL 15+**
   - Visit: https://www.postgresql.org/download/windows/
   - Run installer
   - Remember the password you set for `postgres` user

2. **Create database and user**:
   ```bash
   psql -U postgres
   ```
   Then in the PostgreSQL shell:
   ```sql
   CREATE DATABASE altera_db;
   CREATE USER altera_user WITH PASSWORD 'altera_password';
   ALTER ROLE altera_user SET client_encoding TO 'utf8';
   ALTER ROLE altera_user SET default_transaction_isolation TO 'read committed';
   ALTER ROLE altera_user SET default_transaction_deferrable TO on;
   ALTER ROLE altera_user SET default_transaction_read_committed TO on;
   GRANT ALL PRIVILEGES ON DATABASE altera_db TO altera_user;
   ```

3. **Load the schema**:
   ```bash
   psql -U postgres -d altera_db -f altera_backend/src/db/schema.sql
   ```

4. **Configure .env file** in `altera_backend/`:
   ```
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=altera_db
   DB_USER=altera_user
   DB_PASSWORD=altera_password
   ```

5. **Install dependencies & run**:
   ```bash
   cd altera_backend
   npm install
   npm run dev
   ```

---

## On macOS (using Homebrew)

1. **Install PostgreSQL**:
   ```bash
   brew install postgresql@15
   brew services start postgresql@15
   ```

2. **Create database**:
   ```bash
   createdb altera_db
   ```

3. **Load schema**:
   ```bash
   psql -d altera_db -f altera_backend/src/db/schema.sql
   ```

4. **Configure .env** (same as Windows above)

---

## On Linux (Ubuntu/Debian)

1. **Install PostgreSQL**:
   ```bash
   sudo apt update
   sudo apt install postgresql postgresql-contrib
   sudo systemctl start postgresql
   ```

2. **Create database & user**:
   ```bash
   sudo -u postgres psql
   ```
   Then:
   ```sql
   CREATE DATABASE altera_db;
   CREATE USER altera_user WITH PASSWORD 'altera_password';
   GRANT ALL PRIVILEGES ON DATABASE altera_db TO altera_user;
   ```

3. **Load schema**:
   ```bash
   psql -U altera_user -d altera_db -f altera_backend/src/db/schema.sql
   ```

---

## Database Connection Pooling

The database module (`src/db/database.js`) automatically:
- Uses a connection pool with max 20 connections
- Has 30s idle timeout & 2s connection timeout
- Logs all queries in development mode
- Handles reconnection on errors

## Environment Variables

See `.env.example` for all required variables. At minimum:
- `DB_HOST` - PostgreSQL server host
- `DB_PORT` - PostgreSQL server port (default: 5432)
- `DB_NAME` - Database name
- `DB_USER` - Database user
- `DB_PASSWORD` - Database user password

## Troubleshooting

### "Connection refused" error
- Check PostgreSQL is running: `sudo systemctl status postgresql` (Linux) or check Services (Windows)
- Verify host/port in .env matches your PostgreSQL instance

### "Database does not exist"
- Run: `psql -U postgres -l` to list databases
- If `altera_db` doesn't exist, run the schema.sql file as shown above

### "FATAL: role 'user' does not exist"
- Check .env DB_USER and DB_PASSWORD match your PostgreSQL setup
- Or create the user as shown in the setup steps above

### "Schema.sql" errors
- Ensure PostgreSQL extensions are available: `uuid-ossp`, `pgcrypto`
- Re-run schema.sql or check PostgreSQL logs

---

## Testing the Connection

Once running, test the database connection:

```bash
curl http://localhost:3000/health
```

Should return something like:
```json
{
  "status": "ok",
  "service": "ALTERA Node.js API",
  "version": "1.0.0",
  "timestamp": "2024-..."
}
```

---

## Resetting the Database

### With Docker:
```bash
docker-compose down -v  # Remove named volumes
docker-compose up -d    # Recreate database with fresh schema
```

### Local PostgreSQL:
```bash
dropdb altera_db
createdb altera_db
psql -d altera_db -f altera_backend/src/db/schema.sql
```

---

## Next Steps

- Routes are now connected to PostgreSQL via `req.db`
- Use `req.db.queryOne(sql, params)` for single row queries
- Use `req.db.queryMany(sql, params)` for multiple rows
- Use `req.db.query(sql, params)` for any query

Example in a route:
```javascript
const user = await req.db.queryOne(
  'SELECT * FROM users WHERE id = $1',
  [userId]
);
```
