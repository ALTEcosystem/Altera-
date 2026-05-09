const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth');
const db = require('../db/database');

const router = express.Router();

async function emitNotification(io, recipientUserId, notificationId) {
  if (!io || !recipientUserId || !notificationId) return;

  const notification = await db.queryOne(
    `SELECT n.*,
            u.full_name as actor_name,
            u.avatar_url as actor_avatar
     FROM notifications n
     LEFT JOIN users u ON n.actor_id = u.id
     WHERE n.id = $1`,
    [notificationId]
  );

  if (!notification) return;

  const payload = {
    id: notification.id,
    user_id: notification.user_id,
    actor_id: notification.actor_id,
    actor_name: notification.actor_name,
    actor_avatar: notification.actor_avatar,
    type: notification.type,
    post_id: notification.post_id,
    comment_id: notification.comment_id,
    post_snippet: null,
    message: notification.message,
    is_read: notification.is_read,
    read_at: notification.read_at,
    created_at: notification.created_at,
  };

  io.to(`notifications:${recipientUserId}`).emit('notification:new', payload);
  io.to(`user:${recipientUserId}`).emit('notification:new', payload);
}

// ─── POST /follows — Toggle follow status ────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      followee_id,
      followee_type = 'human',
      follower_id,
      follower_type = 'human',
    } = req.body;

    if (!followee_id) {
      return res.status(400).json({ message: 'followee_id required' });
    }

    // Identify the follower (must be owned by the authenticated user)
    let finalFollowerId;
    if (follower_type === 'ai') {
      const ai = await db.queryOne('SELECT id FROM ai_profiles WHERE id = $1 AND user_id = $2', [follower_id, req.userId]);
      if (!ai) return res.status(403).json({ message: 'AI persona not found or not yours' });
      finalFollowerId = ai.id;
    } else {
      // Human follower — we use the user's primary ID (or their human profile ID if separate, but schema has them same for now)
      // Actually in schema, follows table references users(id).
      finalFollowerId = req.userId;
    }

    // Check if followee exists
    let followee;
    if (followee_type === 'ai') {
      followee = await db.queryOne('SELECT id FROM ai_profiles WHERE id = $1', [followee_id]);
    } else {
      followee = await db.queryOne('SELECT id FROM users WHERE id = $1', [followee_id]);
    }

    if (!followee) {
      return res.status(404).json({ message: 'Followee profile not found' });
    }

    if (finalFollowerId === followee_id) {
      return res.status(400).json({ message: 'You cannot follow yourself' });
    }

    // Check existing
    const existing = await db.queryOne(
      'SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2',
      [finalFollowerId, followee_id]
    );

    if (existing) {
      // Unfollow
      await db.query('DELETE FROM follows WHERE id = $1', [existing.id]);
      
      const counts = await getFollowCounts(followee_id, finalFollowerId);
      return res.json({
        following: false,
        follower_count: counts.followee_followers,
        following_count: counts.follower_following,
      });
    }

    // Follow
    const followId = uuidv4();
    await db.query(
      'INSERT INTO follows (id, follower_id, following_id) VALUES ($1, $2, $3)',
      [followId, finalFollowerId, followee_id]
    );

    // ─── Create Notification ───
    try {
      // Find recipient user_id (if followee is AI, we notify the owner)
      let recipientUserId;
      if (followee_type === 'ai') {
        const ai = await db.queryOne('SELECT user_id FROM ai_profiles WHERE id = $1', [followee_id]);
        recipientUserId = ai?.user_id;
      } else {
        recipientUserId = followee_id;
      }

      if (recipientUserId && recipientUserId !== req.userId) {
        const notificationId = uuidv4();
        // If followee is AI, the recipient_profile_id is the AI's ID
        const recipientProfileId = followee_type === 'ai' ? followee_id : recipientUserId;
        const actorProfileId = follower_id || req.userId;
        const actorType = follower_type || 'human';

        await db.query(
          `INSERT INTO notifications (id, user_id, recipient_profile_id, actor_id, actor_profile_id, actor_type, type, message) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            notificationId,
            recipientUserId,
            recipientProfileId,
            req.userId,
            actorProfileId,
            actorType,
            'follow',
            `started following you.`
          ]
        );
        await emitNotification(req.io, recipientUserId, notificationId);
      }
    } catch (notifErr) {
      console.error('[Follow Notification Error]', notifErr);
    }

    const counts = await getFollowCounts(followee_id, finalFollowerId);
    res.status(201).json({
      following: true,
      follower_count: counts.followee_followers,
      following_count: counts.follower_following,
    });

  } catch (err) {
    console.error('[POST /follows]', err);
    res.status(500).json({ message: 'Failed to update follow status' });
  }
});

async function getFollowCounts(followeeId, followerId) {
  const followeeFollowers = await db.queryOne('SELECT COUNT(*) as cnt FROM follows WHERE following_id = $1', [followeeId]);
  const followerFollowing = await db.queryOne('SELECT COUNT(*) as cnt FROM follows WHERE follower_id = $1', [followerId]);
  return {
    followee_followers: parseInt(followeeFollowers.cnt),
    follower_following: parseInt(followerFollowing.cnt),
  };
}

// ─── GET /follows/check — Check if following ─────────────────────────────────
router.get('/check', authMiddleware, async (req, res) => {
  try {
    const {
      followee_id,
      follower_id,
      follower_type = 'human',
    } = req.query;

    if (!followee_id) {
      return res.status(400).json({ message: 'followee_id required' });
    }

    let finalFollowerId = follower_id;
    if (!finalFollowerId) {
      finalFollowerId = req.userId;
    }

    const follow = await db.queryOne(
      'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2',
      [finalFollowerId, followee_id]
    );

    res.json({ following: !!follow });
  } catch (err) {
    res.status(500).json({ message: 'Failed to check follow status' });
  }
});

// ─── GET /follows/followers/:id ──────────────────────────────────────────────
router.get('/followers/:profileId', authMiddleware, async (req, res) => {
  try {
    const { profileId } = req.params;

    const rows = await db.queryMany(
      `SELECT f.follower_id,
              u.id         AS user_id,
              u.username   AS user_username,
              COALESCE(u.full_name, u.username) AS user_display_name,
              u.avatar_url AS user_avatar,
              u.is_verified AS user_is_verified,
              ai.user_id   AS ai_user_id,
              ai.username  AS ai_username,
              ai.display_name AS ai_display_name,
              ai.avatar    AS ai_avatar,
              ai.is_verified AS ai_is_verified,
              (ai.id IS NOT NULL) AS is_ai
       FROM follows f
       LEFT JOIN users u ON f.follower_id = u.id
       LEFT JOIN ai_profiles ai ON f.follower_id = ai.id
       WHERE f.following_id = $1`,
      [profileId]
    );

    const followers = rows.map(r => ({
      id: r.follower_id,
      user_id: r.is_ai ? r.ai_user_id : (r.user_id ?? r.follower_id),
      username: r.is_ai ? r.ai_username : r.user_username,
      display_name: r.is_ai ? r.ai_display_name : r.user_display_name,
      avatar: r.is_ai ? r.ai_avatar : r.user_avatar,
      is_verified: r.is_ai ? r.ai_is_verified : r.user_is_verified,
      is_ai: r.is_ai,
    }));

    res.json({ followers });
  } catch (err) {
    console.error('[GET /follows/followers]', err);
    res.status(500).json({ message: 'Failed to fetch followers' });
  }
});

// ─── GET /follows/following/:id ──────────────────────────────────────────────
router.get('/following/:profileId', authMiddleware, async (req, res) => {
  try {
    const { profileId } = req.params;

    const rows = await db.queryMany(
      `SELECT f.following_id,
              u.id         AS user_id,
              u.username   AS user_username,
              COALESCE(u.full_name, u.username) AS user_display_name,
              u.avatar_url AS user_avatar,
              u.is_verified AS user_is_verified,
              ai.user_id   AS ai_user_id,
              ai.username  AS ai_username,
              ai.display_name AS ai_display_name,
              ai.avatar    AS ai_avatar,
              ai.is_verified AS ai_is_verified,
              (ai.id IS NOT NULL) AS is_ai
       FROM follows f
       LEFT JOIN users u ON f.following_id = u.id
       LEFT JOIN ai_profiles ai ON f.following_id = ai.id
       WHERE f.follower_id = $1`,
      [profileId]
    );

    const following = rows.map(r => ({
      id: r.following_id,
      user_id: r.is_ai ? r.ai_user_id : (r.user_id ?? r.following_id),
      username: r.is_ai ? r.ai_username : r.user_username,
      display_name: r.is_ai ? r.ai_display_name : r.user_display_name,
      avatar: r.is_ai ? r.ai_avatar : r.user_avatar,
      is_verified: r.is_ai ? r.ai_is_verified : r.user_is_verified,
      is_ai: r.is_ai,
    }));

    res.json({ following });
  } catch (err) {
    console.error('[GET /follows/following]', err);
    res.status(500).json({ message: 'Failed to fetch following' });
  }
});

module.exports = router;
