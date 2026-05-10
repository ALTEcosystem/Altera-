const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth');
const db = require('../db/database');
const { storeImageDataUri } = require('../services/media_storage');

const router = express.Router();

// ─── Content Moderation: Keyword filter (M16-FE-1) ───────────────────────────
const BANNED_KEYWORDS = [
  'spam', 'scam', 'fake', 'phishing', 'porn', 'xxx', 'hate', 'kill',
  'terrorist', 'bomb', 'drugs', 'cocaine', 'meth',
];
const SUSPICIOUS_PATTERNS = [
  /(.)\1{9,}/,            // repeated characters (aaaaaaaaa)
  /https?:\/\/\S+/gi,     // excessive links – flag not ban
  /[A-Z\s]{30,}/,         // all-caps rage / spam (M16-FE-4)
];
// Additional semantic spam indicators (M16-FE-4)
const SPAM_INDICATORS = [
  /\b(buy now|click here|free money|earn \$|make money fast|limited offer|act now)\b/i,
  /(.{1,10})\1{4,}/,      // short phrase repeated 4+ times
];

function moderateContent(content) {
  for (const kw of BANNED_KEYWORDS) {
    const regex = new RegExp(`\\b${kw}\\b`, 'i');
    if (regex.test(content)) {
      return { blocked: true, reason: `Content violates policy: "${kw}"` };
    }
  }
  const suspicious = SUSPICIOUS_PATTERNS.some(p => p.test(content))
    || SPAM_INDICATORS.some(p => p.test(content));
  return { blocked: false, suspicious };
}

// ─── Conditional Publishing Quality Gate (M15-FE-1 Phase 4) ─────────────────
// Returns { pass: bool, reason: string | null }
function qualityGate(content, isAI) {
  if (!isAI) return { pass: true, reason: null }; // only applied to AI posts
  const trimmed = content.trim();
  if (trimmed.length < 10) {
    return { pass: false, reason: 'AI post is too short to be meaningful (min 10 characters)' };
  }
  // All-caps check (looks like shouting / spam)
  const alphaOnly = trimmed.replace(/[^a-zA-Z]/g, '');
  if (alphaOnly.length > 15 && alphaOnly === alphaOnly.toUpperCase()) {
    return { pass: false, reason: 'AI post appears to be all-caps. Please use normal sentence casing.' };
  }
  // Repetitive filler check
  if (SPAM_INDICATORS.some(p => p.test(trimmed))) {
    return { pass: false, reason: 'AI post contains repetitive or spammy phrases' };
  }
  return { pass: true, reason: null };
}

// ─── Log activity helper (M14-FE-4) ──────────────────────────────────────────
async function logActivity(userId, action, targetType, targetId, aiProfileId = null, meta = {}) {
  try {
    await db.query(
      `INSERT INTO activity_log (user_id, ai_profile_id, action_type, target_type, target_id, meta)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, aiProfileId, action, targetType, targetId, JSON.stringify(meta)]
    );
  } catch (_) { /* non-critical */ }
}

async function emitNotification(io, recipientUserId, notificationId) {
  if (!io || !recipientUserId || !notificationId) return;

  const notification = await db.queryOne(
    `SELECT n.*,
            COALESCE(sai.display_name, u.full_name) as actor_name_full,
            COALESCE(sai.avatar, u.avatar_url) as actor_avatar_full,
            sai.is_verified as actor_ai_verified,
            u.is_verified as actor_user_verified,
            SUBSTRING(p.content, 1, 50) as post_snippet
     FROM notifications n
     LEFT JOIN users u ON n.actor_id = u.id
     LEFT JOIN ai_profiles sai ON n.actor_profile_id = sai.id AND n.actor_type = 'ai'
     LEFT JOIN posts p ON n.post_id = p.id
     WHERE n.id = $1`,
    [notificationId]
  );

  if (!notification) return;

  const payload = {
    id: notification.id,
    user_id: notification.user_id,
    actor_id: notification.actor_profile_id || notification.actor_id,
    actor_name: notification.actor_name_full || 'Someone',
    actor_avatar: notification.actor_avatar_full,
    actor_type: notification.actor_type,
    actor_is_verified: notification.actor_type === 'ai' ? !!notification.actor_ai_verified : !!notification.actor_user_verified,
    type: notification.type,
    post_id: notification.post_id,
    comment_id: notification.comment_id,
    post_snippet: notification.post_snippet,
    message: notification.message,
    is_read: notification.is_read,
    read_at: notification.read_at,
    created_at: notification.created_at,
  };

  io.to(`notifications:${recipientUserId}`).emit('notification:new', payload);
  io.to(`user:${recipientUserId}`).emit('notification:new', payload);
}

// ─── POST /posts ──────────────────────────────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { content, author_id, author_type, media_urls = [], scheduled_at } = req.body;
    console.log(`[POST /posts] Request from user ${req.userId} (type: ${author_type}, id: ${author_id})`);
    
    if (!content) {
      return res.status(400).json({ message: 'content is required' });
    }

    // M16-FE-1: Content moderation
    const mod = moderateContent(content);
    if (mod.blocked) {
      return res.status(422).json({ message: mod.reason, code: 'CONTENT_BLOCKED' });
    }

    const requestedAuthorType = author_type === 'ai' ? 'ai' : 'human';
    const isAI = requestedAuthorType === 'ai';
    let aiProfileId = null;

    // M14-FE-2: Verification check for AI profiles
    if (isAI) {
      if (!author_id) {
        return res.status(400).json({ message: 'author_id is required for AI posts' });
      }
      const aiProfile = await db.queryOne(
        'SELECT * FROM ai_profiles WHERE id = $1 AND user_id = $2',
        [author_id, req.userId],
      );
      if (!aiProfile) return res.status(403).json({ message: 'AI persona not found or not yours' });
      if (!aiProfile.is_verified) {
        return res.status(403).json({ message: 'Only AIT-verified AI personas can post', code: 'NOT_VERIFIED' });
      }
      aiProfileId = aiProfile.id;

      // M16-FE-2: Rate limit check
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const postCount = await db.queryOne(
        `SELECT COUNT(*) as cnt FROM posts 
         WHERE ai_profile_id = $1 AND created_at >= $2 AND deleted_at IS NULL`,
        [aiProfileId, today.toISOString()]
      );
      const limit = aiProfile.daily_post_limit || 20;
      if (parseInt(postCount.cnt) >= limit) {
        // M16-FE-3: Log anomaly if way over limit
        if (parseInt(postCount.cnt) >= limit * 1.5) {
          await db.query(
            `INSERT INTO ai_anomaly_flags (ai_profile_id, flag_type, severity, description)
             VALUES ($1, 'rate_exceeded', 'high', $2)`,
            [aiProfileId, `AI posted ${postCount.cnt} times today, limit is ${limit}`]
          );
        }
        return res.status(429).json({ message: `Daily post limit (${limit}) reached for this AI`, code: 'RATE_LIMITED' });
      }
    }

    // M15-FE-1 (Phase 4): Conditional publishing quality gate (AI only)
    if (isAI) {
      const qg = qualityGate(content, true);
      if (!qg.pass) {
        return res.status(422).json({ message: qg.reason, code: 'QUALITY_GATE' });
      }
    }

    // M15-FE-3: Determine post status (approval flow vs autonomy)
    let postStatus = 'published';
    let resolvedScheduledAt = scheduled_at || null;

    if (scheduled_at) {
      postStatus = 'scheduled';
    } else if (isAI) {
      const aiProfile = await db.queryOne('SELECT autonomy_enabled, user_id FROM ai_profiles WHERE id = $1', [aiProfileId]);
      
      // If the requester is the owner, publish immediately. 
      // Otherwise (if generated by AI worker), check autonomy.
      const isOwner = aiProfile?.user_id === req.userId;
      
      if (!isOwner && !aiProfile?.autonomy_enabled) {
        postStatus = 'pending_approval';
      }
    }

    // Extract hashtags from content
    const hashtags = (content.match(/#\w+/g) || []).map(t => t.slice(1).toLowerCase());

    // Process media_urls for base64 images
    let finalMediaUrls = [];
    if (Array.isArray(media_urls)) {
      for (const url of media_urls) {
        if (url && url.startsWith('data:image')) {
          const storedUrl = await storeImageDataUri({
            userId: req.userId,
            dataUri: url,
            purpose: 'post',
          });
          finalMediaUrls.push(storedUrl || url);
        } else {
          finalMediaUrls.push(url);
        }
      }
    }

    // M16-FE-4: Detect suspicious content and mark post for review
    const modCheck = moderateContent(content);
    const isFlagged = modCheck.suspicious;
    const flagReason = isFlagged ? 'Suspicious content pattern detected' : null;

    const result = await db.queryOne(
      `INSERT INTO posts (id, user_id, ai_profile_id, content, media_urls, ai_generated, status, scheduled_at, hashtags, is_flagged, flag_reason) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [uuidv4(), req.userId, aiProfileId, content, finalMediaUrls, isAI, postStatus, resolvedScheduledAt, hashtags, isFlagged, flagReason]
    );

    // Fetch author info for the response
    let authorInfo;
    if (isAI) {
      authorInfo = await db.queryOne('SELECT * FROM ai_profiles WHERE id = $1', [aiProfileId]);
    } else {
      authorInfo = await db.queryOne(
        'SELECT id, username, full_name as display_name, avatar_url as avatar, is_verified FROM users WHERE id = $1',
        [req.userId]
      );
    }

    if (!authorInfo) {
      console.error(`[POST /posts] Author not found for user ${req.userId}. Body:`, req.body);
      return res.status(401).json({ message: 'Author profile not found. Please log out and log back in.' });
    }

    // Log activity (M14-FE-4)
    await logActivity(req.userId, 'post_created', 'post', result.id, aiProfileId, { status: postStatus, is_ai: isAI });

    const post = {
      ...result,
      author_id: isAI ? aiProfileId : req.userId,
      author_user_id: req.userId,
      author_type: isAI ? 'ai' : 'human',
      author_username: authorInfo.username,
      author_display_name: authorInfo.display_name,
      author_avatar: authorInfo.avatar,
      author_is_verified: authorInfo.is_verified,
      published_at: result.created_at,
      has_reacted: false,
      is_following_author: false,
      reaction_count: 0,
      comment_count: 0,
    };

    const message = postStatus === 'pending_approval'
      ? 'Post submitted for your approval'
      : postStatus === 'scheduled'
      ? 'Post scheduled successfully'
      : 'Post created';

    res.status(201).json({ post, status: postStatus, message });
  } catch (err) {
    console.error('[POST /posts]', err);
    res.status(500).json({ message: 'Failed to create post' });
  }
});

// ─── GET /posts/flagged ── Flagged / suspicious posts for moderation review (M16-FE-5) ──
router.get('/flagged', authMiddleware, async (req, res) => {
  try {
    const rows = await db.queryMany(
      `SELECT p.*,
              u.username as user_username, u.full_name as user_display_name,
              ai.username as ai_username, ai.display_name as ai_display_name,
              cr.reason as report_reason, cr.created_at as reported_at
       FROM posts p
       JOIN users u ON p.user_id = u.id
       LEFT JOIN ai_profiles ai ON p.ai_profile_id = ai.id
       LEFT JOIN content_reports cr ON cr.post_id = p.id
       WHERE (p.is_flagged = TRUE OR cr.id IS NOT NULL)
         AND p.user_id = $1
         AND p.deleted_at IS NULL
       ORDER BY p.created_at DESC
       LIMIT 50`,
      [req.userId]
    );

    const posts = rows.map(p => ({
      id: p.id,
      content: p.content,
      created_at: p.created_at,
      is_flagged: p.is_flagged,
      flag_reason: p.flag_reason,
      report_reason: p.report_reason,
      reported_at: p.reported_at,
      author_username: p.ai_profile_id ? p.ai_username : p.user_username,
      author_display_name: p.ai_profile_id ? p.ai_display_name : p.user_display_name,
      author_type: p.ai_generated ? 'ai' : 'human',
      status: p.status,
    }));

    res.json({ posts });
  } catch (err) {
    console.error('[GET /posts/flagged]', err);
    res.status(500).json({ message: 'Failed to fetch flagged posts' });
  }
});

// ─── GET /posts/pending ── AI posts awaiting human approval (M15-FE-3) ────────
router.get('/pending', authMiddleware, async (req, res) => {
  try {
    const rows = await db.queryMany(
      `SELECT p.*, 
              ai.username as ai_username, ai.display_name as ai_display_name, 
              ai.avatar as ai_avatar, ai.is_verified as ai_is_verified
       FROM posts p
       JOIN ai_profiles ai ON p.ai_profile_id = ai.id
       WHERE p.user_id = $1 AND p.status = 'pending_approval' AND p.deleted_at IS NULL
       ORDER BY p.created_at DESC`,
      [req.userId]
    );

    const posts = rows.map(p => ({
      ...p,
      author_id: p.ai_profile_id,
      author_type: 'ai',
      author_username: p.ai_username,
      author_display_name: p.ai_display_name,
      author_avatar: p.ai_avatar,
      author_is_verified: p.ai_is_verified,
      published_at: p.created_at,
      reaction_count: p.like_count,
    }));

    res.json({ posts });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch pending posts' });
  }
});

// ─── POST /posts/:id/approve (M15-FE-3) ──────────────────────────────────────
router.post('/:id/approve', authMiddleware, async (req, res) => {
  try {
    const post = await db.queryOne('SELECT * FROM posts WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    if (post.status !== 'pending_approval') return res.status(400).json({ message: 'Post is not pending approval' });

    await db.query(
      `UPDATE posts SET status = 'published', approved_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [req.params.id]
    );

    await logActivity(req.userId, 'post_approved', 'post', req.params.id, post.ai_profile_id);
    res.json({ message: 'Post approved and published' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to approve post' });
  }
});

// ─── POST /posts/:id/reject (M15-FE-3) ───────────────────────────────────────
router.post('/:id/reject', authMiddleware, async (req, res) => {
  try {
    const post = await db.queryOne('SELECT * FROM posts WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    await db.query('UPDATE posts SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [req.params.id]);
    await logActivity(req.userId, 'post_rejected', 'post', req.params.id, post.ai_profile_id);
    res.json({ message: 'Post rejected and removed' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to reject post' });
  }
});

// ─── GET /posts/:id ───────────────────────────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const post = await db.queryOne(`
      SELECT p.*, 
             u.username as user_username, u.full_name as user_display_name, u.avatar_url as user_avatar, u.is_verified as user_is_verified,
             ai.username as ai_username, ai.display_name as ai_display_name, ai.avatar as ai_avatar, ai.is_verified as ai_is_verified
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN ai_profiles ai ON p.ai_profile_id = ai.id
      WHERE p.id = $1 AND p.deleted_at IS NULL
    `, [req.params.id]);

    if (!post) return res.status(404).json({ message: 'Post not found' });

    const isAI = post.ai_generated;
    const formattedPost = {
      ...post,
      author_id: isAI ? post.ai_profile_id : post.user_id,
      author_type: isAI ? 'ai' : 'human',
      author_username: isAI ? post.ai_username : post.user_username,
      author_display_name: isAI ? post.ai_display_name : post.user_display_name,
      author_avatar: isAI ? post.ai_avatar : post.user_avatar,
      author_is_verified: isAI ? post.ai_is_verified : post.user_is_verified,
      published_at: post.created_at,
      reaction_count: post.like_count,
    };

    const comments = await db.queryMany(`
      SELECT c.*, u.username, u.full_name as display_name, u.avatar_url as avatar,
             ai.username as ai_username, ai.display_name as ai_display_name, ai.avatar as ai_avatar
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN ai_profiles ai ON c.ai_profile_id = ai.id
      WHERE c.post_id = $1
      ORDER BY c.created_at ASC
    `, [req.params.id]);

    const formattedComments = comments.map(c => {
      const isAI = !!c.ai_profile_id;
      return {
        ...c,
        author_id: isAI ? c.ai_profile_id : c.user_id,
        author_username: isAI ? c.ai_username : c.username,
        author_display_name: isAI ? c.ai_display_name : c.display_name,
        author_avatar: isAI ? c.ai_avatar : c.avatar,
        author_type: isAI ? 'ai' : 'human',
      };
    });

    res.json({ post: formattedPost, comments: formattedComments });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch post' });
  }
});

// ─── GET /posts/:id/comments — Dedicated route for comments (M14-FE-2) ───────
router.get('/:id/comments', authMiddleware, async (req, res) => {
  try {
    const comments = await db.queryMany(`
      SELECT c.*, u.username, u.full_name as display_name, u.avatar_url as avatar,
             ai.username as ai_username, ai.display_name as ai_display_name, ai.avatar as ai_avatar,
             EXISTS(SELECT 1 FROM likes l WHERE l.comment_id = c.id AND l.user_id = $2) as has_reacted
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN ai_profiles ai ON c.ai_profile_id = ai.id
      WHERE c.post_id = $1
      ORDER BY c.created_at ASC
    `, [req.params.id, req.userId]);

    const formattedComments = comments.map(c => {
      const isAI = !!c.ai_profile_id;
      return {
        ...c,
        author_id: isAI ? c.ai_profile_id : c.user_id,
        author_username: isAI ? c.ai_username : c.username,
        author_display_name: isAI ? c.ai_display_name : c.display_name,
        author_avatar: isAI ? c.ai_avatar : c.avatar,
        author_type: isAI ? 'ai' : 'human',
      };
    });

    res.json({ comments: formattedComments });
  } catch (err) {
    console.error('[GET /posts/:id/comments]', err);
    res.status(500).json({ message: 'Failed to fetch comments' });
  }
});

// ─── POST /posts/:id/react ────────────────────────────────────────────────────
router.post('/:id/react', authMiddleware, async (req, res) => {
  try {
    const existing = await db.queryOne('SELECT id FROM likes WHERE user_id = $1 AND post_id = $2', [req.userId, req.params.id]);
    
    if (existing) {
      await db.query('DELETE FROM likes WHERE id = $1', [existing.id]);
      await db.query('UPDATE posts SET like_count = GREATEST(0, like_count - 1) WHERE id = $1', [req.params.id]);
      const post = await db.queryOne('SELECT like_count FROM posts WHERE id = $1', [req.params.id]);
      return res.json({ reacted: false, reaction_count: post.like_count });
    }

    await db.query('INSERT INTO likes (user_id, post_id) VALUES ($1, $2)', [req.userId, req.params.id]);
    await db.query('UPDATE posts SET like_count = like_count + 1 WHERE id = $1', [req.params.id]);
    const post = await db.queryOne('SELECT like_count FROM posts WHERE id = $1', [req.params.id]);
    
    await logActivity(req.userId, 'post_liked', 'post', req.params.id);

    // ─── Create Notification ───
    try {
      const post = await db.queryOne('SELECT user_id, ai_profile_id FROM posts WHERE id = $1', [req.params.id]);
      if (post && post.user_id !== req.userId) {
        const notificationId = uuidv4();
        const recipientProfileId = post.ai_profile_id || post.user_id;
        const { author_id, author_type } = req.body;
        const actorProfileId = (author_type === 'ai' ? author_id : null) || req.userId;
        const actorType = author_type || 'human';

        await db.query(
          `INSERT INTO notifications (id, user_id, recipient_profile_id, actor_id, actor_profile_id, actor_type, type, post_id, message) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [notificationId, post.user_id, recipientProfileId, req.userId, actorProfileId, actorType, 'reaction', req.params.id, 'liked your post.']
        );
        await emitNotification(req.io, post.user_id, notificationId);
      }
    } catch (e) { console.error('[Like Notif Error]', e); }

    res.json({ reacted: true, reaction_count: post.like_count });
  } catch (err) {
    res.status(500).json({ message: 'Reaction failed' });
  }
});

// ─── POST /posts/:id/comments ─────────────────────────────────────────────────
router.post('/:id/comments', authMiddleware, async (req, res) => {
  try {
    const { content, author_id, author_type } = req.body;
    if (!content) return res.status(400).json({ message: 'Content required' });

    const mod = moderateContent(content);
    if (mod.blocked) return res.status(422).json({ message: mod.reason });

    const isAI = author_type === 'ai';
    const aiProfileId = isAI ? author_id : null;

    const result = await db.queryOne(
      'INSERT INTO comments (post_id, user_id, content, ai_profile_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.id, req.userId, content, aiProfileId]
    );

    await db.query('UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1', [req.params.id]);

    let authorInfo;
    if (isAI) {
      authorInfo = await db.queryOne(
        'SELECT username, display_name, avatar FROM ai_profiles WHERE id = $1',
        [aiProfileId]
      );
    } else {
      authorInfo = await db.queryOne(
        'SELECT username, full_name as display_name, avatar_url as avatar FROM users WHERE id = $1',
        [req.userId]
      );
    }

    await logActivity(req.userId, 'comment_added', 'post', req.params.id);

    // ─── Real-time broadcast (M14-FE-2) ───
    req.io.to(`post:${req.params.id}`).emit('comment:new', {
      ...result,
      author_id: isAI ? aiProfileId : req.userId,
      author_type: isAI ? 'ai' : 'human',
      author_username: authorInfo.username,
      author_display_name: authorInfo.display_name,
      author_avatar: authorInfo.avatar,
    });

    // ─── Create Notification ───
    try {
      const post = await db.queryOne('SELECT user_id, ai_profile_id FROM posts WHERE id = $1', [req.params.id]);
      if (post && post.user_id !== req.userId) {
        const notificationId = uuidv4();
        const recipientProfileId = post.ai_profile_id || post.user_id;
        const actorProfileId = (author_type === 'ai' ? author_id : null) || req.userId;
        const actorType = author_type || 'human';

        await db.query(
          `INSERT INTO notifications (id, user_id, recipient_profile_id, actor_id, actor_profile_id, actor_type, type, post_id, comment_id, message) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [notificationId, post.user_id, recipientProfileId, req.userId, actorProfileId, actorType, 'comment', req.params.id, result.id, 'commented on your post.']
        );
        await emitNotification(req.io, post.user_id, notificationId);
      }
    } catch (e) { console.error('[Comment Notif Error]', e); }

    res.status(201).json({
      comment: {
        ...result,
        author_id: isAI ? aiProfileId : req.userId,
        author_type: isAI ? 'ai' : 'human',
        author_username: authorInfo.username,
        author_display_name: authorInfo.display_name,
        author_avatar: authorInfo.avatar,
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to add comment' });
  }
});

// ─── POST /posts/:id/comments/:commentId/react (Comment Likes) ───────────────
router.post('/:id/comments/:commentId/react', authMiddleware, async (req, res) => {
  try {
    const { commentId } = req.params;
    const existing = await db.queryOne(
      'SELECT id FROM likes WHERE user_id = $1 AND comment_id = $2',
      [req.userId, commentId]
    );

    if (existing) {
      await db.query('DELETE FROM likes WHERE id = $1', [existing.id]);
      await db.query('UPDATE comments SET like_count = GREATEST(0, like_count - 1) WHERE id = $1', [commentId]);
      const comment = await db.queryOne('SELECT like_count FROM comments WHERE id = $1', [commentId]);
      return res.json({ reacted: false, reaction_count: comment.like_count });
    }

    await db.query('INSERT INTO likes (user_id, comment_id) VALUES ($1, $2)', [req.userId, commentId]);
    await db.query('UPDATE comments SET like_count = like_count + 1 WHERE id = $1', [commentId]);
    const comment = await db.queryOne('SELECT like_count FROM comments WHERE id = $1', [commentId]);

    // Create Notification
    try {
      const cAuthor = await db.queryOne('SELECT user_id, post_id FROM comments WHERE id = $1', [commentId]);
      if (cAuthor && cAuthor.user_id !== req.userId) {
        const notificationId = uuidv4();
        await db.query(
          `INSERT INTO notifications (id, user_id, actor_id, type, post_id, comment_id, message) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [notificationId, cAuthor.user_id, req.userId, 'reaction', cAuthor.post_id, commentId, 'liked your comment.']
        );
        await emitNotification(req.io, cAuthor.user_id, notificationId);
      }
    } catch (e) { console.error('[Comment Like Notif Error]', e); }

    res.json({ reacted: true, reaction_count: comment.like_count });
  } catch (err) {
    res.status(500).json({ message: 'Comment reaction failed' });
  }
});

// ─── DELETE /posts/:id/comments/:commentId ───────────────────────────────────
router.delete('/:id/comments/:commentId', authMiddleware, async (req, res) => {
  try {
    const { id: postId, commentId } = req.params;
    const comment = await db.queryOne('SELECT user_id FROM comments WHERE id = $1', [commentId]);
    const post = await db.queryOne('SELECT user_id FROM posts WHERE id = $1', [postId]);

    if (!comment) return res.status(404).json({ message: 'Comment not found' });

    // Allowed if: commenter OR post owner
    if (comment.user_id !== req.userId && post.user_id !== req.userId) {
      return res.status(403).json({ message: 'Not authorized to delete this comment' });
    }

    await db.query('DELETE FROM comments WHERE id = $1', [commentId]);
    await db.query('UPDATE posts SET comment_count = GREATEST(0, comment_count - 1) WHERE id = $1', [postId]);

    res.json({ message: 'Comment deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete comment' });
  }
});

// ─── POST /posts/:id/comments/:commentId/report ──────────────────────────────
router.post('/:id/comments/:commentId/report', authMiddleware, async (req, res) => {
  try {
    const { reason, details } = req.body;
    if (!reason) return res.status(400).json({ message: 'Reason is required' });

    const comment = await db.queryOne('SELECT id FROM comments WHERE id = $1', [req.params.commentId]);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });

    await db.query(
      `INSERT INTO content_reports (reporter_id, comment_id, reason, details)
       VALUES ($1, $2, $3, $4)`,
      [req.userId, req.params.commentId, reason, details || null]
    );

    // Deduct health score from comment author
    const commentAuthor = await db.queryOne('SELECT user_id, ai_profile_id FROM comments WHERE id = $1', [req.params.commentId]);
    if (commentAuthor) {
      if (commentAuthor.ai_profile_id) {
        await db.query('UPDATE ai_profiles SET health_score = GREATEST(0, COALESCE(health_score, 100.0) - 5.0) WHERE id = $1', [commentAuthor.ai_profile_id]);
      } else {
        await db.query('UPDATE users SET health_score = GREATEST(0, COALESCE(health_score, 100.0) - 5.0) WHERE id = $1', [commentAuthor.user_id]);
      }
      console.log(`[Moderation] Deducted 5.0 health points from author of comment ${req.params.commentId}`);
    }

    await logActivity(req.userId, 'comment_reported', 'comment', req.params.commentId, null, { reason });
    res.json({ message: 'Report submitted. Our team will review it.' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to submit report' });
  }
});

// ─── POST /posts/:id/report (M16-FE-1) ───────────────────────────────────────
router.post('/:id/report', authMiddleware, async (req, res) => {
  try {
    const { reason, details } = req.body;
    if (!reason) return res.status(400).json({ message: 'Reason is required' });

    const post = await db.queryOne('SELECT id FROM posts WHERE id = $1', [req.params.id]);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    await db.query(
      `INSERT INTO content_reports (reporter_id, post_id, reason, details)
       VALUES ($1, $2, $3, $4)`,
      [req.userId, req.params.id, reason, details || null]
    );

    // Deduct health score from post author
    const postAuthor = await db.queryOne('SELECT user_id, ai_profile_id, ai_generated FROM posts WHERE id = $1', [req.params.id]);
    if (postAuthor) {
      if (postAuthor.ai_generated && postAuthor.ai_profile_id) {
        await db.query('UPDATE ai_profiles SET health_score = GREATEST(0, COALESCE(health_score, 100.0) - 5.0) WHERE id = $1', [postAuthor.ai_profile_id]);
      } else {
        await db.query('UPDATE users SET health_score = GREATEST(0, COALESCE(health_score, 100.0) - 5.0) WHERE id = $1', [postAuthor.user_id]);
      }
      console.log(`[Moderation] Deducted 5.0 health points from author of post ${req.params.id}`);
    }

    await logActivity(req.userId, 'post_reported', 'post', req.params.id, null, { reason });
    res.json({ message: 'Report submitted. Our team will review it.' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to submit report' });
  }
});

// ─── DELETE /posts/:id ────────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const post = await db.queryOne('SELECT user_id FROM posts WHERE id = $1', [req.params.id]);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    if (post.user_id !== req.userId) {
      return res.status(403).json({ message: 'You can only delete your own posts' });
    }
    await db.query('UPDATE posts SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [req.params.id]);
    await logActivity(req.userId, 'post_deleted', 'post', req.params.id);
    res.json({ message: 'Post deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete post' });
  }
});

module.exports = router;
module.exports.logActivity = logActivity;
