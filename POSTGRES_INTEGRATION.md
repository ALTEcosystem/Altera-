# PostgreSQL Integration Complete ✅

Your ALTERA backend is now configured to use PostgreSQL. Here's what was set up:

## 📁 Files Created

### 1. **`src/db/database.js`** - Database Connection Module
- PostgreSQL connection pool with automatic connection management
- Helper functions: `query()`, `queryOne()`, `queryMany()`
- Automatic error handling and logging
- Clean shutdown on server termination

### 2. **`src/db/utils.js`** - Database Utilities
Pre-built helper functions for common operations:
- **User operations**: createUser, getUserById, getUserByEmail, updateUser, deleteUser
- **Post operations**: createPost, getPostById, getUserFeed, updatePostMetrics
- **Follow operations**: followUser, unfollowUser, isFollowing, getFollowerCount
- **Search operations**: searchUsers, searchPosts

### 3. **`POSTGRES_SETUP.md`** - Setup Instructions
Complete guide for setting up PostgreSQL:
- Docker Compose quick start
- Manual setup for Windows, macOS, Linux
- Database initialization instructions
- Troubleshooting guide

### 4. **`src/db/MIGRATION_GUIDE.md`** - Migration Reference
Shows how to migrate existing routes from mockStore to PostgreSQL with examples

## 📝 Files Modified

### **`src/server.js`**
- Added database import: `const db = require('./db/database');`
- Attached database to request object: `req.db = db;`
- Added async initialization: `await db.initialize();` before listening
- Displays database connection info on startup

### **Existing Files**
- `.env.example` - Already has database configuration variables
- `docker-compose.yml` - Already configured for PostgreSQL
- `Dockerfile` - No changes needed
- `altera_backend/src/db/schema.sql` - Already contains complete schema

## 🚀 Quick Start

### Option 1: Docker Compose (Recommended)
```bash
# From project root
docker-compose up -d

# This will:
# • Start PostgreSQL 15 container
# • Initialize database with schema
# • Start Node.js API server on port 3000
```

### Option 2: Local PostgreSQL
1. Install PostgreSQL 15+ locally
2. Create database: `createdb altera_db`
3. Load schema: `psql -d altera_db -f altera_backend/src/db/schema.sql`
4. Create `.env` file in `altera_backend/`:
   ```
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=altera_db
   DB_USER=postgres
   DB_PASSWORD=your_password
   ```
5. Run:
   ```bash
   cd altera_backend
   npm install
   npm run dev
   ```

## 💾 How to Use in Routes

### Before (mockStore)
```javascript
const { users } = require('../db/mockStore');
const user = users.find(u => u.email === email);
```

### After (PostgreSQL)
```javascript
const dbUtils = require('../db/utils');
const user = await req.db.queryOne(
  'SELECT * FROM users WHERE email = $1',
  [email]
);
// Or use the utility:
const user = await dbUtils.getUserByEmail(req.db, email);
```

## 🔌 Database Connection Details

| Setting | Value | Environment Variable |
|---------|-------|----------------------|
| **Host** | localhost (local) or `postgres` (Docker) | `DB_HOST` |
| **Port** | 5432 | `DB_PORT` |
| **Database** | altera_db | `DB_NAME` |
| **User** | postgres | `DB_USER` |
| **Password** | altera_dev_pass (Docker) or custom | `DB_PASSWORD` |

## ✨ Features

✅ **Connection Pooling** - Max 20 concurrent connections
✅ **Automatic Logging** - All queries logged in development mode
✅ **Error Handling** - Comprehensive error management
✅ **Graceful Shutdown** - Clean connection closure on exit
✅ **Type Safety** - Parameterized queries prevent SQL injection
✅ **Ready-to-Use Utilities** - Common operations pre-built
✅ **Soft Deletes** - Users and posts use deleted_at instead of hard delete

## 📊 Database Schema

The schema (already in `src/db/schema.sql`) includes tables for:
- **users** - User accounts with profiles
- **posts** - Feed posts and comments
- **follows** - User relationships
- **messages** - DMs between users
- **notifications** - User notifications
- Additional tables for likes, hashtags, mentions, etc.

## 🧪 Test the Connection

```bash
curl http://localhost:3000/health
```

Response should include:
```json
{
  "status": "ok",
  "service": "ALTERA Node.js API",
  "version": "1.0.0",
  "timestamp": "2024-..."
}
```

## 🔄 Next Steps

1. **Migrate Routes** - Update each route file to use PostgreSQL instead of mockStore
   - See `src/db/MIGRATION_GUIDE.md` for examples
   - Remove mockStore imports
   - Use `req.db.queryOne()`, `req.db.queryMany()` or utilities from `dbUtils`

2. **Update Routes** (Priority order):
   - `src/routes/auth.js` - User registration and login
   - `src/routes/posts.js` - Post creation and retrieval
   - `src/routes/profiles.js` - User profiles
   - `src/routes/feed.js` - Feed generation
   - Other routes as needed

3. **Add Error Handling** - Handle PostgreSQL-specific errors:
   - Unique constraint violations (409 Conflict)
   - Foreign key violations (400 Bad Request)
   - Not null violations (400 Bad Request)

## 📚 Documentation Files

- [POSTGRES_SETUP.md](./POSTGRES_SETUP.md) - Complete setup guide
- [src/db/MIGRATION_GUIDE.md](./src/db/MIGRATION_GUIDE.md) - How to migrate routes
- [src/db/database.js](./src/db/database.js) - Connection module (well-documented)
- [src/db/utils.js](./src/db/utils.js) - Utilities with JSDoc comments

## ⚠️ Important Notes

- **Do NOT** mix mockStore and PostgreSQL - choose one for each endpoint
- **Always** use parameterized queries (`$1`, `$2`, etc.) to prevent SQL injection
- **Test locally** with Docker before deploying
- **Reset database** with `docker-compose down -v` if needed
- **Keep schema.sql updated** when modifying database structure

## 🆘 Troubleshooting

| Problem | Solution |
|---------|----------|
| "Connection refused" | Check PostgreSQL is running and DB_HOST/DB_PORT are correct |
| "Database does not exist" | Run schema.sql: `psql -d altera_db -f src/db/schema.sql` |
| "relation does not exist" | Schema not loaded - see setup guide |
| Queries running slow | Check indexes in schema.sql and avoid N+1 queries |
| Pool errors | Reduce `max` connections in database.js if memory constrained |

---

**Backend is ready!** Your database connection is fully configured. Start migrating routes and you'll have a production-ready PostgreSQL-backed API.

For any questions, refer to the setup guide or migration guide in the docs folder.
