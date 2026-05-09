/**
 * Example: Using PostgreSQL in Routes
 * This shows how to migrate from mockStore to real database
 */

/**
 * ────────────────────────────────────────────────────────────────────────────────
 * BEFORE (Using mockStore):
 * ────────────────────────────────────────────────────────────────────────────────
 */

// OLD: const { users, humanProfiles } = require('../db/mockStore');
// OLD: users.push(newUser);  // In-memory array operation
// OLD: const user = users.find(u => u.email === email);  // Array find

/**
 * ────────────────────────────────────────────────────────────────────────────────
 * AFTER (Using PostgreSQL):
 * ────────────────────────────────────────────────────────────────────────────────
 */

// NEW: Use the database module passed via req.db
// NEW: const user = await req.db.queryOne(
//   'SELECT * FROM users WHERE email = $1',
//   [email]
// );

/**
 * ────────────────────────────────────────────────────────────────────────────────
 * MIGRATION GUIDE
 * ────────────────────────────────────────────────────────────────────────────────
 */

// 1. REPLACE IMPORTS
// ─────────────────────────────────────────────────────────────────────────────

// ❌ REMOVE:
// const { users, posts, follows } = require('../db/mockStore');

// ✅ ADD:
// const dbUtils = require('../db/utils');  // For common operations
// Database is available as req.db in all routes

// 2. REPLACE ARRAY OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────

// Example 1: Check if user exists
// ❌ OLD:
// const existingUser = users.find(u => u.email === email);

// ✅ NEW:
// const existingUser = await req.db.queryOne(
//   'SELECT * FROM users WHERE email = $1',
//   [email]
// );

// Example 2: Create new user
// ❌ OLD:
// users.push({ id: uuidv4(), email, username, ... });

// ✅ NEW:
// const newUser = await dbUtils.createUser(req.db, {
//   email,
//   username,
//   fullName,
//   passwordHash,
// });

// Example 3: Find by ID
// ❌ OLD:
// const user = users.find(u => u.id === userId);

// ✅ NEW:
// const user = await dbUtils.getUserById(req.db, userId);

// Example 4: Find all posts
// ❌ OLD:
// const userPosts = posts.filter(p => p.user_id === userId);

// ✅ NEW:
// const userPosts = await req.db.queryMany(
//   'SELECT * FROM posts WHERE user_id = $1 ORDER BY created_at DESC',
//   [userId]
// );

// Example 5: Update user
// ❌ OLD:
// const user = users.find(u => u.id === userId);
// user.bio = newBio;

// ✅ NEW:
// const user = await dbUtils.updateUser(req.db, userId, {
//   bio: newBio,
// });

// Example 6: Delete (soft delete)
// ❌ OLD:
// users = users.filter(u => u.id !== userId);  // Removes data!

// ✅ NEW:
// const user = await dbUtils.deleteUser(req.db, userId);  // Soft delete

// 3. AVAILABLE DATABASE UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

// USER OPERATIONS:
// dbUtils.createUser(db, userData)
// dbUtils.getUserById(db, userId)
// dbUtils.getUserByEmail(db, email)
// dbUtils.getUserByUsername(db, username)
// dbUtils.updateUser(db, userId, updates)
// dbUtils.deleteUser(db, userId)

// POST OPERATIONS:
// dbUtils.createPost(db, postData)
// dbUtils.getPostById(db, postId)
// dbUtils.getUserFeed(db, userId, limit, offset)
// dbUtils.updatePostMetrics(db, postId, field, increment)
// dbUtils.deletePost(db, postId)

// FOLLOW OPERATIONS:
// dbUtils.followUser(db, followerId, followingId)
// dbUtils.unfollowUser(db, followerId, followingId)
// dbUtils.isFollowing(db, followerId, followingId)
// dbUtils.getFollowerCount(db, userId)
// dbUtils.getFollowingCount(db, userId)

// SEARCH OPERATIONS:
// dbUtils.searchUsers(db, query, limit)
// dbUtils.searchPosts(db, query, limit)

// 4. RAW QUERIES
// ─────────────────────────────────────────────────────────────────────────────

// For queries not covered by utils:

// Single row:
// const result = await req.db.queryOne(
//   'SELECT * FROM users WHERE id = $1',
//   [userId]
// );

// Multiple rows:
// const results = await req.db.queryMany(
//   'SELECT * FROM posts WHERE user_id = $1 ORDER BY created_at DESC',
//   [userId]
// );

// Any query (INSERT, UPDATE, DELETE):
// const result = await req.db.query(
//   'INSERT INTO users (...) VALUES (...) RETURNING *',
//   [values...]
// );

// 5. PARAMETERIZED QUERIES
// ─────────────────────────────────────────────────────────────────────────────

// ⚠️  ALWAYS use parameterized queries to prevent SQL injection:

// ❌ DANGEROUS - Don't do this:
// const query = `SELECT * FROM users WHERE email = '${email}'`;

// ✅ SAFE - Always do this:
// const query = 'SELECT * FROM users WHERE email = $1';
// const result = await req.db.queryOne(query, [email]);

// For multiple parameters:
// SELECT * FROM posts WHERE user_id = $1 AND created_at > $2
// Parameters: [userId, startDate]

// 6. TRANSACTION HANDLING (for multiple operations)
// ─────────────────────────────────────────────────────────────────────────────

// If you need to do multiple operations atomically:
// const client = await req.db.pool.connect();
// try {
//   await client.query('BEGIN');
//   await client.query('INSERT INTO ...');
//   await client.query('UPDATE ...');
//   await client.query('COMMIT');
// } catch (err) {
//   await client.query('ROLLBACK');
//   throw err;
// } finally {
//   client.release();
// }

// 7. ERROR HANDLING
// ─────────────────────────────────────────────────────────────────────────────

// Common database errors to handle:

// Unique constraint violation (duplicate email, username):
// if (err.code === '23505') {
//   return res.status(409).json({ message: 'This email/username is already taken' });
// }

// Foreign key constraint violation:
// if (err.code === '23503') {
//   return res.status(400).json({ message: 'Referenced record does not exist' });
// }

// Not null constraint:
// if (err.code === '23502') {
//   return res.status(400).json({ message: 'Required field is missing' });
// }

// 8. PERFORMANCE TIPS
// ─────────────────────────────────────────────────────────────────────────────

// • Use indexes for frequently queried columns (already in schema.sql)
// • Use LIMIT/OFFSET for pagination instead of fetching all rows
// • Select only needed columns instead of SELECT *
// • Use JOIN instead of multiple queries

// Example:
// const posts = await req.db.queryMany(
//   `SELECT p.id, p.content, p.created_at, u.username, u.avatar_url
//    FROM posts p
//    JOIN users u ON p.user_id = u.id
//    WHERE p.user_id = $1
//    ORDER BY p.created_at DESC
//    LIMIT $2 OFFSET $3`,
//   [userId, limit, offset]
// );

module.exports = {};
