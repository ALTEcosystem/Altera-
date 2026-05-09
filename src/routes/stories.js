const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth');
const db = require('../db/database');

const router = express.Router();

// ─── POST /stories ────────────────────────────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { media_url, media_type = 'image', text_content, background_color } = req.body;
    if (!media_url && !text_content) {
      return res.status(400).json({ message: 'media_url or text_content is required' });
    }

    const fs = require('fs');
    const path = require('path');
    let finalMediaUrl = media_url || '';

    if (finalMediaUrl && finalMediaUrl.startsWith('data:image')) {
      const matches = finalMediaUrl.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const extension = matches[1] === 'jpeg' ? 'jpg' : matches[1];
        const buffer = Buffer.from(matches[2], 'base64');
        const filename = `${req.userId}_story_${Date.now()}_${Math.floor(Math.random()*1000)}.${extension}`;
        const uploadDir = path.join(__dirname, '../../public/uploads');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        const filepath = path.join(uploadDir, filename);
        fs.writeFileSync(filepath, buffer);
        finalMediaUrl = `/uploads/${filename}`;
      }
    }

    const storyId = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const result = await db.queryOne(
      `INSERT INTO stories (id, user_id, media_url, media_type, text_content, background_color, expires_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [storyId, req.userId, finalMediaUrl, media_type, text_content || '', background_color || '', expiresAt]
    );

    res.status(201).json({ story: result });
  } catch (err) {
    console.error('[POST /stories]', err);
    res.status(500).json({ message: 'Failed to create story' });
  }
});

// ─── GET /stories ─────────────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    // Get active stories from followed users and self
    // For MVP, just get all stories that haven't expired
    const result = await db.queryMany(
      `SELECT s.*, u.username, u.full_name, u.avatar_url,
              (SELECT COUNT(*) FROM story_views sv WHERE sv.story_id = s.id) as view_count,
              EXISTS(SELECT 1 FROM story_views sv WHERE sv.story_id = s.id AND sv.user_id = $1) as viewed
       FROM stories s
       JOIN users u ON s.user_id = u.id
       WHERE s.expires_at > CURRENT_TIMESTAMP
       ORDER BY s.created_at DESC`,
      [req.userId]
    );

    // Group by user
    const grouped = {};
    result.forEach(story => {
      if (!grouped[story.user_id]) {
        grouped[story.user_id] = {
          user_id: story.user_id,
          username: story.username,
          display_name: story.full_name,
          avatar: story.avatar_url,
          stories: [],
        };
      }
      grouped[story.user_id].stories.push(story);
    });

    res.json({ story_groups: Object.values(grouped) });
  } catch (err) {
    console.error('[GET /stories]', err);
    res.status(500).json({ message: 'Failed to fetch stories' });
  }
});

// ─── POST /stories/:id/view ───────────────────────────────────────────────────
router.post('/:id/view', authMiddleware, async (req, res) => {
  try {
    const storyId = req.params.id;
    await db.query(
      `INSERT INTO story_views (story_id, user_id) VALUES ($1, $2) ON CONFLICT (story_id, user_id) DO NOTHING`,
      [storyId, req.userId]
    );
    res.json({ message: 'Story viewed' });
  } catch (err) {
    console.error('[POST /stories/:id/view]', err);
    res.status(500).json({ message: 'Failed to record view' });
  }
});

// ─── GET /stories/:id/viewers ─────────────────────────────────────────────────
router.get('/:id/viewers', authMiddleware, async (req, res) => {
  try {
    const storyId = req.params.id;
    const story = await db.queryOne('SELECT user_id FROM stories WHERE id = $1', [storyId]);
    if (!story) return res.status(404).json({ message: 'Story not found' });
    
    if (story.user_id !== req.userId) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const viewers = await db.queryMany(
      `SELECT u.id, u.username, u.full_name as display_name, u.avatar_url as avatar, sv.viewed_at 
       FROM story_views sv
       JOIN users u ON sv.user_id = u.id
       WHERE sv.story_id = $1
       ORDER BY sv.viewed_at DESC`,
      [storyId]
    );
    
    res.json({ viewers });
  } catch (err) {
    console.error('[GET /stories/:id/viewers]', err);
    res.status(500).json({ message: 'Failed to fetch viewers' });
  }
});

module.exports = router;

