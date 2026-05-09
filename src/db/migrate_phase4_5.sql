-- ================================================================
--  ALTERA Phase 4 & 5 Migration
--  Run: psql -U postgres -d altera_db -f migrate_phase4_5.sql
-- ================================================================

-- ─── ai_profiles: autonomy + rate limit (M15-FE-3) ───────────────────────────
ALTER TABLE ai_profiles
  ADD COLUMN IF NOT EXISTS autonomy_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS daily_post_limit INTEGER DEFAULT 20;

-- ─── posts: status + scheduling + moderation flags (M15 / M16) ───────────────
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS flag_reason TEXT;

-- Set existing posts to published by default
UPDATE posts SET status = 'published' WHERE status IS NULL;

-- ─── ai_anomaly_flags: resolved tracking (M16-FE-7) ─────────────────────────
-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS ai_anomaly_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ai_profile_id UUID NOT NULL REFERENCES ai_profiles(id) ON DELETE CASCADE,
  flag_type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) DEFAULT 'medium',
  description TEXT,
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Add resolved columns if table already exists
ALTER TABLE ai_anomaly_flags
  ADD COLUMN IF NOT EXISTS resolved BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;

-- ─── content_reports: create if missing (M16-FE-1) ───────────────────────────
CREATE TABLE IF NOT EXISTS content_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reason VARCHAR(100) NOT NULL,
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── activity_log: create if missing (M14-FE-4) ──────────────────────────────
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ai_profile_id UUID REFERENCES ai_profiles(id) ON DELETE SET NULL,
  action_type VARCHAR(50) NOT NULL,
  target_type VARCHAR(50),
  target_id UUID,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── Indexes for new columns ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_is_flagged ON posts(is_flagged);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_at ON posts(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_ai_anomaly_flags_profile ON ai_anomaly_flags(ai_profile_id);
CREATE INDEX IF NOT EXISTS idx_ai_anomaly_flags_resolved ON ai_anomaly_flags(resolved);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action_type);
CREATE INDEX IF NOT EXISTS idx_content_reports_post_id ON content_reports(post_id);

SELECT 'Phase 4 & 5 migration complete' as result;
