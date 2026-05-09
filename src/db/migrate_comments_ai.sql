-- Add ai_profile_id to comments table
ALTER TABLE comments ADD COLUMN IF NOT EXISTS ai_profile_id UUID REFERENCES ai_profiles(id) ON DELETE SET NULL;

-- Update comment fetching query to prioritize AI profile info
-- (This is just a comment for reference, actual code will change in JS)
