// DevContext Sync - Storage Module
// IndexedDB for large capacity (50MB+) with cloud sync (premium feature)

const DB_NAME = 'DevContextDB';
const DB_VERSION = 3; // v3: Added activityLog store for duplicate detection

// Cloud sync configuration
const CLOUD_CONFIG = {
  apiUrl: 'https://devcontext-sync-api.fly.dev/api/v1',
  syncInterval: 5 * 60 * 1000, // 5 minutes
  maxRetries: 3,
  fetchTimeout: 30000 // 30 seconds timeout for API requests
};

let db = null;
let syncTimer = null;
let pendingSync = [];
let isSyncing = false; // Prevent concurrent sync operations

// ============================================
// IndexedDB Core Functions
// ============================================

function initDB() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('DevContext: IndexedDB failed, falling back to chrome.storage');
      resolve(null);
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      console.log('DevContext: IndexedDB initialized');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Projects store
      if (!database.objectStoreNames.contains('projects')) {
        const projectStore = database.createObjectStore('projects', { keyPath: 'id' });
        projectStore.createIndex('name', 'name', { unique: false });
        projectStore.createIndex('createdAt', 'createdAt', { unique: false });
        projectStore.createIndex('syncStatus', 'syncStatus', { unique: false });
      }

      // Snippets store
      if (!database.objectStoreNames.contains('snippets')) {
        const snippetStore = database.createObjectStore('snippets', { keyPath: 'id' });
        snippetStore.createIndex('projectId', 'projectId', { unique: false });
        snippetStore.createIndex('language', 'language', { unique: false });
        snippetStore.createIndex('createdAt', 'createdAt', { unique: false });
        snippetStore.createIndex('syncStatus', 'syncStatus', { unique: false });
      }

      // Knowledge store
      if (!database.objectStoreNames.contains('knowledge')) {
        const knowledgeStore = database.createObjectStore('knowledge', { keyPath: 'id' });
        knowledgeStore.createIndex('projectId', 'projectId', { unique: false });
        knowledgeStore.createIndex('createdAt', 'createdAt', { unique: false });
        knowledgeStore.createIndex('syncStatus', 'syncStatus', { unique: false });
      }

      // Settings store
      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings', { keyPath: 'key' });
      }

      // Sync queue store (for offline changes)
      if (!database.objectStoreNames.contains('syncQueue')) {
        const syncStore = database.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
        syncStore.createIndex('timestamp', 'timestamp', { unique: false });
        syncStore.createIndex('type', 'type', { unique: false });
      }

      // Activity log store (for tracking saves and duplicate detection)
      if (!database.objectStoreNames.contains('activityLog')) {
        const activityStore = database.createObjectStore('activityLog', { keyPath: 'id', autoIncrement: true });
        activityStore.createIndex('timestamp', 'timestamp', { unique: false });
        activityStore.createIndex('action', 'action', { unique: false });
        activityStore.createIndex('contentHash', 'contentHash', { unique: false });
        activityStore.createIndex('projectId', 'projectId', { unique: false });
      }
    };
  });
}

async function saveData(storeName, data) {
  const database = await initDB();

  if (!database) {
    // Fallback to chrome.storage.local
    return new Promise((resolve, reject) => {
      chrome.storage.local.get('devContextData', (result) => {
        if (chrome.runtime.lastError) {
          console.error('DevContext: chrome.storage.local.get error:', chrome.runtime.lastError.message);
          return reject(new Error(chrome.runtime.lastError.message));
        }

        const existing = result.devContextData || {};
        if (!existing[storeName]) existing[storeName] = [];

        const idx = existing[storeName].findIndex(item => item.id === data.id);
        if (idx >= 0) {
          existing[storeName][idx] = data;
        } else {
          existing[storeName].push(data);
        }

        chrome.storage.local.set({ devContextData: existing }, () => {
          if (chrome.runtime.lastError) {
            console.error('DevContext: chrome.storage.local.set error:', chrome.runtime.lastError.message);
            return reject(new Error(chrome.runtime.lastError.message));
          }
          resolve(data);
        });
      });
    });
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);

    // Mark as pending sync
    data.syncStatus = 'pending';
    data.updatedAt = Date.now();

    const request = store.put(data);

    request.onsuccess = () => {
      // Queue for cloud sync
      queueForSync(storeName, 'upsert', data);
      resolve(data);
    };
    request.onerror = () => reject(request.error);
  });
}

async function getAllData(storeName) {
  const database = await initDB();

  if (!database) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get('devContextData', (result) => {
        if (chrome.runtime.lastError) {
          console.error('DevContext: chrome.storage.local.get error:', chrome.runtime.lastError.message);
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve(result.devContextData?.[storeName] || []);
      });
    });
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getById(storeName, id) {
  const database = await initDB();

  if (!database) {
    const all = await getAllData(storeName);
    return all.find(item => item.id === id) || null;
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function getByIndex(storeName, indexName, value) {
  const database = await initDB();

  if (!database) {
    const all = await getAllData(storeName);
    return all.filter(item => item[indexName] === value);
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const index = store.index(indexName);
    const request = index.getAll(value);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteById(storeName, id) {
  const database = await initDB();

  if (!database) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get('devContextData', (result) => {
        if (chrome.runtime.lastError) {
          console.error('DevContext: chrome.storage.local.get error:', chrome.runtime.lastError.message);
          return reject(new Error(chrome.runtime.lastError.message));
        }
        const existing = result.devContextData || {};
        existing[storeName] = (existing[storeName] || []).filter(item => item.id !== id);
        chrome.storage.local.set({ devContextData: existing }, () => {
          if (chrome.runtime.lastError) {
            console.error('DevContext: chrome.storage.local.set error:', chrome.runtime.lastError.message);
            return reject(new Error(chrome.runtime.lastError.message));
          }
          resolve(true);
        });
      });
    });
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(id);

    request.onsuccess = () => {
      queueForSync(storeName, 'delete', { id });
      resolve(true);
    };
    request.onerror = () => reject(request.error);
  });
}

async function updateData(storeName, id, updates) {
  const existing = await getById(storeName, id);
  if (!existing) {
    throw new Error(`Item with id ${id} not found`);
  }

  const updated = { ...existing, ...updates, updatedAt: Date.now() };
  return saveData(storeName, updated);
}

// ============================================
// Content Fingerprinting & Duplicate Detection
// ============================================

// Simple hash function for content fingerprinting
function hashContent(content) {
  if (!content) return '';
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

// Normalize content for comparison (trim, lowercase, remove extra whitespace)
function normalizeContent(content) {
  if (!content) return '';
  return content.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Check for duplicate snippets
async function findDuplicateSnippet(code, projectId) {
  const snippets = await getByIndex('snippets', 'projectId', projectId);
  const normalizedNew = normalizeContent(code);
  const hashNew = hashContent(normalizedNew);

  for (const snippet of snippets) {
    const normalizedExisting = normalizeContent(snippet.code);
    const hashExisting = hashContent(normalizedExisting);

    // Exact match
    if (hashNew === hashExisting) {
      return {
        isDuplicate: true,
        matchType: 'exact',
        existingItem: snippet
      };
    }

    // Similar match (80% similarity check using simple comparison)
    const similarity = calculateSimilarity(normalizedNew, normalizedExisting);
    if (similarity > 0.8) {
      return {
        isDuplicate: true,
        matchType: 'similar',
        similarity: Math.round(similarity * 100),
        existingItem: snippet
      };
    }
  }

  return { isDuplicate: false };
}

// Check for duplicate knowledge items
async function findDuplicateKnowledge(question, answer, projectId) {
  const knowledge = await getByIndex('knowledge', 'projectId', projectId);
  const normalizedQuestion = normalizeContent(question);
  const normalizedAnswer = normalizeContent(answer);
  const combinedHash = hashContent(normalizedQuestion + normalizedAnswer);

  for (const item of knowledge) {
    const existingQuestion = normalizeContent(item.question);
    const existingAnswer = normalizeContent(item.answer);
    const existingHash = hashContent(existingQuestion + existingAnswer);

    // Exact match
    if (combinedHash === existingHash) {
      return {
        isDuplicate: true,
        matchType: 'exact',
        existingItem: item
      };
    }

    // Check answer similarity (main content)
    const answerSimilarity = calculateSimilarity(normalizedAnswer, existingAnswer);
    if (answerSimilarity > 0.85) {
      return {
        isDuplicate: true,
        matchType: 'similar',
        similarity: Math.round(answerSimilarity * 100),
        existingItem: item
      };
    }
  }

  return { isDuplicate: false };
}

// Simple similarity calculation (Jaccard similarity on words)
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;

  const words1 = new Set(str1.split(' ').filter(w => w.length > 2));
  const words2 = new Set(str2.split(' ').filter(w => w.length > 2));

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

// ============================================
// Activity Log (for tracking and history)
// ============================================

async function logActivity(action, itemType, itemId, details = {}) {
  const database = await initDB();
  if (!database) return;

  const logEntry = {
    timestamp: Date.now(),
    action, // 'save', 'update', 'delete', 'duplicate_detected', 'export'
    itemType, // 'snippet', 'knowledge', 'project'
    itemId,
    projectId: details.projectId || null,
    source: details.source || null,
    contentHash: details.contentHash || null,
    platform: details.platform || null, // 'chatgpt', 'claude', etc.
    metadata: details.metadata || {}
  };

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['activityLog'], 'readwrite');
    const store = transaction.objectStore('activityLog');
    const request = store.add(logEntry);

    request.onsuccess = () => resolve(logEntry);
    request.onerror = () => reject(request.error);
  });
}

async function getActivityLog(options = {}) {
  const database = await initDB();
  if (!database) return [];

  const { projectId, limit = 50, action } = options;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['activityLog'], 'readonly');
    const store = transaction.objectStore('activityLog');

    let request;
    if (projectId) {
      const index = store.index('projectId');
      request = index.getAll(projectId);
    } else if (action) {
      const index = store.index('action');
      request = index.getAll(action);
    } else {
      request = store.getAll();
    }

    request.onsuccess = () => {
      let results = request.result;
      // Sort by timestamp descending
      results.sort((a, b) => b.timestamp - a.timestamp);
      // Apply limit
      if (limit) results = results.slice(0, limit);
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

async function findSimilarSavedContent(contentHash, projectId) {
  const database = await initDB();
  if (!database) return [];

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['activityLog'], 'readonly');
    const store = transaction.objectStore('activityLog');
    const index = store.index('contentHash');
    const request = index.getAll(contentHash);

    request.onsuccess = () => {
      let results = request.result.filter(r =>
        r.action === 'save' &&
        (!projectId || r.projectId === projectId)
      );
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

// ============================================
// Search Functions (Fuzzy/Semantic Search)
// ============================================

// Tokenize and normalize text for search
function tokenizeForSearch(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2);
}

// Calculate search relevance score
function calculateSearchScore(query, text, weights = { exact: 10, word: 3, partial: 1 }) {
  if (!query || !text) return 0;

  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  let score = 0;

  // Exact phrase match (highest weight)
  if (textLower.includes(queryLower)) {
    score += weights.exact * queryLower.length;
  }

  // Word-level matching
  const queryWords = tokenizeForSearch(query);
  const textWords = new Set(tokenizeForSearch(text));

  for (const queryWord of queryWords) {
    // Exact word match
    if (textWords.has(queryWord)) {
      score += weights.word;
    } else {
      // Partial word match (fuzzy)
      for (const textWord of textWords) {
        if (textWord.includes(queryWord) || queryWord.includes(textWord)) {
          score += weights.partial;
          break;
        }
      }
    }
  }

  return score;
}

// Search snippets with fuzzy matching
async function searchSnippets(query, projectId = null, options = {}) {
  const { limit = 20, minScore = 1 } = options;

  let snippets;
  if (projectId) {
    snippets = await getByIndex('snippets', 'projectId', projectId);
  } else {
    snippets = await getAllData('snippets');
  }

  const results = snippets
    .map(snippet => {
      const codeScore = calculateSearchScore(query, snippet.code, { exact: 15, word: 5, partial: 2 });
      const descScore = calculateSearchScore(query, snippet.description, { exact: 10, word: 3, partial: 1 });
      const langScore = snippet.language?.toLowerCase().includes(query.toLowerCase()) ? 5 : 0;

      return {
        ...snippet,
        searchScore: codeScore + descScore + langScore,
        matchType: codeScore > descScore ? 'code' : 'description'
      };
    })
    .filter(item => item.searchScore >= minScore)
    .sort((a, b) => b.searchScore - a.searchScore)
    .slice(0, limit);

  return results;
}

// Search knowledge items with fuzzy matching
async function searchKnowledge(query, projectId = null, options = {}) {
  const { limit = 20, minScore = 1 } = options;

  let knowledge;
  if (projectId) {
    knowledge = await getByIndex('knowledge', 'projectId', projectId);
  } else {
    knowledge = await getAllData('knowledge');
  }

  const results = knowledge
    .map(item => {
      const questionScore = calculateSearchScore(query, item.question, { exact: 12, word: 4, partial: 1 });
      const answerScore = calculateSearchScore(query, item.answer, { exact: 10, word: 3, partial: 1 });
      const tagScore = item.tags?.some(t => t.toLowerCase().includes(query.toLowerCase())) ? 5 : 0;

      return {
        ...item,
        searchScore: questionScore + answerScore + tagScore,
        matchType: questionScore > answerScore ? 'question' : 'answer'
      };
    })
    .filter(item => item.searchScore >= minScore)
    .sort((a, b) => b.searchScore - a.searchScore)
    .slice(0, limit);

  return results;
}

// Unified search across all content types
async function searchAll(query, projectId = null, options = {}) {
  const { limit = 30 } = options;

  const [snippets, knowledge] = await Promise.all([
    searchSnippets(query, projectId, { limit: limit, minScore: 1 }),
    searchKnowledge(query, projectId, { limit: limit, minScore: 1 })
  ]);

  // Combine and normalize scores
  const allResults = [
    ...snippets.map(s => ({ ...s, type: 'snippet' })),
    ...knowledge.map(k => ({ ...k, type: 'knowledge' }))
  ];

  // Sort by score and limit
  return allResults
    .sort((a, b) => b.searchScore - a.searchScore)
    .slice(0, limit);
}

// ============================================
// Settings (stored separately for quick access)
// ============================================

async function getSetting(key) {
  const database = await initDB();

  if (!database) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get('devContextSettings', (result) => {
        if (chrome.runtime.lastError) {
          console.error('DevContext: chrome.storage.local.get error:', chrome.runtime.lastError.message);
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve(result.devContextSettings?.[key] || null);
      });
    });
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['settings'], 'readonly');
    const store = transaction.objectStore('settings');
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result?.value || null);
    request.onerror = () => reject(request.error);
  });
}

async function setSetting(key, value) {
  const database = await initDB();

  if (!database) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get('devContextSettings', (result) => {
        if (chrome.runtime.lastError) {
          console.error('DevContext: chrome.storage.local.get error:', chrome.runtime.lastError.message);
          return reject(new Error(chrome.runtime.lastError.message));
        }
        const settings = result.devContextSettings || {};
        settings[key] = value;
        chrome.storage.local.set({ devContextSettings: settings }, () => {
          if (chrome.runtime.lastError) {
            console.error('DevContext: chrome.storage.local.set error:', chrome.runtime.lastError.message);
            return reject(new Error(chrome.runtime.lastError.message));
          }
          resolve(value);
        });
      });
    });
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['settings'], 'readwrite');
    const store = transaction.objectStore('settings');
    const request = store.put({ key, value, updatedAt: Date.now() });

    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(request.error);
  });
}

// ============================================
// Cloud Sync (Premium Feature)
// ============================================

// Helper: Fetch with timeout to prevent hanging requests
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLOUD_CONFIG.fetchTimeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw error;
  }
}

async function queueForSync(storeName, operation, data) {
  const isPremium = await getSetting('isPremium');
  const cloudSyncEnabled = await getSetting('cloudSyncEnabled');

  if (!isPremium || !cloudSyncEnabled) {
    return; // Cloud sync is premium only
  }

  const database = await initDB();
  if (!database) return;

  const syncItem = {
    storeName,
    operation,
    data,
    timestamp: Date.now(),
    retries: 0
  };

  const transaction = database.transaction(['syncQueue'], 'readwrite');
  const store = transaction.objectStore('syncQueue');
  store.add(syncItem);
}

async function processSyncQueue() {
  // Prevent concurrent sync operations
  if (isSyncing) {
    return { synced: 0, message: 'Sync already in progress' };
  }

  // Check prerequisites before setting isSyncing to avoid leaving it stuck
  const isPremium = await getSetting('isPremium');
  const cloudSyncEnabled = await getSetting('cloudSyncEnabled');
  const authToken = await getSetting('cloudAuthToken');

  if (!isPremium || !cloudSyncEnabled || !authToken) {
    return { synced: 0, message: 'Cloud sync not enabled' };
  }

  if (!CLOUD_CONFIG.apiUrl) {
    console.warn('DevContext: Cloud API URL not configured');
    return { synced: 0, message: 'Cloud API not configured' };
  }

  const database = await initDB();
  if (!database) {
    return { synced: 0, message: 'Database not available' };
  }

  // Set isSyncing only after all prerequisites pass
  isSyncing = true;

  try {

    const transaction = database.transaction(['syncQueue'], 'readonly');
    const store = transaction.objectStore('syncQueue');
    const items = await new Promise((resolve) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
    });

    let synced = 0;
    const errors = [];

    for (const item of items) {
      try {
        const response = await fetchWithTimeout(`${CLOUD_CONFIG.apiUrl}/sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({
            storeName: item.storeName,
            operation: item.operation,
            data: item.data,
            clientTimestamp: item.timestamp
          })
        });

      if (response.ok) {
        // Remove from sync queue
        const deleteTx = database.transaction(['syncQueue'], 'readwrite');
        deleteTx.objectStore('syncQueue').delete(item.id);

        // Update sync status
        if (item.data.id) {
          const dataTx = database.transaction([item.storeName], 'readwrite');
          const existing = await new Promise((resolve) => {
            const req = dataTx.objectStore(item.storeName).get(item.data.id);
            req.onsuccess = () => resolve(req.result);
          });
          if (existing) {
            existing.syncStatus = 'synced';
            existing.lastSyncedAt = Date.now();
            dataTx.objectStore(item.storeName).put(existing);
          }
        }

        synced++;
      } else if (response.status === 401) {
        // Auth failed, stop syncing
        await setSetting('cloudSyncEnabled', false);
        return { synced, message: 'Authentication failed. Please re-login.' };
      } else {
        item.retries++;
        if (item.retries >= CLOUD_CONFIG.maxRetries) {
          const deleteTx = database.transaction(['syncQueue'], 'readwrite');
          deleteTx.objectStore('syncQueue').delete(item.id);
          errors.push(`Failed to sync item after ${CLOUD_CONFIG.maxRetries} retries`);
        }
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

    return { synced, pending: items.length - synced, errors };
  } finally {
    isSyncing = false;
  }
}

async function pullFromCloud() {
  // Prevent concurrent sync operations
  if (isSyncing) {
    return { success: false, message: 'Sync already in progress' };
  }

  // Check prerequisites before setting isSyncing to avoid leaving it stuck
  const isPremium = await getSetting('isPremium');
  const authToken = await getSetting('cloudAuthToken');

  if (!isPremium || !authToken || !CLOUD_CONFIG.apiUrl) {
    return { success: false, message: 'Cloud sync not available' };
  }

  const lastPullAt = await getSetting('lastCloudPullAt') || 0;

  // Set isSyncing only after all prerequisites pass
  isSyncing = true;

  try {
    const response = await fetchWithTimeout(`${CLOUD_CONFIG.apiUrl}/sync/pull?since=${lastPullAt}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const cloudData = await response.json();

    // Merge cloud data with local
    const stores = ['projects', 'snippets', 'knowledge'];
    let imported = { projects: 0, snippets: 0, knowledge: 0 };

    for (const storeName of stores) {
      const items = cloudData[storeName] || [];
      for (const item of items) {
        const local = await getById(storeName, item.id);

        // Cloud wins if newer, or if local doesn't exist
        if (!local || item.updatedAt > (local.updatedAt || 0)) {
          item.syncStatus = 'synced';
          item.lastSyncedAt = Date.now();
          await saveDataDirect(storeName, item); // Skip sync queue
          imported[storeName]++;
        }
      }
    }

    await setSetting('lastCloudPullAt', Date.now());

    return { success: true, imported };
  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    isSyncing = false;
  }
}

// Save without queuing for sync (used when pulling from cloud)
async function saveDataDirect(storeName, data) {
  const database = await initDB();
  if (!database) return;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(data);

    request.onsuccess = () => resolve(data);
    request.onerror = () => reject(request.error);
  });
}

function startAutoSync() {
  if (syncTimer) return;

  syncTimer = setInterval(async () => {
    const isPremium = await getSetting('isPremium');
    const cloudSyncEnabled = await getSetting('cloudSyncEnabled');

    if (isPremium && cloudSyncEnabled) {
      await processSyncQueue();
      await pullFromCloud();
    }
  }, CLOUD_CONFIG.syncInterval);

  console.log('DevContext: Auto-sync started');
}

function stopAutoSync() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    console.log('DevContext: Auto-sync stopped');
  }
}

// ============================================
// Cloud Authentication (Premium)
// ============================================

async function cloudLogin(email, password) {
  if (!CLOUD_CONFIG.apiUrl) {
    return { success: false, message: 'Cloud service not configured' };
  }

  try {
    const response = await fetchWithTimeout(`${CLOUD_CONFIG.apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, message: error.message || 'Login failed' };
    }

    const { token, user } = await response.json();

    await setSetting('cloudAuthToken', token);
    await setSetting('cloudUser', user);
    await setSetting('cloudSyncEnabled', true);

    startAutoSync();

    return { success: true, user };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function cloudLogout() {
  stopAutoSync();
  await setSetting('cloudAuthToken', null);
  await setSetting('cloudUser', null);
  await setSetting('cloudSyncEnabled', false);
  return { success: true };
}

async function getCloudStatus() {
  const isPremium = await getSetting('isPremium');
  const cloudSyncEnabled = await getSetting('cloudSyncEnabled');
  const cloudUser = await getSetting('cloudUser');
  const lastPullAt = await getSetting('lastCloudPullAt');

  // Count pending sync items
  let pendingCount = 0;
  const database = await initDB();
  if (database) {
    const transaction = database.transaction(['syncQueue'], 'readonly');
    const store = transaction.objectStore('syncQueue');
    pendingCount = await new Promise((resolve) => {
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
    });
  }

  return {
    available: isPremium,
    enabled: cloudSyncEnabled,
    user: cloudUser,
    lastSyncAt: lastPullAt,
    pendingChanges: pendingCount
  };
}

// ============================================
// Storage Statistics
// ============================================

async function getStorageStats() {
  const database = await initDB();

  if (!database) {
    return new Promise((resolve) => {
      chrome.storage.local.getBytesInUse(null, (bytes) => {
        resolve({
          type: 'chrome.storage.local',
          used: bytes,
          limit: 5 * 1024 * 1024,
          percentage: ((bytes / (5 * 1024 * 1024)) * 100).toFixed(1),
          counts: {}
        });
      });
    });
  }

  // Count items in each store
  const counts = {};
  const stores = ['projects', 'snippets', 'knowledge'];

  for (const storeName of stores) {
    const items = await getAllData(storeName);
    counts[storeName] = items.length;
  }

  // Estimate storage usage
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate();
    return {
      type: 'IndexedDB',
      used: estimate.usage || 0,
      limit: estimate.quota || 0,
      percentage: estimate.quota ? ((estimate.usage / estimate.quota) * 100).toFixed(1) : 'unknown',
      counts
    };
  }

  return { type: 'IndexedDB', used: 'unknown', limit: 'unknown', counts };
}

// ============================================
// Export / Import
// ============================================

async function exportAllData() {
  const projects = await getAllData('projects');
  const snippets = await getAllData('snippets');
  const knowledge = await getAllData('knowledge');

  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    data: { projects, snippets, knowledge }
  };
}

async function importData(jsonData) {
  if (!jsonData.data) {
    throw new Error('Invalid backup format');
  }

  const { projects, snippets, knowledge } = jsonData.data;
  const imported = { projects: 0, snippets: 0, knowledge: 0 };

  if (projects?.length) {
    for (const project of projects) {
      await saveData('projects', project);
      imported.projects++;
    }
  }

  if (snippets?.length) {
    for (const snippet of snippets) {
      await saveData('snippets', snippet);
      imported.snippets++;
    }
  }

  if (knowledge?.length) {
    for (const item of knowledge) {
      await saveData('knowledge', item);
      imported.knowledge++;
    }
  }

  return { imported };
}

async function clearAllData() {
  const database = await initDB();

  if (!database) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(['devContextData', 'devContextSettings'], resolve);
    });
  }

  const storeNames = ['projects', 'snippets', 'knowledge', 'syncQueue'];

  for (const storeName of storeNames) {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  return true;
}

// ============================================
// Migration from chrome.storage
// ============================================

async function migrateFromChromeStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get('devContextData', async (result) => {
      const oldData = result.devContextData;

      if (!oldData || !oldData.projects) {
        resolve({ migrated: false, message: 'No data to migrate' });
        return;
      }

      try {
        let migrated = { projects: 0, snippets: 0, knowledge: 0 };

        for (const project of oldData.projects) {
          // Extract snippets and knowledge from project
          const snippets = project.snippets || [];
          const knowledge = project.knowledge || [];

          // Save project without embedded data
          const cleanProject = {
            id: project.id,
            name: project.name,
            createdAt: project.createdAt,
            updatedAt: Date.now()
          };
          await saveData('projects', cleanProject);
          migrated.projects++;

          // Save snippets separately with projectId
          for (const snippet of snippets) {
            snippet.projectId = project.id;
            await saveData('snippets', snippet);
            migrated.snippets++;
          }

          // Save knowledge separately with projectId
          for (const item of knowledge) {
            item.projectId = project.id;
            await saveData('knowledge', item);
            migrated.knowledge++;
          }
        }

        // Migrate settings
        if (oldData.settings) {
          for (const [key, value] of Object.entries(oldData.settings)) {
            await setSetting(key, value);
          }
        }

        if (oldData.activeProjectId) {
          await setSetting('activeProjectId', oldData.activeProjectId);
        }

        // Clear old storage after successful migration
        chrome.storage.local.remove('devContextData');

        resolve({ migrated: true, counts: migrated });
      } catch (error) {
        resolve({ migrated: false, message: error.message });
      }
    });
  });
}

// Initialize on load
initDB().then(() => {
  // Check if migration is needed
  migrateFromChromeStorage().then((result) => {
    if (result.migrated) {
      console.log('DevContext: Data migrated to IndexedDB', result.counts);
    }
  });

  // Start auto-sync if premium
  getSetting('isPremium').then((isPremium) => {
    if (isPremium) {
      getSetting('cloudSyncEnabled').then((enabled) => {
        if (enabled) startAutoSync();
      });
    }
  });
});
