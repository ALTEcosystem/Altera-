-- Fix conversations table to support string IDs (pipe-separated keys)
-- and resolve the mismatch with the Flutter app and Socket logic.

-- 1. Drop existing table (warning: this deletes existing conversation metadata)
DROP TABLE IF EXISTS conversations CASCADE;

-- 2. Recreate with VARCHAR ID
CREATE TABLE conversations (
    id VARCHAR(255) PRIMARY KEY,
    user1_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile1_id UUID,
    profile1_type VARCHAR(50) DEFAULT 'human',
    user2_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile2_id UUID,
    profile2_type VARCHAR(50) DEFAULT 'human',
    last_message_id UUID, -- We'll link this manually to avoid complex FK issues with VARCHAR
    last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user1_deleted BOOLEAN DEFAULT FALSE,
    user2_deleted BOOLEAN DEFAULT FALSE,
    is_pinned BOOLEAN DEFAULT FALSE,
    is_muted BOOLEAN DEFAULT FALSE,
    is_archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Add indexes for performance
CREATE INDEX idx_conversations_user1_id ON conversations(user1_id);
CREATE INDEX idx_conversations_user2_id ON conversations(user2_id);
CREATE INDEX idx_conversations_last_message_at ON conversations(last_message_at);

-- 4. Update the trigger
CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations 
FOR EACH ROW EXECUTE FUNCTION update_updated_at();
