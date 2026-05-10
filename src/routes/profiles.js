const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const db = require('../db/database');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

let aiCategoryColumnExists;

async function hasAICategoryColumn() {
  if (typeof aiCategoryColumnExists === 'boolean') {
    return aiCategoryColumnExists;
  }

  const row = await db.queryOne(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_name = 'ai_profiles' AND column_name = 'category'
     ) as exists`
  );

  aiCategoryColumnExists = !!row?.exists;
  return aiCategoryColumnExists;
}

function deriveAIMetadata(profile) {
  const category =
    typeof profile?.category === 'string' && profile.category.trim().length > 0
      ? profile.category.trim().toLowerCase()
      : 'general';

  let modelIdentity = 'ALTERA Social Core';
  let traits = ['Adaptive', 'Social'];
  if (category === 'companion') {
    modelIdentity = 'ALTERA Companion Core';
    traits = ['Empathetic', 'Conversational'];
  } else if (category === 'creative') {
    modelIdentity = 'ALTERA Creative Core';
    traits = ['Creative', 'Expressive'];
  } else if (category === 'technical') {
    modelIdentity = 'ALTERA Technical Core';
    traits = ['Analytical', 'Strategic'];
  }

  if (profile?.health_score >= 95) traits.push('High-Trust');
  if (profile?.autonomy_enabled) {
    traits.push('Autonomous');
  } else {
    traits.push('Human-Guided');
  }
  if (profile?.is_verified) traits.push('AIT-Verified');

  return {
    category,
    model_identity: modelIdentity,
    personality_traits: traits,
  };
}

// ─── GET /profiles/me/insights — Real engagement metrics (M15-FE-4) ───────────
router.get('/me/insights', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;

    // Total posts, likes received, comments received
    const postStats = await db.queryOne(
      `SELECT 
         COUNT(*) as total_posts,
         COALESCE(SUM(like_count), 0) as total_likes,
         COALESCE(SUM(comment_count), 0) as total_comments,
         COALESCE(SUM(view_count), 0) as total_views
       FROM posts 
       WHERE user_id = $1 AND deleted_at IS NULL AND status = 'published'`,
      [userId]
    );

    // Follower count
    const followerData = await db.queryOne(
      `SELECT COUNT(*) as followers FROM follows WHERE following_id = $1`,
      [userId]
    );
    const followingData = await db.queryOne(
      `SELECT COUNT(*) as following FROM follows WHERE follower_id = $1`,
      [userId]
    );

    // Posts this week
    const weeklyPosts = await db.queryOne(
      `SELECT COUNT(*) as weekly_posts, COALESCE(SUM(like_count),0) as weekly_likes
        FROM posts 
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '7 days' AND deleted_at IS NULL AND status = 'published'`,
      [userId]
    );

    // AI-specific metrics — Phase 4: includes weekly per-AI stats
    const aiStats = await db.queryMany(
      `SELECT ai.id, ai.username, ai.display_name, ai.health_score,
              COUNT(DISTINCT CASE WHEN p.status = 'published' THEN p.id END) as post_count,
              COALESCE(SUM(CASE WHEN p.status = 'published' THEN p.like_count ELSE 0 END), 0) as total_likes,
              COALESCE(SUM(CASE WHEN p.status = 'published' THEN p.comment_count ELSE 0 END), 0) as total_comments,
              ai.autonomy_enabled, ai.daily_post_limit,
              COALESCE(SUM(CASE WHEN p.status = 'published' AND p.created_at > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END), 0) as weekly_posts,
              COALESCE(SUM(CASE WHEN p.status = 'published' AND p.created_at > NOW() - INTERVAL '7 days' THEN p.like_count ELSE 0 END), 0) as weekly_likes,
              COALESCE(SUM(CASE WHEN p.status = 'published' AND p.created_at > NOW() - INTERVAL '7 days' THEN p.comment_count ELSE 0 END), 0) as weekly_comments,
              COUNT(DISTINCT CASE WHEN p.status = 'pending_approval' THEN p.id END) as pending_count,
              COUNT(DISTINCT CASE WHEN p.is_flagged = TRUE THEN p.id END) as flagged_count
       FROM ai_profiles ai
       LEFT JOIN posts p ON p.ai_profile_id = ai.id AND p.deleted_at IS NULL
       WHERE ai.user_id = $1
       GROUP BY ai.id`,
      [userId]
    );

    // Pending AI posts
    const pendingCount = await db.queryOne(
      `SELECT COUNT(*) as cnt FROM posts 
       WHERE user_id = $1 AND status = 'pending_approval' AND deleted_at IS NULL`,
      [userId]
    );

    // Average interactions per post: (likes + comments) / posts
    const totalPosts = parseInt(postStats.total_posts) || 0;
    const totalEngagement = parseInt(postStats.total_likes) + parseInt(postStats.total_comments);
    const avgInteraction = totalPosts > 0
      ? (totalEngagement / totalPosts).toFixed(1)
      : '0.0';

    res.json({
      profile: {
        total_posts: parseInt(postStats.total_posts),
        total_likes: parseInt(postStats.total_likes),
        total_comments: parseInt(postStats.total_comments),
        total_views: parseInt(postStats.total_views),
        followers: parseInt(followerData.followers),
        following: parseInt(followingData.following),
        avg_interaction: parseFloat(avgInteraction),
        weekly_posts: parseInt(weeklyPosts.weekly_posts),
        weekly_likes: parseInt(weeklyPosts.weekly_likes),
        pending_approvals: parseInt(pendingCount.cnt),
      },
      ai_personas: aiStats.map(ai => ({
        id: ai.id,
        username: ai.username,
        display_name: ai.display_name,
        health_score: parseFloat(ai.health_score || 100),
        post_count: parseInt(ai.post_count),
        total_likes: parseInt(ai.total_likes),
        total_comments: parseInt(ai.total_comments),
        autonomy_enabled: ai.autonomy_enabled,
        daily_post_limit: ai.daily_post_limit,
        weekly_posts: parseInt(ai.weekly_posts),
        weekly_likes: parseInt(ai.weekly_likes),
        weekly_comments: parseInt(ai.weekly_comments),
        pending_count: parseInt(ai.pending_count),
        flagged_count: parseInt(ai.flagged_count),
        avg_interaction: (() => {
          const posts = parseInt(ai.post_count) || 0;
          const eng = parseInt(ai.total_likes) + parseInt(ai.total_comments);
          return posts > 0 ? parseFloat((eng / posts).toFixed(1)) : 0.0;
        })(),
      })),
    });
  } catch (err) {
    console.error('[GET /profiles/me/insights]', err);
    res.status(500).json({ message: 'Failed to fetch insights' });
  }
});

// ─── PATCH /profiles/ai/:id/autonomy — Toggle AI autonomy (M15-FE-3) ─────────
router.patch('/ai/:id/autonomy', authMiddleware, async (req, res) => {
  try {
    const { enabled } = req.body;
    const ai = await db.queryOne(
      'SELECT id FROM ai_profiles WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (!ai) return res.status(404).json({ message: 'AI persona not found' });

    await db.query(
      'UPDATE ai_profiles SET autonomy_enabled = $1 WHERE id = $2',
      [enabled, req.params.id]
    );

    res.json({ 
      message: enabled ? 'Autonomy enabled — AI posts will go live immediately' : 'Autonomy disabled — AI posts require your approval',
      autonomy_enabled: enabled 
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update autonomy setting' });
  }
});

// ─── GET /profiles/me/compliance — Compliance + moderation summary (M16-FE-6) ──────
router.get('/me/compliance', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;

    // Flagged posts count
    const flaggedCount = await db.queryOne(
      `SELECT COUNT(*) as cnt FROM posts WHERE user_id = $1 AND is_flagged = TRUE AND deleted_at IS NULL`,
      [userId]
    );

    // Reported posts count
    const reportedCount = await db.queryOne(
      `SELECT COUNT(*) as cnt FROM content_reports cr
       JOIN posts p ON cr.post_id = p.id
       WHERE p.user_id = $1`,
      [userId]
    );

    // Anomaly flags for AI personas
    const anomalyRows = await db.queryMany(
      `SELECT af.*, ai.username as ai_username, ai.display_name as ai_display_name
       FROM ai_anomaly_flags af
       JOIN ai_profiles ai ON af.ai_profile_id = ai.id
       WHERE ai.user_id = $1
       ORDER BY af.created_at DESC
       LIMIT 20`,
      [userId]
    );

    // Recent moderation activity
    const modActivity = await db.queryMany(
      `SELECT al.action_type, al.created_at, al.meta,
              ai.username as ai_username
       FROM activity_log al
       LEFT JOIN ai_profiles ai ON al.ai_profile_id = ai.id
       WHERE al.user_id = $1
         AND al.action_type IN ('post_approved','post_rejected','post_reported','post_created')
       ORDER BY al.created_at DESC
       LIMIT 30`,
      [userId]
    );

    // Content health score = 100 - (10 per flagged) - (20 per anomaly)
    const flagged = parseInt(flaggedCount.cnt) || 0;
    const anomalies = anomalyRows.length;
    const healthScore = Math.max(0, 100 - (flagged * 10) - (anomalies * 20));

    res.json({
      compliance: {
        flagged_posts: flagged,
        reported_posts: parseInt(reportedCount.cnt) || 0,
        anomaly_flags: anomalies,
        content_health_score: healthScore,
        status: healthScore >= 80 ? 'healthy' : healthScore >= 50 ? 'caution' : 'at_risk',
      },
      anomalies: anomalyRows.map(a => ({
        id: a.id,
        ai_username: a.ai_username,
        ai_display_name: a.ai_display_name,
        flag_type: a.flag_type,
        severity: a.severity,
        description: a.description,
        created_at: a.created_at,
        resolved: a.resolved || false,
      })),
      recent_activity: modActivity.map(a => ({
        action: a.action_type,
        timestamp: a.created_at,
        ai_username: a.ai_username,
        meta: a.meta,
      })),
    });
  } catch (err) {
    console.error('[GET /profiles/me/compliance]', err);
    res.status(500).json({ message: 'Failed to fetch compliance data' });
  }
});

// ─── POST /profiles/me/anomalies/:id/resolve — Dismiss an anomaly flag (M16-FE-7) ──
router.post('/me/anomalies/:id/resolve', authMiddleware, async (req, res) => {
  try {
    const anomaly = await db.queryOne(
      `SELECT af.* FROM ai_anomaly_flags af
       JOIN ai_profiles ai ON af.ai_profile_id = ai.id
       WHERE af.id = $1 AND ai.user_id = $2`,
      [req.params.id, req.userId]
    );
    if (!anomaly) return res.status(404).json({ message: 'Anomaly flag not found' });

    await db.query(
      `UPDATE ai_anomaly_flags SET resolved = TRUE, resolved_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [req.params.id]
    );

    res.json({ message: 'Anomaly flag marked as resolved' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to resolve anomaly' });
  }
});

// ─── GET /profiles/me/activity — Traceability audit log (M14-FE-4) ───────────────
router.get('/me/activity', authMiddleware, async (req, res) => {
  try {
    const { limit = 30 } = req.query;
    const rows = await db.queryMany(
      `SELECT al.*, ai.display_name as ai_name, ai.username as ai_username
       FROM activity_log al
       LEFT JOIN ai_profiles ai ON al.ai_profile_id = ai.id
       WHERE al.user_id = $1
       ORDER BY al.created_at DESC
       LIMIT $2`,
      [req.userId, parseInt(limit)]
    );
    res.json({ activities: rows });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch activity log' });
  }
});

// ─── GET /profiles/:id ────────────────────────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { type = 'human' } = req.query;
    const activeId = req.query.blocker_id || req.userId;

    let profile;
    if (type === 'ai') {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      if (isUuid) {
        profile = await db.queryOne('SELECT * FROM ai_profiles WHERE id = $1', [id]);
      } else {
        profile = await db.queryOne('SELECT * FROM ai_profiles WHERE username = $1', [id]);
      }
    } else {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      if (isUuid) {
        profile = await db.queryOne(
          'SELECT id, id as user_id, username, full_name as display_name, avatar_url as avatar, bio, is_verified, health_score FROM users WHERE id = $1',
          [id]
        );
      } else {
        profile = await db.queryOne(
          'SELECT id, id as user_id, username, full_name as display_name, avatar_url as avatar, bio, is_verified, health_score FROM users WHERE username = $1',
          [id]
        );
      }
    }

    if (!profile) {
      console.warn(`[GET /profiles/${id}] Profile not found (type: ${type})`);
      return res.status(404).json({ message: 'Profile not found' });
    }

    if (type === 'ai') {
      profile = {
        ...profile,
        ...deriveAIMetadata(profile),
      };
    }

    const postsQuery = `
      SELECT p.*, 
             u.username as user_username, u.full_name as user_display_name, u.avatar_url as user_avatar, u.is_verified as user_is_verified,
             ai.username as ai_username, ai.display_name as ai_display_name, ai.avatar as ai_avatar, ai.is_verified as ai_is_verified,
             EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $1) as has_reacted,
             EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = COALESCE(p.ai_profile_id, p.user_id)) as is_following_author
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN ai_profiles ai ON p.ai_profile_id = ai.id
      WHERE (p.ai_profile_id = $2 OR (p.ai_profile_id IS NULL AND p.user_id = $2))
        AND p.deleted_at IS NULL AND p.status = 'published'
      ORDER BY p.created_at DESC
      LIMIT 20
    `;

    const rows = await db.queryMany(postsQuery, [req.userId, profile.id]);

    const formattedPosts = rows.map(post => {
      const isAI = post.ai_generated;
      return {
        ...post,
        author_id: isAI ? post.ai_profile_id : post.user_id,
        author_user_id: post.user_id,
        author_type: isAI ? 'ai' : 'human',
        author_username: isAI ? post.ai_username : post.user_username,
        author_display_name: isAI ? post.ai_display_name : post.user_display_name,
        author_avatar: isAI ? post.ai_avatar : post.user_avatar,
        author_is_verified: isAI ? post.ai_is_verified : post.user_is_verified,
        published_at: post.created_at,
        reaction_count: post.like_count,
        comment_count: post.comment_count,
        has_reacted: post.has_reacted,
        is_following_author: post.is_following_author,
      };
    });

    // Get real follower and post counts
    const statsData = await db.queryOne(
      type === 'ai'
        ? `SELECT 
             (SELECT COUNT(*) FROM follows WHERE following_id = $1) as follower_count,
             0 as following_count,
             (SELECT COUNT(*) FROM posts WHERE ai_profile_id = $1 AND deleted_at IS NULL AND status = 'published') as post_count`
        : `SELECT 
             (SELECT COUNT(*) FROM follows WHERE following_id = $1) as follower_count,
             (SELECT COUNT(*) FROM follows WHERE follower_id = $1) as following_count,
             (SELECT COUNT(*) FROM posts WHERE user_id = $1 AND deleted_at IS NULL AND status = 'published') as post_count`,
      [profile.id]
    );

    const followCheck = await db.queryOne(
      'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2',
      [req.userId, profile.id]
    );

    // ─── Wrap in UserModel-compatible structure ───
    let userModel;
    if (type === 'ai') {
      userModel = {
        id: profile.user_id, // owner id
        email: '', // sensitive
        created_at: profile.created_at,
        human_profile: null,
        ai_profiles: await db.queryMany(
          'SELECT * FROM ai_profiles WHERE user_id = $1',
          [profile.user_id]
        )
      };
    } else {
      userModel = {
        id: profile.id,
        email: '',
        created_at: profile.created_at || new Date().toISOString(),
        human_profile: {
          ...profile,
          follower_count: parseInt(statsData.follower_count),
          following_count: parseInt(statsData.following_count),
          post_count: parseInt(statsData.post_count),
          is_following: !!followCheck,
        },
        ai_profiles: await db.queryMany(
          'SELECT * FROM ai_profiles WHERE user_id = $1',
          [profile.id]
        )
      };
    }

    // Check if blocked
    const blockCheck = await db.queryOne(
      'SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2',
      [activeId, profile.id]
    );

    res.json({
      profile: userModel,
      visiting_profile: {
        ...profile,
        follower_count: parseInt(statsData.follower_count),
        following_count: parseInt(statsData.following_count),
        post_count: parseInt(statsData.post_count),
        is_following: !!followCheck,
        is_blocked: !!blockCheck,
        is_ai: type === 'ai',
      },
      posts: formattedPosts,
    });
  } catch (err) {
    console.error('[GET /profiles/:id]', err);
    res.status(500).json({ message: 'Failed to fetch profile' });
  }
});

// ─── POST /profiles/:id/block ────────────────────────────────────────────────
router.post('/:id/block', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const activeId = req.query.blocker_id || req.userId;

    await db.query(
      'INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [activeId, id]
    );

    // Auto unfollow
    await db.query(
      'DELETE FROM follows WHERE (follower_id = $1 AND following_id = $2) OR (follower_id = $2 AND following_id = $1)',
      [activeId, id]
    );

    res.json({ message: 'Profile blocked' });
  } catch (err) {
    console.error('[POST /profiles/:id/block]', err);
    res.status(500).json({ message: 'Failed to block profile' });
  }
});

// ─── DELETE /profiles/:id/block ──────────────────────────────────────────────
router.delete('/:id/block', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const activeId = req.query.blocker_id || req.userId;

    await db.query(
      'DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2',
      [activeId, id]
    );

    res.json({ message: 'Profile unblocked' });
  } catch (err) {
    console.error('[DELETE /profiles/:id/block]', err);
    res.status(500).json({ message: 'Failed to unblock profile' });
  }
});

// ─── POST /profiles/ai ────────────────────────────────────────────────────────
router.post('/ai', authMiddleware, async (req, res) => {
  try {
    const { username, display_name, bio, category } = req.body;
    if (!username || !display_name) {
      return res.status(400).json({ message: 'username and display_name are required' });
    }

    const existing = await db.queryOne(
      'SELECT id FROM users WHERE username = $1 UNION SELECT id FROM ai_profiles WHERE username = $1',
      [username]
    );
    if (existing) return res.status(409).json({ message: 'Username is already taken' });

    const includeCategory = await hasAICategoryColumn();
    const ai = includeCategory
      ? await db.queryOne(
          `INSERT INTO ai_profiles (user_id, username, display_name, bio, category, is_verified) 
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [req.userId, username, display_name, bio || '', category || 'general', true]
        )
      : await db.queryOne(
          `INSERT INTO ai_profiles (user_id, username, display_name, bio, is_verified) 
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [req.userId, username, display_name, bio || '', true]
        );

    res.status(201).json({ profile: ai });
  } catch (err) {
    console.error('[POST /profiles/ai]', err);
    res.status(500).json({ message: 'Failed to create AI persona' });
  }
});


// ─── POST /profiles/:id/report ───────────────────────────────────────────────
router.post('/:id/report', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, details, profile_type = 'human' } = req.body;
    
    if (!reason) return res.status(400).json({ message: 'Reason is required' });

    // Verify profile exists
    let profile;
    if (profile_type === 'ai') {
      profile = await db.queryOne('SELECT id FROM ai_profiles WHERE id = $1', [id]);
    } else {
      profile = await db.queryOne('SELECT id FROM users WHERE id = $1', [id]);
    }

    if (!profile) return res.status(404).json({ message: 'Profile not found' });

    await db.query(
      `INSERT INTO content_reports (reporter_id, reported_profile_id, reason, details)
       VALUES ($1, $2, $3, $4)`,
      [req.userId, id, reason, details || null]
    );

    await db.query(
      `INSERT INTO activity_log (user_id, action_type, target_type, target_id, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.userId, 'profile_reported', 'profile', id, JSON.stringify({ reason, profile_type })]
    );

    // Deduct health score from reported profile (10 points for profile report)
    if (profile_type === 'ai') {
      await db.query('UPDATE ai_profiles SET health_score = GREATEST(0, COALESCE(health_score, 100.0) - 10.0) WHERE id = $1', [id]);
    } else {
      await db.query('UPDATE users SET health_score = GREATEST(0, COALESCE(health_score, 100.0) - 10.0) WHERE id = $1', [id]);
    }
    console.log(`[Moderation] Deducted 10.0 health points from profile ${id} (${profile_type})`);

    res.json({ message: 'Report submitted. Our team will review it.' });
  } catch (err) {
    console.error('[POST /profiles/:id/report]', err);
    res.status(500).json({ message: 'Failed to submit report' });
  }
});

module.exports = router;
