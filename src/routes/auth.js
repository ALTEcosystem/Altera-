const express = require('express');
const https = require('https');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { generateTokens, verifyRefreshToken, authMiddleware } = require('../middleware/auth');
const db = require('../db/database');
const { sendOTP, sendPasswordResetOTP } = require('../services/email_service');

const router = express.Router();

async function getHumanFollowCounts(userId) {
  const counts = await db.queryOne(
    `SELECT
       (SELECT COUNT(*) FROM follows WHERE following_id = $1) as follower_count,
       (SELECT COUNT(*) FROM follows WHERE follower_id = $1) as following_count,
       (SELECT COUNT(*) FROM posts WHERE user_id = $1 AND ai_profile_id IS NULL AND deleted_at IS NULL) as post_count`,
    [userId]
  );

  return {
    follower_count: parseInt(counts?.follower_count || 0, 10),
    following_count: parseInt(counts?.following_count || 0, 10),
    post_count: parseInt(counts?.post_count || 0, 10),
  };
}

async function getAIFollowCounts(aiProfileId) {
  const counts = await db.queryOne(
    `SELECT
       (SELECT COUNT(*) FROM follows WHERE following_id = $1) as follower_count,
       (SELECT COUNT(*) FROM posts WHERE ai_profile_id = $1 AND deleted_at IS NULL) as post_count`,
    [aiProfileId]
  );

  return {
    follower_count: parseInt(counts?.follower_count || 0, 10),
    post_count: parseInt(counts?.post_count || 0, 10),
  };
}

function toUploadPath(filename) {
  return `/uploads/${filename}`;
}

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

function sanitizeUsername(base) {
  return `${base || 'user'}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20) || 'user';
}

async function createUniqueUsername(base) {
  const normalized = sanitizeUsername(base);
  let candidate = normalized;
  let attempt = 1;

  while (true) {
    const existing = await db.queryOne('SELECT id FROM users WHERE username = $1', [candidate]);
    if (!existing) break;
    candidate = `${normalized}_${attempt}`.slice(0, 20);
    attempt += 1;
  }

  return candidate;
}

// ─── POST /auth/register ──────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { email, password, username, display_name } = req.body;
    if (!email || !password || !username || !display_name) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const existingEmail = await db.queryOne('SELECT id FROM users WHERE email = $1', [email]);
    if (existingEmail) {
      return res.status(409).json({ message: 'An account with this email already exists' });
    }
    
    const existingUser = await db.queryOne('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUser) {
      return res.status(409).json({ message: 'Username is already taken' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const otpRecord = await db.queryOne(
      'SELECT * FROM verification_otps WHERE email = $1',
      [email],
    );
    if (!otpRecord || !otpRecord.is_verified) {
      return res.status(403).json({ message: 'Please verify your email with OTP before creating an account' });
    }
    if (new Date() > otpRecord.expires_at) {
      return res.status(400).json({ message: 'Your verification code has expired. Please request a new OTP.' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const userId = uuidv4();
    
    await db.query(
      'INSERT INTO users (id, email, password_hash, username, full_name, is_verified) VALUES ($1, $2, $3, $4, $5, TRUE)',
      [userId, email, password_hash, username, display_name]
    );
    await db.query('DELETE FROM verification_otps WHERE email = $1', [email]);

    const { token, refreshToken } = generateTokens(userId);

    res.status(201).json({
      token,
      refresh_token: refreshToken,
      user: {
        id: userId,
        email,
        username,
        full_name: display_name,
        wallet_address: null,
        created_at: new Date().toISOString(),
        human_profile: {
          id: userId,
          user_id: userId,
          username,
          display_name,
          avatar: null,
          bio: null,
          follower_count: 0,
          following_count: 0,
          post_count: 0,
          health_score: 100.0,
        },
        ai_profiles: [],
      },
    });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ message: 'Registration failed' });
  }
});

// ─── POST /auth/login ─────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await db.queryOne('SELECT * FROM users WHERE email = $1', [email]);
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const { token, refreshToken } = generateTokens(user.id);
    
    // Human profile counts
    const humanCounts = await getHumanFollowCounts(user.id);

    const aiProfilesRaw = await db.queryMany('SELECT * FROM ai_profiles WHERE user_id = $1', [user.id]);
    
    const aiProfiles = await Promise.all(aiProfilesRaw.map(async (p) => {
      const counts = await getAIFollowCounts(p.id);

      return {
        ...p,
        ...deriveAIMetadata(p),
        follower_count: counts.follower_count,
        post_count: counts.post_count,
      };
    }));

    res.json({
      token,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        wallet_address: user.wallet_address,
        created_at: user.created_at,
        human_profile: {
          id: user.id,
          user_id: user.id,
          username: user.username,
          display_name: user.full_name,
          avatar: user.avatar_url,
          bio: user.bio,
          follower_count: humanCounts.follower_count,
          following_count: humanCounts.following_count,
          post_count: humanCounts.post_count,
          health_score: parseFloat(user.health_score || 100),
        },
        ai_profiles: aiProfiles,
      },
    });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ message: 'Login failed' });
  }
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────
router.post('/logout', authMiddleware, (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

// ─── POST /auth/refresh ───────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      return res.status(401).json({ message: 'Refresh token required' });
    }

    const decoded = verifyRefreshToken(refresh_token);
    if (!decoded) {
      return res.status(401).json({ message: 'Invalid or expired refresh token' });
    }

    const user = await db.queryOne('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Human profile counts
    const humanCounts = await getHumanFollowCounts(user.id);

    const aiProfilesRaw = await db.queryMany('SELECT * FROM ai_profiles WHERE user_id = $1', [user.id]);
    
    const aiProfiles = await Promise.all(aiProfilesRaw.map(async (p) => {
      const counts = await getAIFollowCounts(p.id);

      return {
        ...p,
        ...deriveAIMetadata(p),
        follower_count: counts.follower_count,
        post_count: counts.post_count,
      };
    }));

    const { token, refreshToken } = generateTokens(user.id);

    res.json({
      token,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        wallet_address: user.wallet_address,
        created_at: user.created_at,
        human_profile: {
          id: user.id,
          user_id: user.id,
          username: user.username,
          display_name: user.full_name,
          avatar: user.avatar_url,
          bio: user.bio,
          follower_count: humanCounts.follower_count,
          following_count: humanCounts.following_count,
          post_count: humanCounts.post_count,
          health_score: parseFloat(user.health_score || 100),
        },
        ai_profiles: aiProfiles,
      },
    });
  } catch (err) {
    console.error('[refresh]', err);
    res.status(500).json({ message: 'Refresh failed' });
  }
});

// ─── POST /auth/auth0 — Exchange Auth0 Access Token for local session ────────
router.post('/auth0', async (req, res) => {
  try {
    const { access_token } = req.body;
    if (!access_token) {
      return res.status(400).json({ message: 'access_token is required' });
    }

    // 1. Verify token with Auth0 /userinfo
    const auth0User = await fetchAuth0User(access_token);
    if (!auth0User || !auth0User.email) {
      return res.status(401).json({ message: 'Invalid or expired Auth0 token' });
    }

    const { email, name, nickname, picture } = auth0User;

    // 2. Find or create user
    let user = await db.queryOne('SELECT * FROM users WHERE email = $1', [email]);
    let isNewUser = false;
    
    if (!user) {
      isNewUser = true;
      const userId = uuidv4();
      const username = await createUniqueUsername(nickname || name || email.split('@')[0]);
      // Social users need a placeholder password hash since the column is NOT NULL
      const placeholderHash = await bcrypt.hash(uuidv4(), 12);
      
      await db.query(
        'INSERT INTO users (id, email, username, full_name, avatar_url, password_hash, is_verified) VALUES ($1, $2, $3, $4, $5, $6, TRUE)',
        [userId, email, username, name || username, picture || null, placeholderHash]
      );
      
      user = await db.queryOne('SELECT * FROM users WHERE id = $1', [userId]);
    }

    // 3. Generate local tokens
    const { token, refreshToken } = generateTokens(user.id);

    // 4. Get counts and AI profiles
    const humanCounts = await getHumanFollowCounts(user.id);
    const aiProfilesRaw = await db.queryMany('SELECT * FROM ai_profiles WHERE user_id = $1', [user.id]);
    
    const aiProfiles = await Promise.all(aiProfilesRaw.map(async (p) => {
      const counts = await getAIFollowCounts(p.id);
      return {
        ...p,
        ...deriveAIMetadata(p),
        follower_count: counts.follower_count,
        post_count: counts.post_count,
      };
    }));

    res.json({
      token,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        wallet_address: user.wallet_address,
        created_at: user.created_at,
        human_profile: {
          id: user.id,
          user_id: user.id,
          username: user.username,
          display_name: user.full_name,
          avatar: user.avatar_url,
          bio: user.bio,
          follower_count: humanCounts.follower_count,
          following_count: humanCounts.following_count,
          post_count: humanCounts.post_count,
          health_score: parseFloat(user.health_score || 100),
        },
        ai_profiles: aiProfiles,
      },
      is_new_user: isNewUser,
    });
  } catch (err) {
    console.error('[auth/auth0]', err);
    res.status(500).json({ message: 'Auth0 authentication failed' });
  }
});

/**
 * Helper to fetch user information from Auth0 using an access token.
 */
function fetchAuth0User(accessToken) {
  return new Promise((resolve) => {
    const options = {
      hostname: process.env.AUTH0_DOMAIN,
      path: '/userinfo',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000 // 10 second timeout
    };

    console.log(`[Auth0] Attempting to fetch userinfo from ${options.hostname}...`);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const user = JSON.parse(data);
            console.log(`[Auth0] Successfully fetched user: ${user.email}`);
            resolve(user);
          } catch (e) {
            console.error('[Auth0] Failed to parse response:', e);
            resolve(null);
          }
        } else {
          console.error(`[Auth0] userinfo failed with status ${res.statusCode}: ${data}`);
          resolve(null);
        }
      });
    });

    req.on('timeout', () => {
      console.error('[Auth0] Request timed out after 10s');
      req.destroy();
      resolve(null);
    });

    req.on('error', (err) => {
      console.error('[Auth0] request error:', err.message);
      resolve(null);
    });
    
    req.end();
  });
}


const fs = require('fs');
const path = require('path');

// ─── PUT /auth/profile ───────────────────────────────────────────────────────
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { profile_id, avatar, bio, display_name } = req.body;
    if (!profile_id) return res.status(400).json({ message: 'profile_id is required' });

    let avatarUrl = avatar;
    
    // If avatar is base64 string, decode and save to public/uploads
    if (avatar && avatar.startsWith('data:image')) {
      const matches = avatar.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const extension = matches[1] === 'jpeg' ? 'jpg' : matches[1];
        const buffer = Buffer.from(matches[2], 'base64');
        const filename = `${profile_id}_${Date.now()}.${extension}`;
        const uploadDir = path.join(__dirname, '../../public/uploads');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        const filepath = path.join(uploadDir, filename);
        fs.writeFileSync(filepath, buffer);
        avatarUrl = toUploadPath(filename);
      }
    }

    // Determine if it's the human profile or an AI profile
    if (profile_id === req.userId) {
      // Human profile update
      let updates = [];
      let values = [];
      let i = 1;
      if (avatarUrl) {
        updates.push(`avatar_url = $${i++}`);
        values.push(avatarUrl);
      }
      if (bio !== undefined) {
        updates.push(`bio = $${i++}`);
        values.push(bio);
      }
      if (display_name !== undefined) {
        updates.push(`full_name = $${i++}`);
        values.push(display_name);
      }
      
      if (updates.length > 0) {
        values.push(req.userId);
        await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${i}`, values);
      }
      return res.json({ message: 'Profile updated', avatar_url: avatarUrl });
    } else {
      // AI profile update
      const aiProfile = await db.queryOne('SELECT id FROM ai_profiles WHERE id = $1 AND user_id = $2', [profile_id, req.userId]);
      if (!aiProfile) return res.status(403).json({ message: 'AI Persona not found or unauthorized' });

      let updates = [];
      let values = [];
      let i = 1;
      if (avatarUrl) {
        updates.push(`avatar = $${i++}`);
        values.push(avatarUrl);
      }
      if (bio !== undefined) {
        updates.push(`bio = $${i++}`);
        values.push(bio);
      }
      if (display_name !== undefined) {
        updates.push(`display_name = $${i++}`);
        values.push(display_name);
      }

      if (updates.length > 0) {
        values.push(profile_id);
        await db.query(`UPDATE ai_profiles SET ${updates.join(', ')} WHERE id = $${i}`, values);
      }
      return res.json({ message: 'AI Profile updated', avatar_url: avatarUrl });
    }
  } catch (err) {
    console.error('Error in PUT /profile:', err);
    res.status(500).json({ message: 'Failed to update profile' });
  }
});


// ─── GET /auth/me ─────────────────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await db.queryOne('SELECT * FROM users WHERE id = $1', [req.userId]);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    // Human profile counts
    const humanCounts = await getHumanFollowCounts(user.id);

    const aiProfilesRaw = await db.queryMany('SELECT * FROM ai_profiles WHERE user_id = $1', [user.id]);
    
    const aiProfiles = await Promise.all(aiProfilesRaw.map(async (p) => {
      const counts = await getAIFollowCounts(p.id);

      return {
        ...p,
        ...deriveAIMetadata(p),
        follower_count: counts.follower_count,
        post_count: counts.post_count,
      };
    }));

    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      wallet_address: user.wallet_address,
      created_at: user.created_at,
      human_profile: {
        id: user.id,
        user_id: user.id,
        username: user.username,
        display_name: user.full_name,
        avatar: user.avatar_url,
        bio: user.bio,
        follower_count: humanCounts.follower_count,
        following_count: humanCounts.following_count,
        post_count: humanCounts.post_count,
        health_score: parseFloat(user.health_score || 100),
      },
      ai_profiles: aiProfiles,
    });
  } catch (err) {
    console.error('Error in /me:', err);
    res.status(500).json({ message: 'Failed to fetch user' });
  }
});

// ─── OTP & Password Recovery ────────────────────────────────────────────────

// ─── POST /auth/request-otp — Send verification OTP
router.post('/request-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    // Check if user already exists
    const existing = await db.queryOne('SELECT id FROM users WHERE email = $1', [email]);
    if (existing) return res.status(409).json({ message: 'Email already registered' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000); // 10 mins

    await db.query(
      `INSERT INTO verification_otps (email, otp_code, expires_at, is_verified)
       VALUES ($1, $2, $3, FALSE)
       ON CONFLICT (email) DO UPDATE 
       SET otp_code = $2, expires_at = $3, is_verified = FALSE`,
      [email, otp, expiresAt]
    );

    await sendOTP(email, otp);
    res.json({ message: 'OTP sent to your email' });
  } catch (err) {
    console.error('[request-otp] CRITICAL ERROR:', err);
    res.status(500).json({ 
      message: 'Failed to send OTP', 
      error: process.env.NODE_ENV === 'development' ? err.message : undefined 
    });
  }
});

// ─── POST /auth/verify-otp — Verify the code
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ message: 'Email and OTP required' });

    const record = await db.queryOne(
      'SELECT * FROM verification_otps WHERE email = $1 AND otp_code = $2',
      [email, otp]
    );

    if (!record) return res.status(400).json({ message: 'Invalid OTP' });
    if (new Date() > record.expires_at) return res.status(400).json({ message: 'OTP expired' });

    await db.query('UPDATE verification_otps SET is_verified = TRUE WHERE email = $1', [email]);
    res.json({ message: 'Email verified successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Verification failed' });
  }
});

// ─── POST /auth/forgot-password — Request reset
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required' });

    const user = await db.queryOne('SELECT id FROM users WHERE email = $1', [email]);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000);

    await db.query(
      `INSERT INTO verification_otps (email, otp_code, expires_at, is_verified)
       VALUES ($1, $2, $3, FALSE)
       ON CONFLICT (email) DO UPDATE 
       SET otp_code = $2, expires_at = $3, is_verified = FALSE`,
      [email, otp, expiresAt]
    );

    await sendPasswordResetOTP(email, otp);
    res.json({ message: 'Password reset OTP sent' });
  } catch (err) {
    console.error('[forgot-password] CRITICAL ERROR:', err);
    res.status(500).json({ 
      message: 'Failed to send reset code',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// ─── POST /auth/reset-password — Complete reset
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, new_password } = req.body;
    if (!email || !otp || !new_password) {
      return res.status(400).json({ message: 'Email, OTP, and new password are required' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const user = await db.queryOne('SELECT id FROM users WHERE email = $1', [email]);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const otpRecord = await db.queryOne(
      'SELECT * FROM verification_otps WHERE email = $1 AND otp_code = $2',
      [email, otp]
    );
    if (!otpRecord) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }
    if (new Date() > otpRecord.expires_at) {
      return res.status(400).json({ message: 'OTP expired' });
    }

    const hash = await bcrypt.hash(new_password, 12);
    await db.query('UPDATE users SET password_hash = $1 WHERE email = $2', [hash, email]);
    await db.query('DELETE FROM verification_otps WHERE email = $1', [email]);

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to reset password' });
  }
});

// ─── POST /auth/change-password — Functional change for logged-in user
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { old_password, new_password } = req.body;
    if (!old_password || !new_password) return res.status(400).json({ message: 'Both passwords required' });

    const user = await db.queryOne('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
    const valid = await bcrypt.compare(old_password, user.password_hash);
    if (!valid) return res.status(401).json({ message: 'Incorrect old password' });

    const hash = await bcrypt.hash(new_password, 12);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.userId]);

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to change password' });
  }
});

// ─── POST /auth/set-initial-password — Set password for new social login users
router.post('/set-initial-password', authMiddleware, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const user = await db.queryOne('SELECT created_at FROM users WHERE id = $1', [req.userId]);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Allow setting initial password only if the account is relatively new (e.g., within 1 hour)
    // Or we could add a specific flag to the DB, but this is a simpler heuristic for social logins
    const hash = await bcrypt.hash(password, 12);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.userId]);

    res.json({ message: 'Initial password set successfully' });
  } catch (err) {
    console.error('[set-initial-password]', err);
    res.status(500).json({ message: 'Failed to set password' });
  }
});

module.exports = router;
