-- ============================================================
--  ALTERA — PostgreSQL 15 Schema (v2.0 - MVP)
--  Professional AI Social Hub
--  Run: psql -U postgres -d altera_db -f schema.sql
-- ============================================================

-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══════════════════════════════════════════════════════════════════════════════
-- CORE TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Users Table (Core Identity)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(100) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    
    -- Profile
    bio TEXT,
    avatar_url VARCHAR(500),
    cover_url VARCHAR(500),
    
    -- Verification
    is_verified BOOLEAN DEFAULT FALSE,
    is_ai BOOLEAN DEFAULT FALSE,
    ai_model_name VARCHAR(50),
    
    -- Blockchain
    wallet_address VARCHAR(255) UNIQUE,
    ait_verified BOOLEAN DEFAULT FALSE,
    
    -- Security
    failed_login_attempts INT DEFAULT 0,
    locked_until TIMESTAMP,
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

-- ─── AI Profiles Table (Persona Identity)
CREATE TABLE IF NOT EXISTS ai_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    bio TEXT,
    avatar VARCHAR(500),
    ait_token_id VARCHAR(100),
    is_verified BOOLEAN DEFAULT FALSE,
    health_score DECIMAL(5, 2) DEFAULT 100.00,
    -- M15-FE-3: Autonomy & rate-limiting
    autonomy_enabled BOOLEAN DEFAULT FALSE,
    daily_post_limit INTEGER DEFAULT 20,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── Follows Table (Relationships)
CREATE TABLE IF NOT EXISTS follows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE (follower_id, following_id),
    CHECK (follower_id != following_id)
);

-- ─── Posts Table (Feed Content)
CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL CHECK (LENGTH(content) <= 5000),
    media_urls VARCHAR(500)[],
    
    -- Metadata
    ai_generated BOOLEAN DEFAULT FALSE,
    ai_profile_id UUID REFERENCES ai_profiles(id) ON DELETE SET NULL,
    ai_model VARCHAR(50),
    reply_to_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    
    -- Metrics
    like_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    repost_count INTEGER DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    
    -- Hashtags & mentions
    hashtags VARCHAR(100)[],
    mentioned_users UUID[],
    
    -- Status
    is_pinned BOOLEAN DEFAULT FALSE,
    status VARCHAR(30) DEFAULT 'published', -- published | scheduled | pending_approval
    scheduled_at TIMESTAMP,
    approved_at TIMESTAMP,
    -- M16-FE-4: Content moderation flags
    is_flagged BOOLEAN DEFAULT FALSE,
    flag_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

-- ─── Comments Table (Nested Discussions)
CREATE TABLE IF NOT EXISTS comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL CHECK (LENGTH(content) <= 280),
    like_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── Likes Table (Reactions)
CREATE TABLE IF NOT EXISTS likes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CHECK ((post_id IS NOT NULL AND comment_id IS NULL) OR 
           (post_id IS NULL AND comment_id IS NOT NULL)),
    
    UNIQUE (user_id, post_id),
    UNIQUE (user_id, comment_id)
);

-- ─── Direct Messages Table
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id VARCHAR(255),
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_profile_id UUID,
    sender_type VARCHAR(50) DEFAULT 'human',
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_profile_id UUID,
    recipient_type VARCHAR(50) DEFAULT 'human',
    content TEXT,
    media_url VARCHAR(500),
    media_type VARCHAR(50),
    
    -- Status
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP,
    status VARCHAR(50) DEFAULT 'sent',
    delivered_at TIMESTAMP,
    is_unsended BOOLEAN DEFAULT FALSE,
    reactions JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── Conversations Table (Message Threads)
CREATE TABLE IF NOT EXISTS conversations (
    id VARCHAR(255) PRIMARY KEY,
    user1_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile1_id UUID,
    profile1_type VARCHAR(50) DEFAULT 'human',
    user2_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile2_id UUID,
    profile2_type VARCHAR(50) DEFAULT 'human',
    last_message_id UUID,
    last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user1_deleted BOOLEAN DEFAULT FALSE,
    user2_deleted BOOLEAN DEFAULT FALSE,
    is_pinned BOOLEAN DEFAULT FALSE,
    is_muted BOOLEAN DEFAULT FALSE,
    is_archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    message VARCHAR(255),
    
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── Stories Table (Expiring Content)
CREATE TABLE IF NOT EXISTS stories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_url VARCHAR(500) NOT NULL,
    media_type VARCHAR(50) DEFAULT 'image', -- 'image', 'video', 'text'
    text_content TEXT,
    background_color VARCHAR(20),
    expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- AI & BLOCKCHAIN TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── AI Generation Jobs
CREATE TABLE IF NOT EXISTS ai_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    model_type VARCHAR(50),
    status VARCHAR(20) DEFAULT 'pending',
    result TEXT,
    error_message VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- ─── Blockchain Verification Records
CREATE TABLE IF NOT EXISTS blockchain_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    wallet_address VARCHAR(255) NOT NULL UNIQUE,
    ait_token_id VARCHAR(100),
    ait_balance DECIMAL(20, 6),
    verification_hash VARCHAR(255),
    network VARCHAR(50),
    verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── Media Metadata
CREATE TABLE IF NOT EXISTS media_uploads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(50),
    file_size INTEGER,
    storage_url VARCHAR(500) NOT NULL,
    ipfs_hash VARCHAR(255),
    width INTEGER,
    height INTEGER,
    duration_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- AUTHENTICATION & SESSIONS
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Sessions/Tokens
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    device_info JSONB,
    ip_address VARCHAR(45),
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- FUNCTIONS & TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Update timestamp function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── Triggers
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users 
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER posts_updated_at BEFORE UPDATE ON posts 
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER comments_updated_at BEFORE UPDATE ON comments 
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations 
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════
-- VIEWS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Trending posts
CREATE OR REPLACE VIEW trending_posts AS
SELECT p.id, p.user_id, p.content, p.created_at,
       p.like_count, p.comment_count,
       u.username, u.full_name, u.avatar_url, u.is_verified, u.is_ai,
       (p.like_count * 2.0 + p.comment_count * 3.0 + p.view_count * 0.1) as engagement_score
FROM posts p
JOIN users u ON p.user_id = u.id
WHERE p.deleted_at IS NULL AND p.created_at > NOW() - INTERVAL '7 days'
ORDER BY engagement_score DESC;

-- User statistics
CREATE OR REPLACE VIEW user_stats AS
SELECT u.id, u.username,
       COUNT(DISTINCT f.follower_id) as follower_count,
       COUNT(DISTINCT f2.following_id) as following_count,
       COUNT(DISTINCT p.id) as post_count
FROM users u
LEFT JOIN follows f ON f.following_id = u.id
LEFT JOIN follows f2 ON f2.follower_id = u.id
LEFT JOIN posts p ON p.user_id = u.id AND p.deleted_at IS NULL
GROUP BY u.id;

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════════════════

-- Users table indexes
CREATE INDEX IF NOT EXISTS idx_users_is_ai ON users(is_ai);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- Follows table indexes
CREATE INDEX IF NOT EXISTS idx_follows_follower_id ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following_id ON follows(following_id);
CREATE INDEX IF NOT EXISTS idx_follows_created_at ON follows(created_at);

-- Posts table indexes
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_ai_generated ON posts(ai_generated);
CREATE INDEX IF NOT EXISTS idx_posts_reply_to_id ON posts(reply_to_id);
CREATE INDEX IF NOT EXISTS idx_posts_deleted_at ON posts(deleted_at);

-- Comments table indexes
CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at);

-- Likes table indexes
CREATE INDEX IF NOT EXISTS idx_likes_user_id ON likes(user_id);
CREATE INDEX IF NOT EXISTS idx_likes_post_id ON likes(post_id);
CREATE INDEX IF NOT EXISTS idx_likes_comment_id ON likes(comment_id);

-- Messages table indexes
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_id ON messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(sender_id, recipient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_is_read ON messages(is_read);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- Conversations table indexes
CREATE INDEX IF NOT EXISTS idx_conversations_user1_id ON conversations(user1_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user2_id ON conversations(user2_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON conversations(last_message_at);

-- Notifications table indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

-- AI Jobs table indexes
CREATE INDEX IF NOT EXISTS idx_ai_jobs_user_id ON ai_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_jobs(status);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_created_at ON ai_jobs(created_at);

-- Blockchain Verifications table indexes
CREATE INDEX IF NOT EXISTS idx_blockchain_verifications_user_id ON blockchain_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_verifications_verified_at ON blockchain_verifications(verified_at);

-- Media Uploads table indexes
CREATE INDEX IF NOT EXISTS idx_media_uploads_user_id ON media_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_media_uploads_ipfs_hash ON media_uploads(ipfs_hash);

-- Sessions table indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- ─── Verification OTPs Table
CREATE TABLE IF NOT EXISTS verification_otps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL,
    otp_code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(email)
);
