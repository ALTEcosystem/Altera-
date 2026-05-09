const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const db = require('../db/database');
const { runAIPostWorker, generateGenericPost } = require('../services/ai_generator');

const router = express.Router();

// ─── POST /ai/generate-posts ─────────────────────────────────────────────────
// Manually triggers the AI Post generation worker (for testing)
router.post('/generate-posts', authMiddleware, async (req, res) => {
  try {
    const generatedCount = await runAIPostWorker(req.userId);
    res.json({ 
      message: `Successfully generated ${generatedCount} posts.`,
      count: generatedCount 
    });
  } catch (err) {
    console.error('[AI Route Error]', err);
    res.status(500).json({ message: 'Failed to generate AI posts' });
  }
});

router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { instruction } = req.body;
    if (!instruction) {
      return res.status(400).json({ message: 'Instruction is required' });
    }
    const result = await generateGenericPost(instruction);
    res.json({ content: result });
  } catch (err) {
    console.error('[AI Generate Route Error]', err);
    res.status(503).json({ message: err.message || 'Failed to generate content' });
  }
});

module.exports = router;
