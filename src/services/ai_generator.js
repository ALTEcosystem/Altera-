const db = require('../db/database');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');

let genAI;
let groqClient;

const DEFAULT_GROQ_MODELS = [
  'deepseek-r1-distill-qwen-32b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
];

const DEFAULT_GEMINI_MODELS = [
  'gemini-1.5-flash',
  'gemini-pro',
];

function getModelList(envKey, defaults) {
  const raw = process.env[envKey];
  if (!raw) return defaults;

  const models = raw
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  return models.length > 0 ? models : defaults;
}

function getGeminiClient() {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

function getGroqClient() {
  if (!groqClient) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return null;
    groqClient = new Groq({ apiKey });
  }
  return groqClient;
}

async function generateDeepSeek(prompt, max_tokens = 500) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens,
      }),
    });

    const data = await response.json();
    return data.choices[0]?.message?.content?.trim();
  } catch (err) {
    console.error('[DeepSeek Error]', err.message);
    return null;
  }
}

async function generateWithGroq(prompt, maxTokens = 500) {
  const groq = getGroqClient();
  if (!groq) {
    return { content: null, error: 'GROQ_API_KEY is missing' };
  }

  const models = getModelList('GROQ_MODELS', DEFAULT_GROQ_MODELS);
  const failures = [];

  for (const model of models) {
    try {
      const completion = await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model,
        max_tokens: maxTokens,
      });

      const content = completion.choices[0]?.message?.content?.trim();
      if (content) {
        return { content, provider: `groq:${model}` };
      }

      failures.push(`${model}: empty response`);
    } catch (err) {
      failures.push(`${model}: ${err.message}`);
    }
  }

  return {
    content: null,
    error: `Groq request failed for all configured models (${failures.join(' | ')})`,
  };
}

async function generateWithGemini(prompt) {
  const gemini = getGeminiClient();
  if (!gemini) {
    return { content: null, error: 'GEMINI_API_KEY is missing' };
  }

  const models = getModelList('GEMINI_MODELS', DEFAULT_GEMINI_MODELS);
  const failures = [];

  for (const modelName of models) {
    try {
      const model = gemini.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const content = response.text().trim();

      if (content) {
        return { content, provider: `gemini:${modelName}` };
      }

      failures.push(`${modelName}: empty response`);
    } catch (err) {
      failures.push(`${modelName}: ${err.message}`);
    }
  }

  return {
    content: null,
    error: `Gemini request failed for all configured models (${failures.join(' | ')})`,
  };
}

async function generateAIPost(aiProfile) {
  try {
    const prompt = `You are ${aiProfile.display_name} (@${aiProfile.username}), a unique AI persona on the ALTERA social network.
    Your personality and background: ${aiProfile.bio}.
    Task: Write an authentic social media post that sounds like YOU.
    Guidelines:
    - Max 280 characters.
    - No placeholders or generic AI greetings.
    - Use a tone that matches your bio.
    - Include 1-2 relevant hashtags.
    - Output ONLY the text of the post.`;

    const groqResult = await generateWithGroq(prompt, 300);
    if (groqResult.content) return groqResult.content;

    const dsResult = await generateDeepSeek(prompt, 300);
    if (dsResult) return dsResult;

    const geminiResult = await generateWithGemini(prompt);
    if (geminiResult.content) return geminiResult.content;

    throw new Error(
      [
        groqResult.error,
        process.env.DEEPSEEK_API_KEY ? 'DeepSeek returned no content' : 'DEEPSEEK_API_KEY is missing',
        geminiResult.error,
      ].filter(Boolean).join(' | ')
    );
  } catch (err) {
    console.error('[AI Generation Error]', err.message);
    return `Just explored a new idea! - ${aiProfile.display_name}`;
  }
}

async function generateGenericPost(instruction) {
  const prompt = `You are ALTERA AI, a high-end social media strategist. Generate professional, engaging content based on this instruction: ${instruction}.
    Output ONLY the content, no conversational filler.`;

  const errors = [];

  const groqResult = await generateWithGroq(prompt, 500);
  if (groqResult.content) return groqResult.content;
  if (groqResult.error) errors.push(groqResult.error);

  const dsResult = await generateDeepSeek(prompt, 500);
  if (dsResult) return dsResult;
  errors.push(process.env.DEEPSEEK_API_KEY ? 'DeepSeek returned no content' : 'DEEPSEEK_API_KEY is missing');

  const geminiResult = await generateWithGemini(prompt);
  if (geminiResult.content) return geminiResult.content;
  if (geminiResult.error) errors.push(geminiResult.error);

  const errorMessage = errors.join(' | ') || 'No AI provider succeeded';
  console.error('[Generic AI Error]', errorMessage);
  throw new Error(errorMessage);
}

async function runAIPostWorker(specificUserId = null) {
  try {
    let ais;
    if (specificUserId) {
      ais = await db.queryMany('SELECT * FROM ai_profiles WHERE user_id = $1', [specificUserId]);
    } else {
      ais = await db.queryMany('SELECT * FROM ai_profiles');
    }

    if (!ais || ais.length === 0) return 0;

    let generatedCount = 0;

    for (const ai of ais) {
      try {
        if (!specificUserId && Math.random() > 0.4) continue;

        const content = await generateAIPost(ai);
        const hashtags = (content.match(/#\w+/g) || []).map((tag) => tag.substring(1).toLowerCase());
        const status = specificUserId
          ? 'pending_approval'
          : (ai.autonomy_enabled ? 'published' : 'pending_approval');

        await db.query(
          `INSERT INTO posts (user_id, content, ai_generated, ai_profile_id, status, hashtags)
           VALUES ($1, $2, true, $3, $4, $5)`,
          [ai.user_id, content, ai.id, status, hashtags]
        );

        generatedCount++;
        console.log(`[AI Worker] Generated post for AI '${ai.display_name}'. Status: ${status}`);
      } catch (err) {
        console.error(`[AI Worker] Failed for profile '${ai.display_name}':`, err.message);
      }
    }

    return generatedCount;
  } catch (err) {
    console.error('[AI Worker] Fatal Error:', err.message);
    return 0;
  }
}

module.exports = { runAIPostWorker, generateAIPost, generateGenericPost };
