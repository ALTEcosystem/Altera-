const express = require('express');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

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

function filterPostsByTopic(posts, normalizedTopic) {
  if (!normalizedTopic) return posts;
  return posts.filter((post) => {
    const hashtags = (post.hashtags || []).map((tag) => `${tag}`.toLowerCase());
    const content = `${post.content || ''}`.toLowerCase();
    return hashtags.includes(normalizedTopic) || content.includes(normalizedTopic);
  });
}

router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q = '', limit = 20, topic, ai_category, scope = 'global', profile_id } = req.query;
    const query = q.trim();
    const normalizedTopic = topic?.trim().toLowerCase();
    const normalizedCategory = ai_category?.trim().toLowerCase();
    let activeProfileId = profile_id || req.userId;
    if (typeof activeProfileId === 'string' && activeProfileId.includes(':')) {
      activeProfileId = activeProfileId.split(':')[1];
    }
    
    if (!query && !normalizedTopic && !normalizedCategory) {
      return res.json({ posts: [], profiles: [], trending: [] });
    }

    const searchPattern = `%${query}%`;
    const lim = Math.min(parseInt(limit, 10) || 20, 50);

    let humanQuery = `
      SELECT id, id as user_id, username, full_name as display_name, avatar_url as avatar, is_verified,
             health_score, false as is_ai, 'human' as profile_type
      FROM users
      WHERE ($1 = '%%' OR username ILIKE $1 OR full_name ILIKE $1)
    `;

    let aiQuery = `
      SELECT id, user_id, username, display_name, avatar, is_verified,
             bio, ait_token_id, health_score, autonomy_enabled,
             true as is_ai, 'ai' as profile_type
      FROM ai_profiles
      WHERE ($1 = '%%' OR username ILIKE $1 OR display_name ILIKE $1 OR bio ILIKE $1)
    `;

    const queryParams = [searchPattern];

    if (scope === 'social') {
      // In social scope, only show profiles that the user follows OR who follow the user.
      const socialJoin = `
        AND id IN (
          SELECT followee_id FROM follows WHERE follower_id = $2 AND followee_type = $3
          UNION
          SELECT follower_id FROM follows WHERE followee_id = $2 AND follower_type = $3
        )
      `;
      humanQuery += socialJoin.replace(/\$3/g, "'human'");
      aiQuery += socialJoin.replace(/\$3/g, "'ai'");
      queryParams.push(activeProfileId);
    }

    humanQuery += ` LIMIT $${queryParams.length + 1}`;
    aiQuery += ` LIMIT $${queryParams.length + 1}`;
    
    const finalParams = [...queryParams, lim];

    const humans = await req.db.queryMany(humanQuery, finalParams);
    const aiRows = await req.db.queryMany(aiQuery, finalParams);

    const ais = aiRows
      .map((profile) => ({
        ...profile,
        ...deriveAIMetadata(profile),
      }))
      .filter((profile) => {
        if (!normalizedCategory) return true;
        return profile.category === normalizedCategory;
      });

    const shouldSearchPosts = !!query || !!normalizedTopic;
    let formattedPosts = [];
    if (shouldSearchPosts) {
      const isTagSearch = query.startsWith('#');
      const tagQuery = isTagSearch ? query.substring(1) : query;
      const postQuery = query ? searchPattern : '%%';

      const matchedPosts = await req.db.queryMany(
        `SELECT p.*, 
                u.username as user_username, u.full_name as user_display_name, u.avatar_url as user_avatar, u.is_verified as user_is_verified,
                ai.username as ai_username, ai.display_name as ai_display_name, ai.avatar as ai_avatar, ai.is_verified as ai_is_verified,
                EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $1) as has_reacted
         FROM posts p
         JOIN users u ON p.user_id = u.id
         LEFT JOIN ai_profiles ai ON p.ai_profile_id = ai.id
         WHERE ($2 = '%%' OR p.content ILIKE $2 OR ($3 != '' AND EXISTS (SELECT 1 FROM unnest(p.hashtags) tag WHERE tag ILIKE $3)))
         ORDER BY p.created_at DESC
         LIMIT $4`,
        [req.userId, searchPattern, tagQuery || '', lim]
      );

      formattedPosts = filterPostsByTopic(
        matchedPosts.map((post) => {
          const isAI = post.ai_generated;
          return {
            ...post,
            author_id: isAI ? post.ai_profile_id : post.user_id,
            author_type: isAI ? 'ai' : 'human',
            author_username: isAI ? post.ai_username : post.user_username,
            author_display_name: isAI ? post.ai_display_name : post.user_display_name,
            author_avatar: isAI ? post.ai_avatar : post.user_avatar,
            author_is_verified: isAI ? post.ai_is_verified : post.user_is_verified,
            published_at: post.created_at,
            reaction_count: post.like_count,
            comment_count: post.comment_count,
            has_reacted: post.has_reacted,
            is_following_author: false,
          };
        }),
        normalizedTopic
      );
    }

    res.json({
      profiles: [...ais, ...humans].slice(0, lim),
      posts: formattedPosts,
      trending: [],
    });
  } catch (err) {
    console.error('[GET /explore/search]', err);
    res.status(500).json({ message: 'Search failed' });
  }
});

router.get('/trending', authMiddleware, async (req, res) => {
  try {
    const tags = await req.db.queryMany(
      `SELECT tag, COUNT(*) as post_count
       FROM (
         SELECT unnest(hashtags) as tag
         FROM posts
         WHERE created_at > NOW() - INTERVAL '7 days'
       ) t
       GROUP BY tag
       ORDER BY post_count DESC
       LIMIT 15`
    );
    res.json({ trending: tags });
  } catch (err) {
    res.json({ trending: [] });
  }
});

router.get('/suggested-profiles', authMiddleware, async (req, res) => {
  try {
    const { ai_category } = req.query;
    const normalizedCategory = ai_category?.trim().toLowerCase();

    const aiRows = await req.db.queryMany(
      `SELECT id, user_id, username, display_name, avatar, is_verified,
              bio, ait_token_id, health_score, autonomy_enabled,
              true as is_ai, 'ai' as profile_type
       FROM ai_profiles ORDER BY RANDOM() LIMIT 8`
    );
    const ais = aiRows
      .map((profile) => ({
        ...profile,
        ...deriveAIMetadata(profile),
      }))
      .filter((profile) => {
        if (!normalizedCategory) return true;
        return profile.category === normalizedCategory;
      });

    const humans = await req.db.queryMany(
      `SELECT id, id as user_id, username, full_name as display_name, avatar_url as avatar, is_verified, health_score, false as is_ai, 'human' as profile_type
       FROM users ORDER BY RANDOM() LIMIT 6`
    );
    res.json({ profiles: [...ais, ...humans].slice(0, 6) });
  } catch (err) {
    res.json({ profiles: [] });
  }
});

module.exports = router;
