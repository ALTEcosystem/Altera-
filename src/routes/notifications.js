const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const db = require('../db/database');

const router = express.Router();

// ─── GET /notifications ───────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { profile_id } = req.query;
    
    // Default to human user's notifications if no profile_id provided
    const targetProfileId = profile_id || req.userId;

    const rows = await db.queryMany(
      `SELECT n.*, 
              u.username as user_username, u.full_name as user_name, u.avatar_url as user_avatar, u.is_verified as user_is_verified,
              ai.username as ai_username, ai.display_name as ai_name, ai.avatar as ai_avatar, ai.is_verified as ai_is_verified,
              SUBSTRING(p.content, 1, 50) as post_snippet
       FROM notifications n
       LEFT JOIN users u ON n.actor_profile_id = u.id
       LEFT JOIN ai_profiles ai ON n.actor_profile_id = ai.id
       LEFT JOIN posts p ON n.post_id = p.id
       WHERE n.user_id = $1 AND (n.recipient_profile_id = $2 OR (n.recipient_profile_id IS NULL AND $2 = $1))
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [req.userId, targetProfileId]
    );

    const notifications = rows.map(n => {
      const isActorAI = n.actor_type === 'ai';
      return {
        id: n.id,
        user_id: n.user_id,
        recipient_profile_id: n.recipient_profile_id,
        actor_id: n.actor_id,
        actor_profile_id: n.actor_profile_id,
        actor_type: n.actor_type,
        actor_username: isActorAI ? n.ai_username : n.user_username,
        actor_name: isActorAI ? n.ai_name : n.user_name,
        actor_avatar: isActorAI ? n.ai_avatar : n.user_avatar,
        actor_is_verified: isActorAI ? n.ai_is_verified : n.user_is_verified,
        type: n.type,
        post_id: n.post_id,
        post_snippet: n.post_snippet,
        comment_id: n.comment_id,
        message: n.message,
        is_read: n.is_read,
        read_at: n.read_at,
        created_at: n.created_at,
      };
    });

    const unreadCount = await db.queryOne(
      'SELECT COUNT(*) as cnt FROM notifications WHERE user_id = $1 AND recipient_profile_id = $2 AND is_read = FALSE',
      [req.userId, targetProfileId]
    );

    res.json({ 
      notifications, 
      unread_count: parseInt(unreadCount.cnt) 
    });
  } catch (err) {
    console.error('[GET /notifications]', err);
    res.status(500).json({ message: 'Failed to fetch notifications' });
  }
});

// ─── POST /notifications/:id/read ─────────────────────────────────────────────
router.post('/:id/read', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Notification not found' });
    res.json({ message: 'Notification marked as read' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to mark notification as read' });
  }
});

// ─── POST /notifications/read-all ────────────────────────────────────────────
router.post('/read-all', authMiddleware, async (req, res) => {
  try {
    await db.query(
      'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE user_id = $1 AND is_read = FALSE',
      [req.userId]
    );
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to mark all notifications as read' });
  }
});

module.exports = router;
