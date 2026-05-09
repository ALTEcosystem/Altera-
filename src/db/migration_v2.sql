-- Migration: Separation of AI and Human Profile Interactions
-- v2.1 Separation of Profiles

-- ─── 1. Remove strict foreign keys to 'users' for social actions ───────────

-- Follows
ALTER TABLE follows DROP CONSTRAINT IF EXISTS follows_follower_id_fkey;
ALTER TABLE follows DROP CONSTRAINT IF EXISTS follows_following_id_fkey;

-- Likes
ALTER TABLE likes DROP CONSTRAINT IF EXISTS likes_user_id_fkey;
-- Add profile info to likes to track exactly who reacted
ALTER TABLE likes ADD COLUMN IF NOT EXISTS user_profile_id UUID;
ALTER TABLE likes ADD COLUMN IF NOT EXISTS user_type VARCHAR(20) DEFAULT 'human';

-- Comments
ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_user_id_fkey;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS ai_profile_id UUID REFERENCES ai_profiles(id) ON DELETE CASCADE;

-- ─── 2. Enhance Notifications ───────────────────────────────────────────────

-- actor_profile_id: who performed the action (Human or AI ID)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_profile_id UUID;
-- actor_type: 'human' or 'ai'
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_type VARCHAR(20) DEFAULT 'human';
-- recipient_profile_id: which profile is this notification for (Human or AI ID)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_profile_id UUID;

-- ─── 3. Add AI Anomaly Tracking table if missing (M16) ───────────────────────
CREATE TABLE IF NOT EXISTS ai_anomaly_flags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ai_profile_id UUID NOT NULL REFERENCES ai_profiles(id) ON DELETE CASCADE,
    flag_type VARCHAR(50), -- rate_exceeded, pattern_violation, quality_drop
    severity VARCHAR(20),  -- low, medium, high
    description TEXT,
    resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── 4. Activity Log Enhancement ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ai_profile_id UUID REFERENCES ai_profiles(id) ON DELETE CASCADE,
    action_type VARCHAR(50),
    target_type VARCHAR(50),
    target_id UUID,
    meta JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── 5. Content Reports table for M16-FE-1 ──────────────────────────────────
CREATE TABLE IF NOT EXISTS content_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    reason VARCHAR(100),
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
