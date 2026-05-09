const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const db = require('../db/database');

const router = express.Router();

// ─── GET /feed ─── M13-FE-4/6: topic, hashtag & engagement filters ────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const {
      tab = 'feed',
      limit = 20,
      cursor,
      hashtag,
      sort_by,
      topic,
      ai_category,
    } = req.query;
    const lim = Math.min(parseInt(limit, 10) || 20, 50);
    const normalizedTopic = topic?.trim().toLowerCase();
    const normalizedCategory = ai_category?.trim().toLowerCase();

    const aiCategoryExpression = `
      CASE
        WHEN ai.bio ILIKE '%companion%' OR ai.bio ILIKE '%engage%' THEN 'companion'
        WHEN ai.bio ILIKE '%creative%' OR ai.bio ILIKE '%poetry%' OR ai.bio ILIKE '%art%' THEN 'creative'
        WHEN ai.bio ILIKE '%technical%' OR ai.bio ILIKE '%web3%' OR ai.bio ILIKE '%defi%' OR ai.bio ILIKE '%market%' THEN 'technical'
        ELSE 'general'
      END
    `;

    let query = `
      SELECT p.*, 
             u.username as user_username, u.full_name as user_display_name, u.avatar_url as user_avatar, u.is_verified as user_is_verified,
             ai.username as ai_username, ai.display_name as ai_display_name, ai.avatar as ai_avatar, ai.is_verified as ai_is_verified,
             ${aiCategoryExpression} as ai_category,
             EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $1) as has_reacted,
             EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = COALESCE(p.ai_profile_id, p.user_id)) as is_following_author
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN ai_profiles ai ON p.ai_profile_id = ai.id
      WHERE p.deleted_at IS NULL AND p.status = 'published'
    `;
    const params = [req.userId];

    // Tab filtering
    if (tab === 'ai') {
      query += ` AND p.ai_generated = TRUE`;
    } else if (tab === 'human' || tab === 'humans') {
      query += ` AND p.ai_generated = FALSE`;
    }

    // M13-FE-4: Hashtag filter
    if (hashtag) {
      params.push(hashtag.replace('#', '').toLowerCase());
      query += ` AND $${params.length} = ANY(p.hashtags)`;
    }

    if (normalizedTopic) {
      params.push(normalizedTopic, `%${normalizedTopic}%`);
      const tagParam = params.length - 1;
      const contentParam = params.length;
      query += `
        AND (
          $${tagParam} = ANY(p.hashtags)
          OR LOWER(p.content) LIKE $${contentParam}
        )
      `;
    }

    if (normalizedCategory) {
      params.push(normalizedCategory);
      query += ` AND p.ai_generated = TRUE AND ${aiCategoryExpression} = $${params.length}`;
    }

    // Sorting (M13-FE-4: engagement level)
    if (tab === 'trending' || sort_by === 'engagement') {
      query += ` ORDER BY (p.like_count * 2 + p.comment_count * 3) DESC, p.created_at DESC`;
    } else if (sort_by === 'top') {
      query += ` ORDER BY p.like_count DESC, p.created_at DESC`;
    } else {
      query += ` ORDER BY p.created_at DESC`;
    }

    params.push(lim);
    query += ` LIMIT $${params.length}`;

    const rows = await db.queryMany(query, params);

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
        ai_category: post.ai_category,
        is_following_author: post.is_following_author,
      };
    });

    res.json({
      posts: formattedPosts,
      next_cursor: rows.length === lim ? rows[rows.length - 1].id : null,
      has_more: rows.length === lim,
      tab,
      topic: normalizedTopic ?? null,
      ai_category: normalizedCategory ?? null,
    });
  } catch (err) {
    console.error('[GET /feed]', err);
    res.status(500).json({ message: 'Failed to fetch feed' });
  }
});

module.exports = router;
