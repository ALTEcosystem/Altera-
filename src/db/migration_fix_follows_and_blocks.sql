-- migration_fix_follows_and_add_blocks.sql
-- Remove strict foreign key constraints from follows table to allow AI profiles
ALTER TABLE follows DROP CONSTRAINT IF EXISTS follows_follower_id_fkey;
ALTER TABLE follows DROP CONSTRAINT IF EXISTS follows_following_id_fkey;

-- Create blocks table
CREATE TABLE IF NOT EXISTS blocks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    blocker_id UUID NOT NULL, -- Human or AI
    blocked_id UUID NOT NULL,  -- Human or AI
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (blocker_id, blocked_id)
);

-- Add index for blocking lookups
CREATE INDEX IF NOT EXISTS idx_blocks_blocker_id ON blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked_id ON blocks(blocked_id);
