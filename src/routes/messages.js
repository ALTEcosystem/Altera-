const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const db = require('../db/database');

const router = express.Router();

// ─── GET /messages/share-targets — Prioritized users for sharing ─────────────
router.get('/share-targets', authMiddleware, async (req, res) => {
  try {
    let activeProfileId = req.query.profile_id || req.userId;
    // Strip prefix if exists (e.g., human:uuid -> uuid)
    if (typeof activeProfileId === 'string' && activeProfileId.includes(':')) {
      activeProfileId = activeProfileId.split(':')[1];
    }
    const activeHumanId = req.userId;

    // 1. Get followers (high priority)
    const followers = await db.queryMany(
      `SELECT f.follower_id as id, 
              u.id as user_id, u.username, u.full_name as display_name, u.avatar_url as avatar, u.is_verified, false as is_ai
       FROM follows f
       JOIN users u ON f.follower_id = u.id
       WHERE f.following_id = $1
       UNION
       SELECT f.follower_id as id,
              ai.user_id, ai.username, ai.display_name, ai.avatar, ai.is_verified, true as is_ai
       FROM follows f
       JOIN ai_profiles ai ON f.follower_id = ai.id
       WHERE f.following_id = $1
       LIMIT 20`,
      [activeProfileId]
    );

    // 2. Get following
    const following = await db.queryMany(
      `SELECT f.following_id as id, 
              u.id as user_id, u.username, u.full_name as display_name, u.avatar_url as avatar, u.is_verified, false as is_ai
       FROM follows f
       JOIN users u ON f.following_id = u.id
       WHERE f.follower_id = $1
       UNION
       SELECT f.following_id as id,
              ai.user_id, ai.username, ai.display_name, ai.avatar, ai.is_verified, true as is_ai
       FROM follows f
       JOIN ai_profiles ai ON f.following_id = ai.id
       WHERE f.follower_id = $1
       LIMIT 20`,
      [activeProfileId]
    );

    // 3. Get recent chats (excluding followers/following we already have)
    const recentChats = await db.queryMany(
      `SELECT DISTINCT ON (c.id) 
              CASE WHEN c.profile1_id = $1 THEN c.profile2_id ELSE c.profile1_id END as id,
              CASE WHEN c.profile1_id = $1 THEN c.user2_id ELSE c.user1_id END as user_id,
              CASE WHEN c.profile1_id = $1 THEN c.profile2_type ELSE c.profile1_type END as type,
              c.last_message_at
       FROM conversations c
       WHERE c.profile1_id = $1 OR c.profile2_id = $1
       ORDER BY c.id, c.last_message_at DESC
       LIMIT 10`,
      [activeProfileId]
    );

    // We need to fetch profiles for these recent chats
    const chatTargets = [];
    for (const chat of recentChats) {
      let profile;
      if (chat.type === 'ai') {
        profile = await db.queryOne('SELECT id, user_id, username, display_name, avatar, is_verified, true as is_ai FROM ai_profiles WHERE id = $1', [chat.id]);
      } else {
        profile = await db.queryOne('SELECT id, id as user_id, username, full_name as display_name, avatar_url as avatar, is_verified, false as is_ai FROM users WHERE id = $1', [chat.id]);
      }
      if (profile) chatTargets.push(profile);
    }

    // Merge and remove duplicates
    const all = [...followers, ...following, ...chatTargets];
    const seen = new Set();
    const unique = all.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    if (unique.length > 0) {
      return res.json({ targets: unique });
    }

    // 4. Fallback: show other human users and AI personas when there is no
    // follow/conversation graph yet, so share never appears empty.
    const fallbackHumans = await db.queryMany(
      `SELECT u.id,
              u.id as user_id,
              u.username,
              COALESCE(u.full_name, u.username) as display_name,
              u.avatar_url as avatar,
              u.is_verified,
              false as is_ai
       FROM users u
       WHERE u.id <> $1
       ORDER BY u.created_at DESC
       LIMIT 20`,
      [activeHumanId]
    );

    const fallbackAIs = await db.queryMany(
      `SELECT ai.id,
              ai.user_id,
              ai.username,
              ai.display_name,
              ai.avatar,
              ai.is_verified,
              true as is_ai
       FROM ai_profiles ai
       WHERE ai.id <> $1
         AND ai.user_id <> $2
       ORDER BY ai.created_at DESC
       LIMIT 20`,
      [activeProfileId, activeHumanId]
    );

    const fallbackAll = [...fallbackHumans, ...fallbackAIs];
    const fallbackSeen = new Set();
    const fallbackUnique = fallbackAll.filter((p) => {
      if (fallbackSeen.has(p.id)) return false;
      fallbackSeen.add(p.id);
      return true;
    });

    res.json({ targets: fallbackUnique });
  } catch (err) {
    console.error('[GET /messages/share-targets]', err);
    res.status(500).json({ message: 'Failed to fetch share targets' });
  }
});

function toMessageResponse(m) {
  return {
    id: m.id,
    conversation_id: m.conversation_id,
    sender_id: m.sender_profile_id || m.sender_id,
    sender_user_id: m.sender_id,
    sender_profile_id: m.sender_profile_id,
    sender_profile_type: m.sender_type,
    sender_name: m.sender_name,
    sender_avatar_url: m.sender_avatar,
    sender_is_verified: !!m.sender_verified,
    sender_is_ai: m.sender_type === 'ai',
    content: m.content,
    media_url: m.media_url,
    is_read: !!m.is_read,
    read_at: m.read_at,
    status: m.status || 'sent',
    delivered_at: m.delivered_at,
    is_unsended: !!m.is_unsended,
    is_forwarded: !!m.is_forwarded,
    reactions: m.reactions || [],
    created_at: m.created_at,
  };
}

// ─── GET /messages/search — Search across messages and conversations ──────────
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q, profile_id } = req.query;
    if (!q) return res.json({ messages: [], conversations: [] });

    const activeProfileId = profile_id || req.userId;

    // Search messages
    const messageRows = await db.queryMany(
      `SELECT m.*, 
              su.username as sender_username, su.full_name as sender_name, su.avatar_url as sender_avatar, su.is_verified as sender_verified,
              sai.username as sender_ai_username, sai.display_name as sender_ai_name, sai.avatar as sender_ai_avatar, sai.is_verified as sender_ai_verified
       FROM messages m
       LEFT JOIN users su ON m.sender_id = su.id
       LEFT JOIN ai_profiles sai ON m.sender_profile_id = sai.id AND m.sender_type = 'ai'
       WHERE (m.sender_profile_id = $1 OR m.recipient_profile_id = $1)
         AND m.content ILIKE $2
         AND m.is_unsended = FALSE
         AND NOT ($3 = ANY(COALESCE(m.deleted_by, '{}')))
       ORDER BY m.created_at DESC
       LIMIT 50`,
      [activeProfileId, `%${q}%`, req.userId]
    );

    const messages = messageRows.map(m => toMessageResponse({
      ...m,
      sender_name: m.sender_type === 'ai' ? m.sender_ai_name : m.sender_name,
      sender_avatar: m.sender_type === 'ai' ? m.sender_ai_avatar : m.sender_avatar,
      sender_verified: m.sender_type === 'ai' ? m.sender_ai_verified : m.sender_verified,
    }));

    // Search conversations (by partner name/username)
    const conversationRows = await db.queryMany(
      `SELECT c.*, 
              u.username as partner_username, u.full_name as partner_name, u.avatar_url as partner_avatar, u.is_verified as partner_verified,
              ai.username as partner_ai_username, ai.display_name as partner_ai_name, ai.avatar as partner_ai_avatar, ai.is_verified as partner_ai_verified
       FROM conversations c
       LEFT JOIN users u ON (c.profile1_id = u.id OR c.profile2_id = u.id) AND u.id != $1
       LEFT JOIN ai_profiles ai ON (c.profile1_id = ai.id OR c.profile2_id = ai.id) AND ai.id != $1
       WHERE (c.profile1_id = $1 OR c.profile2_id = $1)
         AND (
           u.username ILIKE $2 OR u.full_name ILIKE $2 OR
           ai.username ILIKE $2 OR ai.display_name ILIKE $2
         )
       LIMIT 20`,
      [activeProfileId, `%${q}%`]
    );

    const conversations = conversationRows.map(c => {
      const isMe1 = c.profile1_id === activeProfileId;
      const partner = isMe1 
        ? {
            user_id: c.user2_id,
            profile_id: c.profile2_id,
            profile_type: c.profile2_type,
            display_name: c.profile2_type === 'ai' ? c.partner_ai_name : c.partner_name,
            username: c.profile2_type === 'ai' ? c.partner_ai_username : c.partner_username,
            avatar: c.profile2_type === 'ai' ? c.partner_ai_avatar : c.partner_avatar,
            is_verified: c.profile2_type === 'ai' ? c.partner_ai_verified : c.partner_verified,
          }
        : {
            user_id: c.user1_id,
            profile_id: c.profile1_id,
            profile_type: c.profile1_type,
            display_name: c.profile1_type === 'ai' ? c.partner_ai_name : c.partner_name,
            username: c.profile1_type === 'ai' ? c.partner_ai_username : c.partner_username,
            avatar: c.profile1_type === 'ai' ? c.partner_ai_avatar : c.partner_avatar,
            is_verified: c.profile1_type === 'ai' ? c.partner_ai_verified : c.partner_verified,
          };

      return {
        id: c.id,
        user_id: partner.user_id,
        profile_id: partner.profile_id,
        user_name: partner.display_name,
        user_username: partner.username,
        user_avatar_url: partner.avatar,
        user_is_verified: !!partner.is_verified,
        user_is_ai: partner.profile_type === 'ai',
        is_pinned: !!c.is_pinned,
        is_archived: !!c.is_archived,
        is_muted: !!c.is_muted,
        created_at: c.created_at,
      };
    });

    res.json({ messages, conversations });
  } catch (err) {
    console.error('[GET /messages/search]', err);
    res.status(500).json({ message: 'Search failed' });
  }
});

// ─── GET /messages/conversations — List all conversations for the user ───────
router.get('/conversations', authMiddleware, async (req, res) => {
  try {
    let activeProfileId = req.query.profile_id || req.userId;
    if (typeof activeProfileId === 'string' && activeProfileId.includes(':')) {
      activeProfileId = activeProfileId.split(':')[1];
    }

    // Query driven by conversations table to ensure ALL conversations appear,
    // regardless of message ordering or edge cases.
    const rows = await db.queryMany(
      `SELECT
         c.id            AS conversation_id,
         c.user1_id, c.user2_id,
         c.profile1_id,  c.profile2_id,
         c.profile1_type, c.profile2_type,
         c.is_pinned, c.is_archived, c.is_muted,
         c.last_message_at,
         c.created_at   AS conv_created_at,
         -- Human partner info (side A)
         u1.username AS u1_username, COALESCE(u1.full_name, u1.username) AS u1_name, u1.avatar_url AS u1_avatar, u1.is_verified AS u1_verified,
         -- Human partner info (side B)
         u2.username AS u2_username, COALESCE(u2.full_name, u2.username) AS u2_name, u2.avatar_url AS u2_avatar, u2.is_verified AS u2_verified,
         -- AI partner info (side A)
         ai1.username AS ai1_username, COALESCE(ai1.display_name, ai1.username) AS ai1_name, ai1.avatar AS ai1_avatar, ai1.is_verified AS ai1_verified,
         -- AI partner info (side B)
         ai2.username AS ai2_username, COALESCE(ai2.display_name, ai2.username) AS ai2_name, ai2.avatar AS ai2_avatar, ai2.is_verified AS ai2_verified,
         -- Last message (LATERAL)
         m.id AS msg_id, m.conversation_id AS msg_conv_id,
         m.sender_id, m.sender_profile_id, m.sender_type,
         m.recipient_id, m.recipient_profile_id, m.recipient_type,
         m.content, m.media_url, m.is_read, m.read_at, m.status,
         m.delivered_at, m.is_unsended, m.is_forwarded, m.reactions,
         m.created_at AS msg_created_at,
         -- Sender name/avatar for last message
         COALESCE(ms_u.full_name, ms_u.username) AS msg_sender_name, ms_u.avatar_url AS msg_sender_avatar, ms_u.is_verified AS msg_sender_verified,
         COALESCE(ms_ai.display_name, ms_ai.username) AS msg_sender_ai_name, ms_ai.avatar AS msg_sender_ai_avatar, ms_ai.is_verified AS msg_sender_ai_verified,
         -- Unread count
         (SELECT COUNT(*) FROM messages um
          WHERE um.conversation_id = c.id
            AND um.recipient_profile_id = $1
            AND um.is_read = FALSE
            AND NOT ($2 = ANY(COALESCE(um.deleted_by, '{}')))
         ) AS unread_count
       FROM conversations c
       -- Profile lookups for both sides
       LEFT JOIN users   u1  ON c.profile1_type = 'human' AND c.profile1_id = u1.id
       LEFT JOIN users   u2  ON c.profile2_type = 'human' AND c.profile2_id = u2.id
       LEFT JOIN ai_profiles ai1 ON c.profile1_type = 'ai' AND c.profile1_id = ai1.id
       LEFT JOIN ai_profiles ai2 ON c.profile2_type = 'ai' AND c.profile2_id = ai2.id
       -- Most recent non-deleted message
       LEFT JOIN LATERAL (
         SELECT * FROM messages lm
         WHERE lm.conversation_id = c.id
           AND NOT ($2 = ANY(COALESCE(lm.deleted_by, '{}')))
         ORDER BY lm.created_at DESC
         LIMIT 1
       ) m ON TRUE
       LEFT JOIN users        ms_u  ON m.sender_id = ms_u.id AND m.sender_type = 'human'
       LEFT JOIN ai_profiles  ms_ai ON m.sender_profile_id = ms_ai.id AND m.sender_type = 'ai'
       WHERE (c.profile1_id = $1 OR c.profile2_id = $1)
         AND c.is_archived = FALSE
       ORDER BY c.is_pinned DESC, COALESCE(m.created_at, c.last_message_at, c.created_at) DESC`,
      [activeProfileId, req.userId]
    );

    const conversations = rows.map(row => {
      const iAmProfile1 = row.profile1_id === activeProfileId;

      // Determine which side is "me" and which is the partner
      const partnerProfileId   = iAmProfile1 ? row.profile2_id   : row.profile1_id;
      const partnerProfileType = iAmProfile1 ? row.profile2_type  : row.profile1_type;
      const partnerUserId      = iAmProfile1 ? row.user2_id       : row.user1_id;

      let partnerName, partnerAvatar, partnerVerified;
      if (iAmProfile1) {
        partnerName     = partnerProfileType === 'ai' ? row.ai2_name     : row.u2_name;
        partnerAvatar   = partnerProfileType === 'ai' ? row.ai2_avatar   : row.u2_avatar;
        partnerVerified = partnerProfileType === 'ai' ? row.ai2_verified  : row.u2_verified;
      } else {
        partnerName     = partnerProfileType === 'ai' ? row.ai1_name     : row.u1_name;
        partnerAvatar   = partnerProfileType === 'ai' ? row.ai1_avatar   : row.u1_avatar;
        partnerVerified = partnerProfileType === 'ai' ? row.ai1_verified  : row.u1_verified;
      }

      const lastMessage = row.msg_id ? toMessageResponse({
        id: row.msg_id,
        conversation_id: row.conversation_id,
        sender_id: row.sender_id,
        sender_profile_id: row.sender_profile_id,
        sender_type: row.sender_type,
        recipient_id: row.recipient_id,
        recipient_profile_id: row.recipient_profile_id,
        recipient_type: row.recipient_type,
        content: row.content,
        media_url: row.media_url,
        is_read: row.is_read,
        read_at: row.read_at,
        status: row.status,
        delivered_at: row.delivered_at,
        is_unsended: row.is_unsended,
        is_forwarded: row.is_forwarded,
        reactions: Array.isArray(row.reactions) ? row.reactions : [],
        created_at: row.msg_created_at,
        sender_name: row.sender_type === 'ai' ? row.msg_sender_ai_name : row.msg_sender_name,
        sender_avatar: row.sender_type === 'ai' ? row.msg_sender_ai_avatar : row.msg_sender_avatar,
        sender_verified: row.sender_type === 'ai' ? row.msg_sender_ai_verified : row.msg_sender_verified,
      }) : null;

      return {
        id: row.conversation_id,
        user_id: partnerUserId || '',
        profile_id: partnerProfileId,
        profile_type: partnerProfileType,
        user_name: partnerName || 'Unknown User',
        user_avatar_url: partnerAvatar || null,
        user_is_verified: !!partnerVerified,
        user_is_ai: partnerProfileType === 'ai',
        is_pinned: !!row.is_pinned,
        is_archived: !!row.is_archived,
        is_muted: !!row.is_muted,
        last_message: lastMessage,
        unread_count: parseInt(row.unread_count || 0),
        created_at: row.conv_created_at,
      };
    });

    res.json({ conversations });
  } catch (err) {
    console.error('[GET /messages/conversations]', err);
    res.status(500).json({ message: 'Failed to fetch conversations' });
  }
});

// ─── POST /messages/conversations/:id/pin — Pin/Unpin conversation ─────────────
router.post('/conversations/:conversationId/pin', authMiddleware, async (req, res) => {
  try {
    const { pin } = req.body;
    await db.query(
      `UPDATE conversations SET is_pinned = $1 WHERE id = $2 AND (user1_id = $3 OR user2_id = $3)`,
      [!!pin, req.params.conversationId, req.userId]
    );
    res.json({ success: true, is_pinned: !!pin });
  } catch (err) {
    res.status(500).json({ message: 'Failed to pin conversation' });
  }
});

// ─── POST /messages/conversations/:id/archive — Archive conversation ───────────
router.post('/conversations/:conversationId/archive', authMiddleware, async (req, res) => {
  try {
    const { archive } = req.body;
    await db.query(
      `UPDATE conversations SET is_archived = $1 WHERE id = $2 AND (user1_id = $3 OR user2_id = $3)`,
      [!!archive, req.params.conversationId, req.userId]
    );
    res.json({ success: true, is_archived: !!archive });
  } catch (err) {
    res.status(500).json({ message: 'Failed to archive conversation' });
  }
});

// ─── POST /messages/conversations/:id/mute — Mute conversation ─────────────────
router.post('/conversations/:conversationId/mute', authMiddleware, async (req, res) => {
  try {
    const { mute } = req.body;
    await db.query(
      `UPDATE conversations SET is_muted = $1 WHERE id = $2 AND (user1_id = $3 OR user2_id = $3)`,
      [!!mute, req.params.conversationId, req.userId]
    );
    res.json({ success: true, is_muted: !!mute });
  } catch (err) {
    res.status(500).json({ message: 'Failed to mute conversation' });
  }
});

// ─── DELETE /messages/conversations/:id — Delete entire conversation ───────────
router.delete('/conversations/:conversationId', authMiddleware, async (req, res) => {
  try {
    const { conversationId } = req.params;
    // We mark all messages in the conversation as deleted by this user
    await db.query(
      `UPDATE messages 
       SET deleted_by = array_append(COALESCE(deleted_by, '{}'), $1)
       WHERE conversation_id = $2 AND (sender_id = $1 OR recipient_id = $1)
         AND NOT ($1 = ANY(COALESCE(deleted_by, '{}')))`,
      [req.userId, conversationId]
    );
    
    // Also mark conversation as archived so it doesn't show up in the list
    await db.query(
      `UPDATE conversations SET is_archived = TRUE WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)`,
      [conversationId, req.userId]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete conversation' });
  }
});

// ─── DELETE /messages/:id — Delete single message (for me) ──────────────────────
router.delete('/:messageId', authMiddleware, async (req, res) => {
  try {
    await db.query(
      `UPDATE messages 
       SET deleted_by = array_append(COALESCE(deleted_by, '{}'), $1)
       WHERE id = $2 AND (sender_id = $1 OR recipient_id = $1)`,
      [req.userId, req.params.messageId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete message' });
  }
});

// ─── POST /messages/:id/unsend — Unsend message ───────────────────────────────
router.post('/:messageId/unsend', authMiddleware, async (req, res) => {
  try {
    const message = await db.queryOne(
      `SELECT * FROM messages WHERE id = $1 AND sender_id = $2`,
      [req.params.messageId, req.userId]
    );
    if (!message) return res.status(404).json({ message: 'Message not found or not yours' });

    await db.query(
      `UPDATE messages SET is_unsended = TRUE, content = 'Message unsent' WHERE id = $1`,
      [req.params.messageId]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Failed to unsend message' });
  }
});

// ─── POST /messages/:id/react — React to message ──────────────────────────────
router.post('/:messageId/react', authMiddleware, async (req, res) => {
  try {
    const { emoji } = req.body;
    const message = await db.queryOne(
      `SELECT reactions FROM messages WHERE id = $1`,
      [req.params.messageId]
    );
    if (!message) return res.status(404).json({ message: 'Message not found' });

    let reactions = message.reactions || [];
    const existingIndex = reactions.findIndex(r => r.user_id === req.userId);

    if (existingIndex >= 0) {
      if (reactions[existingIndex].emoji === emoji) {
        reactions.splice(existingIndex, 1); // Remove if same emoji
      } else {
        reactions[existingIndex].emoji = emoji; // Update if different emoji
      }
    } else {
      reactions.push({ user_id: req.userId, emoji });
    }

    await db.query(
      `UPDATE messages SET reactions = $1 WHERE id = $2`,
      [JSON.stringify(reactions), req.params.messageId]
    );

    res.json({ success: true, reactions });
  } catch (err) {
    res.status(500).json({ message: 'Failed to react to message' });
  }
});

// ─── GET /messages/conversations/:id — Fetch messages for a specific conversation ──
router.get('/conversations/:conversationId', authMiddleware, async (req, res) => {
  try {
    const { conversationId } = req.params;

    const rows = await db.queryMany(
      `SELECT m.*, 
              su.username as sender_username, su.full_name as sender_name, su.avatar_url as sender_avatar, su.is_verified as sender_verified,
              sai.username as sender_ai_username, sai.display_name as sender_ai_name, sai.avatar as sender_ai_avatar, sai.is_verified as sender_ai_verified
       FROM messages m
       LEFT JOIN users su ON m.sender_id = su.id
       LEFT JOIN ai_profiles sai ON m.sender_profile_id = sai.id AND m.sender_type = 'ai'
       WHERE m.conversation_id = $1 AND (m.sender_id = $2 OR m.recipient_id = $2)
         AND NOT ($2 = ANY(COALESCE(m.deleted_by, '{}')))
       ORDER BY m.created_at ASC`,
      [conversationId, req.userId]
    );

    const formattedMessages = rows.map(m => toMessageResponse({
      ...m,
      sender_name: m.sender_type === 'ai' ? m.sender_ai_name : m.sender_name,
      sender_avatar: m.sender_type === 'ai' ? m.sender_ai_avatar : m.sender_avatar,
      sender_verified: m.sender_type === 'ai' ? m.sender_ai_verified : m.sender_verified,
    }));

    res.json({
      conversation_id: conversationId,
      messages: formattedMessages,
    });
  } catch (err) {
    console.error('[GET /messages/conversations/:id]', err);
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
});

// ─── POST /messages/conversations/:id/read — Mark messages as read ────────────
router.post('/conversations/:conversationId/read', authMiddleware, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const result = await db.query(
      `UPDATE messages SET is_read = TRUE, read_at = NOW(), status = 'read' 
       WHERE conversation_id = $1 AND recipient_id = $2 AND is_read = FALSE`,
      [conversationId, req.userId]
    );
    res.json({ conversation_id: conversationId, updated: result.rowCount });
  } catch (err) {
    res.status(500).json({ message: 'Failed to mark messages as read' });
  }
});

module.exports = router;
