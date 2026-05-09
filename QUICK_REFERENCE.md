# PostgreSQL Quick Reference Card

## 🚀 Getting Started

```bash
# Start with Docker Compose
cd altera_backend
docker-compose up -d

# Or run setup script
# Windows: setup.bat
# Linux/Mac: bash setup.sh
```

---

## 📚 Database API Cheat Sheet

### Basic Query Functions (via `req.db`)

```javascript
// Single row query
const user = await req.db.queryOne(
  'SELECT * FROM users WHERE id = $1',
  [userId]
);

// Multiple rows
const posts = await req.db.queryMany(
  'SELECT * FROM posts WHERE user_id = $1 ORDER BY created_at DESC',
  [userId]
);

// Any query (INSERT, UPDATE, DELETE)
const result = await req.db.query(
  'INSERT INTO posts (id, user_id, content) VALUES ($1, $2, $3) RETURNING *',
  [postId, userId, content]
);
```

---

## 👥 User Operations (via `dbUtils`)

```javascript
const dbUtils = require('../db/utils');

// Create user
const user = await dbUtils.createUser(req.db, {
  email: 'user@example.com',
  username: 'username',
  fullName: 'Full Name',
  passwordHash: hashedPassword,
  bio: 'Bio text',
});

// Get user by ID
const user = await dbUtils.getUserById(req.db, userId);

// Get user by email
const user = await dbUtils.getUserByEmail(req.db, 'email@example.com');

// Get user by username
const user = await dbUtils.getUserByUsername(req.db, 'username');

// Update user
const updated = await dbUtils.updateUser(req.db, userId, {
  bio: 'New bio',
  avatar_url: 'https://...',
});

// Delete user (soft delete)
const deleted = await dbUtils.deleteUser(req.db, userId);
```

---

## 📝 Post Operations

```javascript
// Create post
const post = await dbUtils.createPost(req.db, {
  userId: userId,
  content: 'Post content',
  mediaUrls: ['url1', 'url2'],
  aiGenerated: false,
  hashtags: ['tag1', 'tag2'],
});

// Get post
const post = await dbUtils.getPostById(req.db, postId);

// Get user's feed
const posts = await dbUtils.getUserFeed(req.db, userId, limit = 20, offset = 0);

// Update post metrics
await dbUtils.updatePostMetrics(req.db, postId, 'like_count', 1);
// Fields: 'like_count', 'comment_count', 'repost_count', 'view_count'

// Delete post (soft delete)
const deleted = await dbUtils.deletePost(req.db, postId);
```

---

## 👫 Follow Operations

```javascript
// Follow user
await dbUtils.followUser(req.db, followerId, followingId);

// Unfollow user
await dbUtils.unfollowUser(req.db, followerId, followingId);

// Check if following
const isFollowing = await dbUtils.isFollowing(req.db, followerId, followingId);

// Get follower count
const count = await dbUtils.getFollowerCount(req.db, userId);

// Get following count
const count = await dbUtils.getFollowingCount(req.db, userId);
```

---

## 🔍 Search Operations

```javascript
// Search users
const users = await dbUtils.searchUsers(req.db, 'search query', limit = 10);
// Returns: { id, username, full_name, avatar_url, is_verified }

// Search posts
const posts = await dbUtils.searchPosts(req.db, 'search query', limit = 20);
// Returns: Full post objects with user details
```

---

## 🔐 Important Patterns

### Always use parameterized queries
```javascript
// ✅ SAFE
const user = await req.db.queryOne(
  'SELECT * FROM users WHERE email = $1',
  [email]
);

// ❌ DANGEROUS - NEVER DO THIS
const query = `SELECT * FROM users WHERE email = '${email}'`;
```

### Multiple parameters
```javascript
const result = await req.db.query(
  'INSERT INTO posts (id, user_id, content, created_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING *',
  [postId, userId, content]
  // $1 = postId, $2 = userId, $3 = content
);
```

### Handle database errors
```javascript
try {
  await dbUtils.createUser(req.db, userData);
} catch (err) {
  if (err.code === '23505') {
    // Unique constraint violation (duplicate email/username)
    return res.status(409).json({ message: 'Email or username already exists' });
  }
  if (err.code === '23503') {
    // Foreign key violation
    return res.status(400).json({ message: 'Referenced record does not exist' });
  }
  // Handle other errors
  return res.status(500).json({ message: 'Database error' });
}
```

---

## 🛠️ Advanced Patterns

### Pagination
```javascript
const limit = 20;
const offset = (page - 1) * limit;
const posts = await req.db.queryMany(
  'SELECT * FROM posts ORDER BY created_at DESC LIMIT $1 OFFSET $2',
  [limit, offset]
);
```

### Joins
```javascript
const posts = await req.db.queryMany(
  `SELECT p.*, u.username, u.avatar_url, u.is_verified
   FROM posts p
   JOIN users u ON p.user_id = u.id
   WHERE p.user_id = $1
   ORDER BY p.created_at DESC`,
  [userId]
);
```

### Aggregations
```javascript
const stats = await req.db.queryOne(
  `SELECT 
    COUNT(*) as total_posts,
    AVG(like_count) as avg_likes,
    MAX(like_count) as max_likes
   FROM posts
   WHERE user_id = $1`,
  [userId]
);
```

### Transactions (for multi-step operations)
```javascript
const client = await req.db.pool.connect();
try {
  await client.query('BEGIN');
  await client.query('INSERT INTO posts (...) VALUES (...)');
  await client.query('UPDATE users SET post_count = post_count + 1 WHERE id = $1', [userId]);
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}
```

---

## 🗄️ Table Reference

### users
- `id` (UUID) - Primary key
- `email` (VARCHAR) - Unique
- `username` (VARCHAR) - Unique
- `full_name` (VARCHAR)
- `password_hash` (VARCHAR)
- `bio` (TEXT)
- `avatar_url` (VARCHAR)
- `is_verified` (BOOLEAN)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)
- `deleted_at` (TIMESTAMP) - NULL = active

### posts
- `id` (UUID) - Primary key
- `user_id` (UUID) - Foreign key
- `content` (TEXT) - Max 500 chars
- `media_urls` (VARCHAR array)
- `like_count`, `comment_count`, `repost_count`, `view_count` (INTEGER)
- `hashtags` (VARCHAR array)
- `mentioned_users` (UUID array)
- `created_at` (TIMESTAMP)
- `deleted_at` (TIMESTAMP) - NULL = active

### follows
- `id` (UUID) - Primary key
- `follower_id` (UUID) - Foreign key to users
- `following_id` (UUID) - Foreign key to users
- `created_at` (TIMESTAMP)

---

## 📊 Performance Tips

- **Use LIMIT/OFFSET** for pagination instead of fetching all rows
- **Select specific columns** instead of `SELECT *`
- **Use JOINs** instead of multiple separate queries
- **Use indexes** - Already defined in schema.sql for common queries
- **Batch operations** when possible

---

## 🆘 Common Issues & Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| "relation does not exist" | Schema not loaded | Run `psql -d altera_db -f schema.sql` |
| Unique constraint violation (23505) | Duplicate email/username | Check existing records first |
| Foreign key violation (23503) | Referenced user/post doesn't exist | Verify IDs exist before insert |
| Connection refused | PostgreSQL not running | Check `docker ps` or local service |
| Pool timeout | Too many concurrent connections | Increase pool.max in database.js |

---

## 📞 Environment Variables

```
DB_HOST=localhost or postgres
DB_PORT=5432
DB_NAME=altera_db
DB_USER=postgres
DB_PASSWORD=altera_dev_pass (docker) or custom
NODE_ENV=development or production
```

---

## 🎯 Quick Route Migration Checklist

- [ ] Import dbUtils: `const dbUtils = require('../db/utils');`
- [ ] Remove mockStore imports
- [ ] Replace array.find() with queryOne()
- [ ] Replace array.filter() with queryMany()
- [ ] Replace array.push() with appropriate insert
- [ ] Add error handling for database errors
- [ ] Test route with actual database
- [ ] Remove mockStore dependency

---

**Ready to go!** Use this card as a quick reference while building your routes.
