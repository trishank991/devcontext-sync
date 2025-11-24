// DevContext Sync - Background Service Worker
// Uses IndexedDB via storage.js module

importScripts('storage.js');

// ============================================
// Remote Selector Configuration System
// ============================================

const SELECTOR_CONFIG = {
  remoteUrl: 'https://devcontext-sync-api.fly.dev/config/selectors',
  cacheKey: 'platformSelectors',
  cacheExpiry: 24 * 60 * 60 * 1000, // 24 hours
  lastFetchKey: 'selectorsFetchedAt'
};

// Default selectors bundled with extension (fallback)
let DEFAULT_SELECTORS = null;

async function loadDefaultSelectors() {
  try {
    const response = await fetch(chrome.runtime.getURL('selectors.json'));
    DEFAULT_SELECTORS = await response.json();
    return DEFAULT_SELECTORS;
  } catch (error) {
    console.error('[DevContext] Failed to load default selectors:', error);
    return null;
  }
}

async function fetchRemoteSelectors() {
  // Timeout to prevent hanging on slow/unresponsive servers
  const FETCH_TIMEOUT_MS = 10000; // 10 seconds
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(SELECTOR_CONFIG.remoteUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-cache',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const selectors = await response.json();

    // Validate structure
    if (!selectors.version || !selectors.platforms) {
      throw new Error('Invalid selector config structure');
    }

    // Cache the selectors
    await chrome.storage.local.set({
      [SELECTOR_CONFIG.cacheKey]: selectors,
      [SELECTOR_CONFIG.lastFetchKey]: Date.now()
    });

    console.log('[DevContext] Remote selectors updated:', selectors.version);
    return selectors;
  } catch (error) {
    clearTimeout(timeoutId);
    const errorMessage = error.name === 'AbortError'
      ? 'Request timed out'
      : error.message;
    console.warn('[DevContext] Failed to fetch remote selectors:', errorMessage);
    return null;
  }
}

async function getSelectors() {
  // Check cache first
  const cached = await chrome.storage.local.get([
    SELECTOR_CONFIG.cacheKey,
    SELECTOR_CONFIG.lastFetchKey
  ]);

  const now = Date.now();
  const lastFetch = cached[SELECTOR_CONFIG.lastFetchKey] || 0;
  const cacheAge = now - lastFetch;

  // If cache is fresh, use it
  if (cached[SELECTOR_CONFIG.cacheKey] && cacheAge < SELECTOR_CONFIG.cacheExpiry) {
    return cached[SELECTOR_CONFIG.cacheKey];
  }

  // Try to fetch remote selectors
  const remote = await fetchRemoteSelectors();
  if (remote) {
    return remote;
  }

  // Fall back to cached (even if stale) or default
  if (cached[SELECTOR_CONFIG.cacheKey]) {
    console.log('[DevContext] Using stale cached selectors');
    return cached[SELECTOR_CONFIG.cacheKey];
  }

  // Load and return default selectors
  if (!DEFAULT_SELECTORS) {
    await loadDefaultSelectors();
  }
  return DEFAULT_SELECTORS;
}

// Notify content scripts of selector updates
async function broadcastSelectorUpdate(selectors) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && (
      tab.url.includes('chatgpt.com') ||
      tab.url.includes('chat.openai.com') ||
      tab.url.includes('claude.ai') ||
      tab.url.includes('gemini.google.com') ||
      tab.url.includes('perplexity.ai')
    )) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'SELECTORS_UPDATED',
          selectors
        });
      } catch {
        // Tab might not have content script loaded
      }
    }
  }
}

// Beta limits - more generous to encourage adoption
// Pro tier will offer: unlimited + cloud sync + team features
const FREE_LIMITS = {
  snippets: 100,      // Was 50, increased for beta
  knowledge: 200,     // Was 100, increased for beta
  projects: 5,        // Was 3, increased for beta
  // Soft limit thresholds (percentage)
  warningThreshold: 0.8,  // Warn at 80%
  graceSaves: 5           // Allow 5 grace saves after limit
};

// Generic limit checker to avoid duplicated logic in handlers
async function checkLimits(itemType, projectId, graceSettingKey) {
  const isPremium = await getSetting('isPremium');
  if (isPremium) return null;

  const items = await getByIndex(itemType, 'projectId', projectId);
  const count = items.length;
  const limit = FREE_LIMITS[itemType] || 0;
  const warningAt = Math.floor(limit * FREE_LIMITS.warningThreshold);

  // Hard limit reached
  if (count >= limit) {
    const graceSavesUsed = await getSetting(graceSettingKey) || 0;
    if (graceSavesUsed >= FREE_LIMITS.graceSaves) {
      return {
        limitReached: true,
        error: `Free limit reached (${limit} ${itemType}). Upgrade to Pro for unlimited.`,
        count,
        limit
      };
    }

    // Consume a grace save
    await setSetting(graceSettingKey, graceSavesUsed + 1);
    return {
      warning: {
        type: 'grace_save',
        message: `Limit reached! Using grace save (${FREE_LIMITS.graceSaves - graceSavesUsed - 1} remaining)`,
        graceSavesRemaining: FREE_LIMITS.graceSaves - graceSavesUsed - 1
      }
    };
  }

  // Approaching soft limit
  if (count >= warningAt) {
    return {
      warning: {
        type: 'approaching',
        message: `You've used ${count}/${limit} ${itemType} (${Math.round(count / limit * 100)}%)`,
        count,
        limit,
        percentage: Math.round(count / limit * 100)
      }
    };
  }

  return null;
}

// ============================================
// Auto-Tagging Patterns (SACE - Smart Auto-Context Extraction)
// ============================================

const AUTO_TAG_PATTERNS = {
  // Languages & Frameworks
  javascript: /\b(javascript|js|node|npm|yarn|webpack|babel)\b/i,
  typescript: /\b(typescript|ts|interface|type\s+\w+)\b/i,
  react: /\b(react|useState|useEffect|jsx|component|props|redux)\b/i,
  vue: /\b(vue|vuex|nuxt|v-model|v-if)\b/i,
  angular: /\b(angular|ngModule|@Component|rxjs)\b/i,
  python: /\b(python|pip|django|flask|pandas|numpy)\b/i,
  rust: /\b(rust|cargo|impl|fn\s+\w+|let\s+mut)\b/i,
  go: /\b(golang|go\s+func|goroutine|chan\s+\w+)\b/i,

  // Concepts
  api: /\b(api|endpoint|rest|graphql|fetch|axios|request)\b/i,
  database: /\b(database|sql|query|mongodb|postgres|mysql|redis)\b/i,
  auth: /\b(auth|jwt|oauth|token|login|session|password)\b/i,
  error: /\b(error|exception|failed|cannot|undefined|null|bug|fix)\b/i,
  testing: /\b(test|jest|mocha|pytest|spec|assert|mock)\b/i,
  security: /\b(security|vulnerability|xss|csrf|injection|encrypt)\b/i,
  performance: /\b(performance|optimize|cache|lazy|memory|speed)\b/i,
  deployment: /\b(deploy|docker|kubernetes|ci\/cd|pipeline|aws|gcp)\b/i,

  // Content Types
  explanation: /\b(how|why|what|explain|understand|means|because)\b/i,
  tutorial: /\b(step|first|then|next|finally|guide|tutorial)\b/i,
  debugging: /\b(debug|trace|stack|breakpoint|console\.log|print)\b/i,
  refactor: /\b(refactor|improve|clean|simplify|better|instead)\b/i
};

function autoDetectTags(text) {
  const tags = [];
  const lowerText = text.toLowerCase();

  for (const [tag, pattern] of Object.entries(AUTO_TAG_PATTERNS)) {
    if (pattern.test(lowerText)) {
      tags.push(tag);
    }
  }

  // Limit to top 5 most relevant tags
  return tags.slice(0, 5);
}

function detectLanguageFromCode(code) {
  // Simple language detection based on syntax patterns
  const patterns = {
    javascript: /\b(const|let|var|function|=>|async|await)\b/,
    typescript: /\b(interface|type|enum|namespace|declare)\b/,
    python: /\b(def|import|from|class|if __name__|print\()/,
    rust: /\b(fn|let\s+mut|impl|struct|enum|pub\s+fn)\b/,
    go: /\b(func|package|import|type\s+\w+\s+struct)\b/,
    java: /\b(public\s+class|private|void|System\.out)\b/,
    csharp: /\b(using|namespace|public\s+class|Console\.)/,
    ruby: /\b(def|end|require|class\s+\w+|puts)\b/,
    php: /(<\?php|\$\w+|function\s+\w+\s*\(|echo)\b/,
    sql: /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN)\b/i,
    html: /<(!DOCTYPE|html|head|body|div|span|script)/i,
    css: /\{[\s\S]*?(color|margin|padding|display):/,
    bash: /(^#!\/|\\b(echo|export|fi|done)\\b|\bif\s+\[)/,
    yaml: /^\s*\w+:\s*[\w\-]+$/m,
    json: /^\s*[\[{]/
  };

  for (const [lang, pattern] of Object.entries(patterns)) {
    if (pattern.test(code)) {
      return lang;
    }
  }

  return 'text';
}

// ============================================
// Extension Lifecycle
// ============================================

chrome.runtime.onInstalled.addListener(async (details) => {
  // Initialize settings if needed
  const isPremium = await getSetting('isPremium');
  if (isPremium === null) {
    await setSetting('isPremium', false);
    await setSetting('theme', 'dark');
  }

  // Track if this is first install for onboarding
  if (details.reason === 'install') {
    await setSetting('isFirstRun', true);
    await setSetting('installDate', Date.now());

    // Auto-create first project
    const firstProject = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      name: 'My First Project',
      description: 'Your default project for saved snippets and knowledge',
      createdAt: Date.now()
    };
    await saveData('projects', firstProject);
    await setSetting('activeProjectId', firstProject.id);
  }

  // Create context menus
  chrome.contextMenus.create({
    id: 'devcontext-save-selection',
    title: 'Save to DevContext',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'devcontext-save-code',
    title: 'Save as Code Snippet',
    contexts: ['selection']
  });

  // Load default selectors and try to fetch remote updates
  await loadDefaultSelectors();
  fetchRemoteSelectors(); // Fire and forget - will cache for later

  console.log('DevContext Sync installed');
});

// ============================================
// Context Menu Handler
// ============================================

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.selectionText) return;

  const activeProjectId = await getSetting('activeProjectId');

  if (!activeProjectId) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'DevContext Sync',
      message: 'Please select a project first'
    });
    return;
  }

  let hostname = 'unknown';
  let sourceUrl = '';
  try {
    if (tab.url) {
      hostname = new URL(tab.url).hostname;
      sourceUrl = tab.url;
    }
  } catch (e) {
    // Invalid URL, use defaults
  }

  try {
    if (info.menuItemId === 'devcontext-save-selection') {
      // Check for duplicate knowledge
      const duplicateCheck = await findDuplicateKnowledge(
        'Selected text from ' + hostname,
        info.selectionText,
        activeProjectId
      );

      if (duplicateCheck.isDuplicate) {
        const savedDate = new Date(duplicateCheck.existingItem.createdAt).toLocaleDateString();
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'DevContext Sync - Duplicate Found',
          message: duplicateCheck.matchType === 'exact'
            ? `Already saved on ${savedDate}`
            : `${duplicateCheck.similarity}% similar to item saved on ${savedDate}`
        });

        // Log the duplicate attempt
        await logActivity('duplicate_detected', 'knowledge', duplicateCheck.existingItem.id, {
          projectId: activeProjectId,
          source: sourceUrl,
          platform: extractPlatformFromSource(sourceUrl)
        });
        return;
      }

      const id = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      await saveData('knowledge', {
        id,
        projectId: activeProjectId,
        question: 'Selected text from ' + hostname,
        answer: info.selectionText,
        source: sourceUrl,
        tags: [],
        createdAt: Date.now()
      });

      // Log the save
      await logActivity('save', 'knowledge', id, {
        projectId: activeProjectId,
        source: sourceUrl,
        contentHash: hashContent(normalizeContent(info.selectionText)),
        platform: extractPlatformFromSource(sourceUrl)
      });

    } else if (info.menuItemId === 'devcontext-save-code') {
      // Check for duplicate snippet
      const duplicateCheck = await findDuplicateSnippet(info.selectionText, activeProjectId);

      if (duplicateCheck.isDuplicate) {
        const savedDate = new Date(duplicateCheck.existingItem.createdAt).toLocaleDateString();
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'DevContext Sync - Duplicate Found',
          message: duplicateCheck.matchType === 'exact'
            ? `Already saved on ${savedDate}`
            : `${duplicateCheck.similarity}% similar to snippet saved on ${savedDate}`
        });

        // Log the duplicate attempt
        await logActivity('duplicate_detected', 'snippet', duplicateCheck.existingItem.id, {
          projectId: activeProjectId,
          source: sourceUrl,
          platform: extractPlatformFromSource(sourceUrl)
        });
        return;
      }

      const id = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      await saveData('snippets', {
        id,
        projectId: activeProjectId,
        code: info.selectionText,
        language: 'text',
        description: 'Selected from ' + hostname,
        source: sourceUrl,
        createdAt: Date.now()
      });

      // Log the save
      await logActivity('save', 'snippet', id, {
        projectId: activeProjectId,
        source: sourceUrl,
        contentHash: hashContent(normalizeContent(info.selectionText)),
        platform: extractPlatformFromSource(sourceUrl)
      });
    }

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'DevContext Sync',
      message: 'Saved successfully!'
    });
  } catch (error) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'DevContext Sync',
      message: 'Failed to save: ' + error.message
    });
  }
});

// ============================================
// Message Handler
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'SAVE_SNIPPET':
      return handleSaveSnippet(message.data);

    case 'SAVE_KNOWLEDGE':
      return handleSaveKnowledge(message.data);

    case 'GET_ACTIVE_PROJECT':
      return handleGetActiveProject();

    case 'GET_ALL_PROJECTS':
      return handleGetAllProjects();

    case 'CREATE_PROJECT':
      return handleCreateProject(message.data);

    case 'SET_ACTIVE_PROJECT':
      return handleSetActiveProject(message.data.projectId);

    case 'DELETE_PROJECT':
      return handleDeleteProject(message.data.projectId);

    case 'GET_SNIPPETS':
      return handleGetSnippets(message.data?.projectId);

    case 'GET_KNOWLEDGE':
      return handleGetKnowledge(message.data?.projectId);

    case 'DELETE_SNIPPET':
      return handleDeleteSnippet(message.data.id);

    case 'DELETE_KNOWLEDGE':
      return handleDeleteKnowledge(message.data.id);

    case 'GET_STORAGE_STATS':
      return getStorageStats();

    case 'EXPORT_DATA':
      return exportAllData();

    case 'IMPORT_DATA':
      return importData(message.data);

    case 'GET_SETTINGS':
      return handleGetSettings();

    case 'UPDATE_SETTING':
      return handleUpdateSetting(message.data.key, message.data.value);

    // Cloud sync messages (premium)
    case 'CLOUD_LOGIN':
      return cloudLogin(message.data.email, message.data.password);

    case 'CLOUD_LOGOUT':
      return cloudLogout();

    case 'GET_CLOUD_STATUS':
      return getCloudStatus();

    case 'FORCE_SYNC':
      return handleForceSync();

    case 'PROJECT_CHANGED':
      notifyTabsOfProjectChange(message.projectId);
      return { success: true };

    // Activity log messages
    case 'GET_ACTIVITY_LOG':
      return handleGetActivityLog(message.data || {});

    case 'CLEAR_ACTIVITY_LOG':
      return handleClearActivityLog();

    // Force save (bypass duplicate check)
    case 'FORCE_SAVE_SNIPPET':
      return handleForceSaveSnippet(message.data);

    case 'FORCE_SAVE_KNOWLEDGE':
      return handleForceSaveKnowledge(message.data);

    // Search messages
    case 'SEARCH_SNIPPETS':
      return handleSearchSnippets(message.data);

    case 'SEARCH_KNOWLEDGE':
      return handleSearchKnowledge(message.data);

    case 'SEARCH_ALL':
      return handleSearchAll(message.data);

    case 'GET_SELECTORS':
      return getSelectors();

    case 'REFRESH_SELECTORS':
    {
      const selectors = await fetchRemoteSelectors();
      if (selectors) {
        await broadcastSelectorUpdate(selectors);
      }
      return { success: !!selectors, selectors };
    }

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

// ============================================
// Handlers
// ============================================

async function handleSaveSnippet(data) {
  const activeProjectId = await getSetting('activeProjectId');

  if (!activeProjectId) {
    return { success: false, error: 'No active project' };
  }
  let limitWarning = null;
  const limitCheck = await checkLimits('snippets', activeProjectId, 'snippetGraceSaves');
  if (limitCheck?.limitReached) {
    return { success: false, ...limitCheck };
  }
  if (limitCheck?.warning) {
    limitWarning = limitCheck.warning;
  }

  // Check for duplicates before saving
  const duplicateCheck = await findDuplicateSnippet(data.code, activeProjectId);
  if (duplicateCheck.isDuplicate) {
    const existing = duplicateCheck.existingItem;
    const savedDate = new Date(existing.createdAt).toLocaleDateString();

    // Log the duplicate detection
    await logActivity('duplicate_detected', 'snippet', existing.id, {
      projectId: activeProjectId,
      source: data.source || 'unknown',
      contentHash: hashContent(normalizeContent(data.code)),
      metadata: {
        matchType: duplicateCheck.matchType,
        similarity: duplicateCheck.similarity || 100,
        attemptedSource: data.source
      }
    });

    return {
      success: false,
      isDuplicate: true,
      matchType: duplicateCheck.matchType,
      similarity: duplicateCheck.similarity || 100,
      existingItem: {
        id: existing.id,
        description: existing.description,
        source: existing.source,
        createdAt: existing.createdAt,
        savedDate
      },
      error: duplicateCheck.matchType === 'exact'
        ? `This exact snippet was already saved on ${savedDate} from ${existing.source || 'unknown source'}`
        : `A similar snippet (${duplicateCheck.similarity}% match) was saved on ${savedDate} from ${existing.source || 'unknown source'}`
    };
  }

  const snippet = {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    projectId: activeProjectId,
    code: data.code,
    language: data.language || 'text',
    description: data.description || '',
    source: data.source || 'unknown',
    createdAt: Date.now()
  };

  await saveData('snippets', snippet);

  // Log the save activity
  await logActivity('save', 'snippet', snippet.id, {
    projectId: activeProjectId,
    source: data.source || 'unknown',
    contentHash: hashContent(normalizeContent(data.code)),
    platform: extractPlatformFromSource(data.source)
  });

  const result = { success: true, id: snippet.id };
  if (limitWarning) {
    result.warning = limitWarning;
  }
  return result;
}

async function handleSaveKnowledge(data) {
  const activeProjectId = await getSetting('activeProjectId');

  if (!activeProjectId) {
    return { success: false, error: 'No active project' };
  }
  let limitWarning = null;
  const limitCheck = await checkLimits('knowledge', activeProjectId, 'knowledgeGraceSaves');
  if (limitCheck?.limitReached) {
    return { success: false, ...limitCheck };
  }
  if (limitCheck?.warning) {
    limitWarning = limitCheck.warning;
  }

  // Check for duplicates before saving
  const duplicateCheck = await findDuplicateKnowledge(data.question, data.answer, activeProjectId);
  if (duplicateCheck.isDuplicate) {
    const existing = duplicateCheck.existingItem;
    const savedDate = new Date(existing.createdAt).toLocaleDateString();

    // Log the duplicate detection
    await logActivity('duplicate_detected', 'knowledge', existing.id, {
      projectId: activeProjectId,
      source: data.source || 'unknown',
      contentHash: hashContent(normalizeContent(data.question + data.answer)),
      metadata: {
        matchType: duplicateCheck.matchType,
        similarity: duplicateCheck.similarity || 100,
        attemptedSource: data.source
      }
    });

    return {
      success: false,
      isDuplicate: true,
      matchType: duplicateCheck.matchType,
      similarity: duplicateCheck.similarity || 100,
      existingItem: {
        id: existing.id,
        question: existing.question,
        source: existing.source,
        createdAt: existing.createdAt,
        savedDate
      },
      error: duplicateCheck.matchType === 'exact'
        ? `This exact knowledge was already saved on ${savedDate} from ${existing.source || 'unknown source'}`
        : `Similar knowledge (${duplicateCheck.similarity}% match) was saved on ${savedDate} from ${existing.source || 'unknown source'}`
    };
  }

  // Auto-detect tags if none provided
  const autoTags = autoDetectTags(data.question + ' ' + data.answer);
  const userTags = data.tags || [];
  const mergedTags = [...new Set([...userTags, ...autoTags])].slice(0, 10);

  const item = {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    projectId: activeProjectId,
    question: data.question,
    answer: data.answer,
    source: data.source || 'unknown',
    tags: mergedTags,
    createdAt: Date.now()
  };

  await saveData('knowledge', item);

  // Log the save activity
  await logActivity('save', 'knowledge', item.id, {
    projectId: activeProjectId,
    source: data.source || 'unknown',
    contentHash: hashContent(normalizeContent(data.question + data.answer)),
    platform: extractPlatformFromSource(data.source)
  });

  const result = { success: true, id: item.id };
  if (limitWarning) {
    result.warning = limitWarning;
  }
  return result;
}

async function handleGetActiveProject() {
  const activeProjectId = await getSetting('activeProjectId');
  if (!activeProjectId) {
    return { project: null };
  }

  const project = await getById('projects', activeProjectId);
  if (!project) {
    return { project: null };
  }

  // Get associated snippets and knowledge counts
  const snippets = await getByIndex('snippets', 'projectId', activeProjectId);
  const knowledge = await getByIndex('knowledge', 'projectId', activeProjectId);

  return {
    project: {
      ...project,
      snippetCount: snippets.length,
      knowledgeCount: knowledge.length
    }
  };
}

async function handleGetAllProjects() {
  const projects = await getAllData('projects');
  const activeProjectId = await getSetting('activeProjectId');

  // Add counts to each project
  const projectsWithCounts = await Promise.all(
    projects.map(async (project) => {
      const snippets = await getByIndex('snippets', 'projectId', project.id);
      const knowledge = await getByIndex('knowledge', 'projectId', project.id);
      return {
        ...project,
        snippetCount: snippets.length,
        knowledgeCount: knowledge.length,
        isActive: project.id === activeProjectId
      };
    })
  );

  return { projects: projectsWithCounts };
}

async function handleCreateProject(data) {
  const isPremium = await getSetting('isPremium');

  if (!isPremium) {
    const projects = await getAllData('projects');
    if (projects.length >= FREE_LIMITS.projects) {
      return {
        success: false,
        error: `Free limit reached (${FREE_LIMITS.projects} projects). Upgrade to Pro for unlimited.`
      };
    }
  }

  const project = {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    name: data.name || 'New Project',
    createdAt: Date.now()
  };

  await saveData('projects', project);

  // Set as active if it's the first project
  const activeProjectId = await getSetting('activeProjectId');
  if (!activeProjectId) {
    await setSetting('activeProjectId', project.id);
  }

  return { success: true, project };
}

async function handleSetActiveProject(projectId) {
  const project = await getById('projects', projectId);
  if (!project) {
    return { success: false, error: 'Project not found' };
  }

  await setSetting('activeProjectId', projectId);
  notifyTabsOfProjectChange(projectId);

  return { success: true };
}

async function handleDeleteProject(projectId) {
  // Delete all associated snippets and knowledge
  const snippets = await getByIndex('snippets', 'projectId', projectId);
  for (const snippet of snippets) {
    await deleteById('snippets', snippet.id);
  }

  const knowledge = await getByIndex('knowledge', 'projectId', projectId);
  for (const item of knowledge) {
    await deleteById('knowledge', item.id);
  }

  // Delete the project
  await deleteById('projects', projectId);

  // Clear active project if this was it
  const activeProjectId = await getSetting('activeProjectId');
  if (activeProjectId === projectId) {
    const remainingProjects = await getAllData('projects');
    if (remainingProjects.length > 0) {
      await setSetting('activeProjectId', remainingProjects[0].id);
    } else {
      await setSetting('activeProjectId', null);
    }
  }

  return { success: true };
}

async function handleGetSnippets(projectId) {
  const targetProjectId = projectId || await getSetting('activeProjectId');
  if (!targetProjectId) {
    return { snippets: [] };
  }

  const snippets = await getByIndex('snippets', 'projectId', targetProjectId);
  return { snippets: snippets.sort((a, b) => b.createdAt - a.createdAt) };
}

async function handleGetKnowledge(projectId) {
  const targetProjectId = projectId || await getSetting('activeProjectId');
  if (!targetProjectId) {
    return { knowledge: [] };
  }

  const knowledge = await getByIndex('knowledge', 'projectId', targetProjectId);
  return { knowledge: knowledge.sort((a, b) => b.createdAt - a.createdAt) };
}

async function handleDeleteSnippet(id) {
  await deleteById('snippets', id);
  return { success: true };
}

async function handleDeleteKnowledge(id) {
  await deleteById('knowledge', id);
  return { success: true };
}

async function handleGetSettings() {
  const settings = {
    isPremium: await getSetting('isPremium') || false,
    theme: await getSetting('theme') || 'dark',
    cloudSyncEnabled: await getSetting('cloudSyncEnabled') || false,
    activeProjectId: await getSetting('activeProjectId'),
    autoPromptEnabled: await getSetting('autoPromptEnabled') !== false // Default to true
  };
  return { settings };
}

async function handleUpdateSetting(key, value) {
  await setSetting(key, value);
  return { success: true };
}

async function handleForceSync() {
  const pushResult = await processSyncQueue();
  const pullResult = await pullFromCloud();

  return {
    success: true,
    pushed: pushResult.synced,
    pulled: pullResult.imported || {}
  };
}

function notifyTabsOfProjectChange(projectId) {
  chrome.tabs.query({}, (tabs) => {
    const targetUrls = ['chat.openai.com', 'chatgpt.com', 'claude.ai'];

    tabs.forEach((tab) => {
      if (tab.url && targetUrls.some((url) => tab.url.includes(url))) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'PROJECT_UPDATED',
          projectId
        }).catch(() => {});
      }
    });
  });
}

// ============================================
// Utility Functions
// ============================================

function extractPlatformFromSource(source) {
  if (!source) return 'unknown';

  const sourceUrl = source.toLowerCase();
  if (sourceUrl.includes('chat.openai.com') || sourceUrl.includes('chatgpt.com')) {
    return 'chatgpt';
  } else if (sourceUrl.includes('claude.ai')) {
    return 'claude';
  } else if (sourceUrl.includes('bard.google.com') || sourceUrl.includes('gemini.google.com')) {
    return 'gemini';
  } else if (sourceUrl.includes('github.com')) {
    return 'github';
  } else if (sourceUrl.includes('stackoverflow.com')) {
    return 'stackoverflow';
  } else if (sourceUrl.includes('docs.')) {
    return 'documentation';
  }
  return 'web';
}

// ============================================
// Activity Log Handlers
// ============================================

async function handleGetActivityLog(options = {}) {
  const logs = await getActivityLog(options);
  return { success: true, logs };
}

async function handleClearActivityLog() {
  const database = await initDB();
  if (!database) {
    return { success: false, error: 'Database not available' };
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['activityLog'], 'readwrite');
    const store = transaction.objectStore('activityLog');
    const request = store.clear();

    request.onsuccess = () => resolve({ success: true });
    request.onerror = () => reject({ success: false, error: request.error });
  });
}

// Force save handlers (bypass duplicate detection)
async function handleForceSaveSnippet(data) {
  const activeProjectId = await getSetting('activeProjectId');

  if (!activeProjectId) {
    return { success: false, error: 'No active project' };
  }

  const isPremium = await getSetting('isPremium');

  if (!isPremium) {
    const snippets = await getByIndex('snippets', 'projectId', activeProjectId);
    if (snippets.length >= FREE_LIMITS.snippets) {
      return {
        success: false,
        error: `Free limit reached (${FREE_LIMITS.snippets} snippets). Upgrade to Pro for unlimited.`
      };
    }
  }

  const snippet = {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    projectId: activeProjectId,
    code: data.code,
    language: data.language || 'text',
    description: data.description || '',
    source: data.source || 'unknown',
    createdAt: Date.now()
  };

  await saveData('snippets', snippet);

  // Log the force save activity
  await logActivity('save', 'snippet', snippet.id, {
    projectId: activeProjectId,
    source: data.source || 'unknown',
    contentHash: hashContent(normalizeContent(data.code)),
    platform: extractPlatformFromSource(data.source),
    metadata: { forceSaved: true }
  });

  return { success: true, id: snippet.id };
}

async function handleForceSaveKnowledge(data) {
  const activeProjectId = await getSetting('activeProjectId');

  if (!activeProjectId) {
    return { success: false, error: 'No active project' };
  }

  const isPremium = await getSetting('isPremium');

  if (!isPremium) {
    const knowledge = await getByIndex('knowledge', 'projectId', activeProjectId);
    if (knowledge.length >= FREE_LIMITS.knowledge) {
      return {
        success: false,
        error: `Free limit reached (${FREE_LIMITS.knowledge} items). Upgrade to Pro for unlimited.`
      };
    }
  }

  const item = {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    projectId: activeProjectId,
    question: data.question,
    answer: data.answer,
    source: data.source || 'unknown',
    tags: data.tags || [],
    createdAt: Date.now()
  };

  await saveData('knowledge', item);

  // Log the force save activity
  await logActivity('save', 'knowledge', item.id, {
    projectId: activeProjectId,
    source: data.source || 'unknown',
    contentHash: hashContent(normalizeContent(data.question + data.answer)),
    platform: extractPlatformFromSource(data.source),
    metadata: { forceSaved: true }
  });

  return { success: true, id: item.id };
}

// ============================================
// Search Handlers
// ============================================

async function handleSearchSnippets(data) {
  const { query, projectId, options = {} } = data;
  const targetProjectId = projectId || await getSetting('activeProjectId');

  const results = await searchSnippets(query, targetProjectId, options);
  return { success: true, results };
}

async function handleSearchKnowledge(data) {
  const { query, projectId, options = {} } = data;
  const targetProjectId = projectId || await getSetting('activeProjectId');

  const results = await searchKnowledge(query, targetProjectId, options);
  return { success: true, results };
}

async function handleSearchAll(data) {
  const { query, projectId, options = {} } = data;
  const targetProjectId = projectId || await getSetting('activeProjectId');

  const results = await searchAll(query, targetProjectId, options);
  return { success: true, results };
}
