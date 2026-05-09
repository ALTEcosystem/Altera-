/**
 * Database Utility Functions
 * Common database operations used across routes
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Create a new user in the database
 */
async function createUser(db, userData) {
  const {
    email,
    username,
    fullName,
    passwordHash,
    bio = null,
    avatarUrl = null,
  } = userData;

  const id = uuidv4();
  const query = `
    INSERT INTO users (
      id, email, username, full_name, password_hash, bio, avatar_url, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING *;
  `;

  return db.queryOne(query, [id, email, username, fullName, passwordHash, bio, avatarUrl]);
}

/**
 * Get user by ID
 */
async function getUserById(db, userId) {
  const query = 'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL;';
  return db.queryOne(query, [userId]);
}

/**
 * Get user by email
 */
async function getUserByEmail(db, email) {
  const query = 'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL;';
  return db.queryOne(query, [email]);
}

/**
 * Get user by username
 */
async function getUserByUsername(db, username) {
  const query = 'SELECT * FROM users WHERE username = $1 AND deleted_at IS NULL;';
  return db.queryOne(query, [username]);
}

/**
 * Update user profile
 */
async function updateUser(db, userId, updates) {
  const allowedFields = ['full_name', 'bio', 'avatar_url', 'cover_url', 'is_verified'];
  const fields = [];
  const values = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }

  if (fields.length === 0) return null;

  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(userId);

  const query = `
    UPDATE users 
    SET ${fields.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING *;
  `;

  return db.queryOne(query, values);
}

/**
 * Create a new post
 */
async function createPost(db, postData) {
  const {
    userId,
    content,
    mediaUrls = null,
    aiGenerated = false,
    aiModel = null,
    replyToId = null,
    hashtags = null,
    mentionedUsers = null,
  } = postData;

  const id = uuidv4();
  const query = `
    INSERT INTO posts (
      id, user_id, content, media_urls, ai_generated, ai_model, 
      reply_to_id, hashtags, mentioned_users, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING *;
  `;

  return db.queryOne(query, [
    id,
    userId,
    content,
    mediaUrls,
    aiGenerated,
    aiModel,
    replyToId,
    hashtags,
    mentionedUsers,
  ]);
}

/**
 * Get post by ID with user details
 */
async function getPostById(db, postId) {
  const query = `
    SELECT 
      p.*,
      u.username,
      u.avatar_url,
      u.is_verified
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.id = $1 AND p.deleted_at IS NULL;
  `;
  return db.queryOne(query, [postId]);
}

/**
 * Get user's feed (posts from followed users)
 */
async function getUserFeed(db, userId, limit = 20, offset = 0) {
  const query = `
    SELECT 
      p.*,
      u.username,
      u.avatar_url,
      u.is_verified,
      COUNT(DISTINCT l.id) as like_count
    FROM posts p
    JOIN users u ON p.user_id = u.id
    LEFT JOIN follows f ON f.follower_id = $1 AND f.following_id = p.user_id
    LEFT JOIN likes l ON l.post_id = p.id
    WHERE (f.id IS NOT NULL OR p.user_id = $1) AND p.deleted_at IS NULL
    GROUP BY p.id, u.id
    ORDER BY p.created_at DESC
    LIMIT $2 OFFSET $3;
  `;
  return db.queryMany(query, [userId, limit, offset]);
}

/**
 * Follow a user
 */
async function followUser(db, followerId, followingId) {
  if (followerId === followingId) {
    throw new Error('Cannot follow yourself');
  }

  const id = uuidv4();
  const query = `
    INSERT INTO follows (id, follower_id, following_id, created_at)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
    ON CONFLICT (follower_id, following_id) DO NOTHING
    RETURNING *;
  `;
  return db.queryOne(query, [id, followerId, followingId]);
}

/**
 * Unfollow a user
 */
async function unfollowUser(db, followerId, followingId) {
  const query = `
    DELETE FROM follows
    WHERE follower_id = $1 AND following_id = $2
    RETURNING *;
  `;
  return db.queryOne(query, [followerId, followingId]);
}

/**
 * Check if user is following another user
 */
async function isFollowing(db, followerId, followingId) {
  const query = `
    SELECT COUNT(*) as count FROM follows
    WHERE follower_id = $1 AND following_id = $2;
  `;
  const result = await db.queryOne(query, [followerId, followingId]);
  return result.count > 0;
}

/**
 * Get user's followers count
 */
async function getFollowerCount(db, userId) {
  const query = `
    SELECT COUNT(*) as count FROM follows
    WHERE following_id = $1;
  `;
  const result = await db.queryOne(query, [userId]);
  return result.count;
}

/**
 * Get user's following count
 */
async function getFollowingCount(db, userId) {
  const query = `
    SELECT COUNT(*) as count FROM follows
    WHERE follower_id = $1;
  `;
  const result = await db.queryOne(query, [userId]);
  return result.count;
}

/**
 * Update post metrics (like, comment, repost counts)
 */
async function updatePostMetrics(db, postId, field, increment = 1) {
  const allowedFields = ['like_count', 'comment_count', 'repost_count', 'view_count'];
  
  if (!allowedFields.includes(field)) {
    throw new Error(`Invalid field: ${field}`);
  }

  const query = `
    UPDATE posts 
    SET ${field} = ${field} + $2, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *;
  `;

  return db.queryOne(query, [postId, increment]);
}

/**
 * Search users by username or full name
 */
async function searchUsers(db, query, limit = 10) {
  const searchQuery = `
    SELECT id, username, full_name, avatar_url, is_verified
    FROM users
    WHERE (username ILIKE $1 OR full_name ILIKE $1) AND deleted_at IS NULL
    LIMIT $2;
  `;
  return db.queryMany(searchQuery, [`%${query}%`, limit]);
}

/**
 * Search posts by content or hashtags
 */
async function searchPosts(db, query, limit = 20) {
  const searchQuery = `
    SELECT 
      p.*,
      u.username,
      u.avatar_url,
      u.is_verified
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE (p.content ILIKE $1 OR $2 = ANY(p.hashtags)) AND p.deleted_at IS NULL
    ORDER BY p.created_at DESC
    LIMIT $3;
  `;
  return db.queryMany(searchQuery, [`%${query}%`, query, limit]);
}

/**
 * Soft delete a post (doesn't remove from DB)
 */
async function deletePost(db, postId) {
  const query = `
    UPDATE posts 
    SET deleted_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *;
  `;
  return db.queryOne(query, [postId]);
}

/**
 * Soft delete a user account
 */
async function deleteUser(db, userId) {
  const query = `
    UPDATE users 
    SET deleted_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *;
  `;
  return db.queryOne(query, [userId]);
}

module.exports = {
  // User operations
  createUser,
  getUserById,
  getUserByEmail,
  getUserByUsername,
  updateUser,
  deleteUser,

  // Post operations
  createPost,
  getPostById,
  getUserFeed,
  updatePostMetrics,
  deletePost,

  // Follow operations
  followUser,
  unfollowUser,
  isFollowing,
  getFollowerCount,
  getFollowingCount,

  // Search operations
  searchUsers,
  searchPosts,
};
