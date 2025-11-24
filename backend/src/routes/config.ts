import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

// Default selectors - can be updated without redeploying
let selectorConfig = {
  version: '1.0.0',
  lastUpdated: new Date().toISOString().split('T')[0],
  platforms: {
    chatgpt: {
      hostnames: ['chatgpt.com', 'chat.openai.com'],
      responseSelectors: [
        '[data-message-author-role="assistant"] .markdown',
        '[data-message-author-role="assistant"] .prose',
        '[data-message-author-role="assistant"] [class*="markdown"]',
        '.agent-turn .markdown',
        '.agent-turn .prose',
        '[class*="ConversationItem"] [class*="prose"]',
        'article[data-testid*="conversation"] .prose'
      ],
      userMessageSelector: '[data-message-author-role="user"]',
      streamingIndicators: [
        '[data-testid="stop-button"]',
        '.result-streaming',
        '[class*="cursor"]'
      ],
      codeBlockSelector: 'pre code'
    },
    claude: {
      hostnames: ['claude.ai'],
      responseSelectors: [
        '[class*="assistant-message"]',
        '[class*="claude-message"]',
        '[class*="prose"]',
        '[data-is-streaming]',
        '.font-claude-message',
        '[class*="Message"] [class*="prose"]',
        '[class*="response-content"]'
      ],
      userMessageSelector: '[class*="human"]',
      streamingIndicators: [
        '[data-is-streaming="true"]'
      ],
      codeBlockSelector: 'pre code'
    },
    gemini: {
      hostnames: ['gemini.google.com'],
      responseSelectors: [
        '[class*="model-response"]',
        '[class*="response-content"]',
        '[class*="message-content"][data-message-author="model"]',
        '.response-container .markdown',
        '[class*="conversation-turn"] [class*="model"]',
        '.model-response-text',
        '[data-message-author="1"]'
      ],
      userMessageSelector: '[class*="query"], [class*="user-message"], [data-message-author="0"]',
      streamingIndicators: [
        '[class*="loading"]',
        '[class*="streaming"]',
        '[class*="stop-button"]',
        '[aria-label*="Stop"]'
      ],
      codeBlockSelector: 'pre code'
    },
    perplexity: {
      hostnames: ['perplexity.ai', 'www.perplexity.ai'],
      responseSelectors: [
        '[class*="answer-content"]',
        '[class*="prose"]',
        '[class*="response-text"]',
        '.answer-body',
        '[class*="AnswerContent"]',
        '[class*="markdown-content"]',
        '[data-testid="answer-content"]'
      ],
      userMessageSelector: '[class*="query-text"], [class*="question"]',
      streamingIndicators: [
        '[class*="typing"]',
        '[class*="loading"]',
        '[class*="generating"]'
      ],
      codeBlockSelector: 'pre code'
    }
  },
  universal: {
    codeBlocks: 'pre code, pre > code, [class*="code-block"], [class*="hljs"]',
    markdown: '[class*="prose"], [class*="markdown"], [class*="content"]',
    aiResponse: '[data-role="assistant"], [data-author="assistant"], [role="article"]'
  }
};

// Try to load from file if exists (for easy updates)
const configPath = path.join(__dirname, '../../config/selectors.json');
try {
  if (fs.existsSync(configPath)) {
    const fileContent = fs.readFileSync(configPath, 'utf-8');
    selectorConfig = JSON.parse(fileContent);
    console.log('Loaded selector config from file:', selectorConfig.version);
  }
} catch (error) {
  console.warn('Could not load selector config file, using defaults');
}

// GET /config/selectors.json - Returns platform selectors
router.get('/selectors.json', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(selectorConfig);
});

// POST /config/selectors - Update selectors (admin only)
router.post('/selectors', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const newConfig = req.body;

    // Validate structure
    if (!newConfig.version || !newConfig.platforms) {
      return res.status(400).json({ error: 'Invalid config structure' });
    }

    // Update in-memory config
    selectorConfig = {
      ...newConfig,
      lastUpdated: new Date().toISOString().split('T')[0]
    };

    // Optionally save to file
    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(selectorConfig, null, 2));
    } catch (e) {
      console.warn('Could not save selector config to file');
    }

    res.json({ success: true, version: selectorConfig.version });
  } catch (error) {
    console.error('Config update error:', error);
    res.status(500).json({ error: 'Failed to update config' });
  }
});

// GET /config/selectors/:platform - Get selectors for specific platform
router.get('/selectors/:platform', (req, res) => {
  const { platform } = req.params;
  const platformConfig = selectorConfig.platforms[platform as keyof typeof selectorConfig.platforms];

  if (!platformConfig) {
    return res.status(404).json({ error: 'Platform not found' });
  }

  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    platform,
    ...platformConfig,
    universal: selectorConfig.universal
  });
});

export { router as configRoutes };
