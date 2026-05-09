const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const db = require('../db/database');

const router = express.Router();

/**
 * Blockchain routes for Polygon Amoy AIT verification.
 * Migrated to PostgreSQL.
 */

// ─── GET /blockchain/verify-ait/:tokenId ──────────────────────────────────────
router.get('/verify-ait/:tokenId', authMiddleware, async (req, res) => {
  try {
    const { tokenId } = req.params;
    await new Promise(r => setTimeout(r, 300)); // simulate ~300ms RPC latency

    const aiProfile = await db.queryOne('SELECT * FROM ai_profiles WHERE ait_token_id = $1', [tokenId]);
    
    if (!aiProfile) {
      return res.json({
        token_id: tokenId,
        is_valid: false,
        owner_address: null,
        verification_status: 'NOT_FOUND',
        chain: 'polygon-amoy',
        checked_at: new Date().toISOString(),
      });
    }

    res.json({
      token_id: tokenId,
      is_valid: true,
      owner_address: '0x' + '0'.repeat(40), // Mock wallet address
      ai_profile_id: aiProfile.id,
      display_name: aiProfile.display_name,
      health_score: aiProfile.health_score,
      verification_status: 'VERIFIED',
      chain: 'polygon-amoy',
      block_number: 8234567 + Math.floor(Math.random() * 1000),
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ message: 'Blockchain verification failed' });
  }
});

// ─── GET /blockchain/ait-metadata/:tokenId ────────────────────────────────────
router.get('/ait-metadata/:tokenId', authMiddleware, async (req, res) => {
  try {
    const { tokenId } = req.params;
    await new Promise(r => setTimeout(r, 200));

    const aiProfile = await db.queryOne('SELECT * FROM ai_profiles WHERE ait_token_id = $1', [tokenId]);
    if (!aiProfile) return res.status(404).json({ message: 'AIT token not found' });

    res.json({
      token_id: tokenId,
      metadata: {
        name: aiProfile.display_name,
        description: aiProfile.bio,
        image: `ipfs://QmMockHash${tokenId}/avatar.png`,
        attributes: [
          { trait_type: 'Health Score', value: aiProfile.health_score },
          { trait_type: 'Verified', value: aiProfile.is_verified },
        ],
        external_url: `https://altera.io/ai/${aiProfile.username}`,
      },
      ipfs_uri: `ipfs://QmMockHash${tokenId}/metadata.json`,
      gateway_url: `https://w3s.link/ipfs/QmMockHash${tokenId}/metadata.json`,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch AIT metadata' });
  }
});

// ─── GET /blockchain/wallet-ait/:address ──────────────────────────────────────
router.get('/wallet-ait/:address', authMiddleware, async (req, res) => {
  try {
    // In a real scenario, we'd query the blockchain for tokens owned by this address
    // For now, we'll return the AI profiles owned by the current user as a mock
    const aiProfiles = await db.queryMany('SELECT id, username, display_name, is_verified, ait_token_id FROM ai_profiles WHERE user_id = $1', [req.userId]);
    
    const ownedTokens = aiProfiles
      .filter(p => p.ait_token_id)
      .map(p => ({
        token_id: p.ait_token_id,
        ai_profile_id: p.id,
        display_name: p.display_name,
        is_verified: p.is_verified,
      }));
      
    res.json({ wallet_address: req.params.address, owned_tokens: ownedTokens, chain: 'polygon-amoy' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch wallet tokens' });
  }
});

module.exports = router;
