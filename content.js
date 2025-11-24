(function() {
  'use strict';

  const PLATFORM = detectPlatform();
  let observerActive = false;
  let processedElements = new WeakSet();
  let promptedElements = new WeakSet(); // Track elements we've prompted for
  let menuClickListenerAttached = false;
  let autoPromptEnabled = true; // User preference for auto-prompts
  let DEBUG = false; // Default to false; enable in dev via env or manifest
  try {
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV && process.env.NODE_ENV !== 'production') {
      DEBUG = true;
    } else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
      try {
        const v = chrome.runtime.getManifest().version || '';
        // Treat pre-release or 0.x versions as non-production/dev
        DEBUG = /-dev|-alpha|-beta|^0\./i.test(v);
      } catch (e) {
        DEBUG = false;
      }
    }
  } catch (e) {
    DEBUG = false;
  }
  let settingsLoaded = false;
  const AUTO_PROMPT_DELAY = 2000; // Wait 2s after response completes before prompting

  // Dynamic selectors - loaded from background
  let platformSelectors = null;

  async function loadSelectors() {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_SELECTORS' }, resolve);
      });
      if (response && response.platforms && response.platforms[PLATFORM]) {
        platformSelectors = response.platforms[PLATFORM];
        debugLog('Loaded dynamic selectors for', PLATFORM, platformSelectors);
        return true;
      }
    } catch (e) {
      debugLog('Failed to load selectors:', e);
    }
    return false;
  }

  // Get selectors for current platform (dynamic or fallback)
  function getResponseSelectors() {
    if (platformSelectors && platformSelectors.responseSelectors) {
      return platformSelectors.responseSelectors;
    }
    // Fallback to hardcoded selectors
    return getFallbackResponseSelectors();
  }

  function getStreamingIndicators() {
    if (platformSelectors && platformSelectors.streamingIndicators) {
      return platformSelectors.streamingIndicators;
    }
    return getFallbackStreamingIndicators();
  }

  function getUserMessageSelector() {
    if (platformSelectors && platformSelectors.userMessageSelector) {
      return platformSelectors.userMessageSelector;
    }
    return getFallbackUserMessageSelector();
  }

  function getCodeBlockSelector() {
    if (platformSelectors && platformSelectors.codeBlockSelector) {
      return platformSelectors.codeBlockSelector;
    }
    return 'pre code';
  }

  // Fallback selectors (hardcoded)
  function getFallbackResponseSelectors() {
    const selectors = {
      chatgpt: [
        '[data-message-author-role="assistant"] .markdown',
        '[data-message-author-role="assistant"] .prose',
        '.agent-turn .markdown'
      ],
      claude: [
        '[class*="assistant-message"]',
        '[class*="claude-message"]',
        '[class*="prose"]'
      ],
      gemini: [
        '[class*="model-response"]',
        '[class*="response-content"]'
      ],
      perplexity: [
        '[class*="answer-content"]',
        '[class*="prose"]'
      ]
    };
    return selectors[PLATFORM] || [];
  }

  function getFallbackStreamingIndicators() {
    const indicators = {
      chatgpt: ['[data-testid="stop-button"]', '.result-streaming'],
      claude: ['[data-is-streaming="true"]'],
      gemini: ['[class*="loading"]', '[class*="streaming"]'],
      perplexity: ['[class*="typing"]', '[class*="generating"]']
    };
    return indicators[PLATFORM] || [];
  }

  function getFallbackUserMessageSelector() {
    const selectors = {
      chatgpt: '[data-message-author-role="user"]',
      claude: '[class*="human"]',
      gemini: '[class*="query"], [class*="user-message"]',
      perplexity: '[class*="query-text"], [class*="question"]'
    };
    return selectors[PLATFORM] || '';
  }

  // Listen for selector updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SELECTORS_UPDATED' && message.selectors) {
      if (message.selectors.platforms && message.selectors.platforms[PLATFORM]) {
        platformSelectors = message.selectors.platforms[PLATFORM];
        debugLog('Selectors updated dynamically');
        // Re-process page with new selectors if user settings are loaded
        if (settingsLoaded) {
          processPage();
        } else {
          debugLog('Selectors updated but settings not loaded; deferring process');
        }
      }
    }
  });

  function debugLog(...args) {
    if (DEBUG) {
      console.log('[DevContext]', ...args);
    }
  }

  function detectPlatform() {
    const hostname = window.location.hostname;
    if (hostname.includes('chatgpt.com') || hostname.includes('chat.openai.com')) {
      return 'chatgpt';
    }
    if (hostname.includes('claude.ai')) {
      return 'claude';
    }
    if (hostname.includes('gemini.google.com')) {
      return 'gemini';
    }
    if (hostname.includes('perplexity.ai')) {
      return 'perplexity';
    }
    return null;
  }

  function createSaveButton(type) {
    const btn = document.createElement('button');
    btn.className = 'devcontext-save-btn';
    btn.setAttribute('data-type', type);
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
        <polyline points="17 21 17 13 7 13 7 21"></polyline>
        <polyline points="7 3 7 8 15 8"></polyline>
      </svg>
      <span>${type === 'snippet' ? 'Save Code' : 'Save to DevContext'}</span>
    `;
    return btn;
  }

  function createSaveMenu() {
    const menu = document.createElement('div');
    menu.className = 'devcontext-menu hidden';
    menu.innerHTML = `
      <div class="devcontext-menu-item" data-action="snippet">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="16 18 22 12 16 6"></polyline>
          <polyline points="8 6 2 12 8 18"></polyline>
        </svg>
        Save as Snippet
      </div>
      <div class="devcontext-menu-item" data-action="knowledge">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
        </svg>
        Save as Knowledge
      </div>
    `;
    return menu;
  }

  function extractCodeBlocks(element) {
    const codeBlocks = [];
    const preElements = element.querySelectorAll('pre');

    preElements.forEach((pre) => {
      const code = pre.querySelector('code');
      const codeText = code ? code.textContent : pre.textContent;

      let language = 'text';
      if (code) {
        const classList = code.className;
        const langMatch = classList.match(/language-(\w+)/);
        if (langMatch) {
          language = langMatch[1];
        }
      }

      const langSpan = pre.parentElement?.querySelector('[class*="language-"], [class*="lang-"]');
      if (langSpan) {
        language = langSpan.textContent.trim().toLowerCase() || language;
      }

      codeBlocks.push({
        code: codeText.trim(),
        language
      });
    });

    return codeBlocks;
  }

  function extractConversation(responseElement) {
    let question = '';
    let answer = '';

    if (PLATFORM === 'chatgpt') {
      const parentContainer = responseElement.closest('[data-message-author-role]')?.parentElement;
      if (parentContainer) {
        const prevSibling = parentContainer.previousElementSibling;
        if (prevSibling) {
          const userMessage = prevSibling.querySelector('[data-message-author-role="user"]');
          if (userMessage) {
            question = userMessage.textContent.trim();
          }
        }
      }
      answer = responseElement.textContent.trim();
    } else if (PLATFORM === 'claude') {
      const messageGroup = responseElement.closest('[class*="message"]');
      if (messageGroup) {
        const prevMessage = messageGroup.previousElementSibling;
        if (prevMessage && prevMessage.querySelector('[class*="human"]')) {
          question = prevMessage.textContent.trim();
        }
      }
      answer = responseElement.textContent.trim();
    } else if (PLATFORM === 'gemini') {
      // Gemini uses turn-based conversation structure
      const turnContainer = responseElement.closest('[class*="response-container"], [class*="model-response"]');
      if (turnContainer) {
        const prevTurn = turnContainer.previousElementSibling;
        if (prevTurn) {
          const userQuery = prevTurn.querySelector('[class*="query"], [class*="user-message"]');
          if (userQuery) {
            question = userQuery.textContent.trim();
          }
        }
      }
      answer = responseElement.textContent.trim();
    } else if (PLATFORM === 'perplexity') {
      // Perplexity uses a question-answer format with sources
      const answerBlock = responseElement.closest('[class*="answer"], [class*="response"]');
      if (answerBlock) {
        const questionEl = document.querySelector('[class*="query-text"], [class*="question"]');
        if (questionEl) {
          question = questionEl.textContent.trim();
        }
      }
      answer = responseElement.textContent.trim();
    }

    return { question, answer };
  }

  function showNotification(message, type = 'success') {
    const existing = document.querySelector('.devcontext-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = `devcontext-notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => notification.remove(), 2500);
  }

  // Auto-save prompt that appears after AI response completes
  function showAutoSavePrompt(responseElement) {
    if (!autoPromptEnabled) return;
    if (promptedElements.has(responseElement)) return;

    // Check if response has meaningful content
    const codeBlocks = extractCodeBlocks(responseElement);
    const hasCode = codeBlocks.length > 0;
    const textLength = responseElement.textContent.trim().length;

    // Only prompt if there's substantial content
    if (textLength < 100 && !hasCode) return;

    promptedElements.add(responseElement);

    const prompt = document.createElement('div');
    prompt.className = 'devcontext-auto-prompt';
    prompt.innerHTML = `
      <div class="devcontext-prompt-content">
        <div class="devcontext-prompt-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
            <polyline points="17 21 17 13 7 13 7 21"></polyline>
            <polyline points="7 3 7 8 15 8"></polyline>
          </svg>
        </div>
        <span class="devcontext-prompt-text">Save this ${hasCode ? 'code' : 'response'} to DevContext?</span>
        <div class="devcontext-prompt-actions">
          ${hasCode ? `
            <button class="devcontext-prompt-btn primary" data-action="snippet">
              Save Code
            </button>
          ` : ''}
          <button class="devcontext-prompt-btn ${hasCode ? 'secondary' : 'primary'}" data-action="knowledge">
            ${hasCode ? 'Save All' : 'Save'}
          </button>
          <button class="devcontext-prompt-btn dismiss" data-action="dismiss">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
      <button class="devcontext-prompt-disable" data-action="disable">Don't ask again</button>
    `;

    prompt.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;

      if (action === 'dismiss') {
        clearTimeout(autoDismissId);
        prompt.remove();
      } else if (action === 'disable') {
        autoPromptEnabled = false;
        chrome.runtime.sendMessage({
          type: 'UPDATE_SETTING',
          data: { key: 'autoPromptEnabled', value: false }
        });
        clearTimeout(autoDismissId);
        prompt.remove();
        showNotification('Auto-prompts disabled. Enable in settings.', 'info');
      } else if (action === 'snippet') {
        const codeBlocks = extractCodeBlocks(responseElement);
        for (const block of codeBlocks) {
          await saveSnippet(block.code, block.language, PLATFORM);
        }
        clearTimeout(autoDismissId);
        prompt.remove();
      } else if (action === 'knowledge') {
        const { question, answer } = extractConversation(responseElement);
        await saveKnowledge(question || 'Untitled', answer, PLATFORM);
        clearTimeout(autoDismissId);
        prompt.remove();
      }
    });

    // Insert prompt at the bottom of the response
    responseElement.style.position = 'relative';
    responseElement.appendChild(prompt);

    // Auto-dismiss after 10 seconds (capture id so it can be cleared)
    let autoDismissId = setTimeout(() => {
      if (prompt.parentElement) {
        prompt.classList.add('fade-out');
        setTimeout(() => prompt.remove(), 300);
      }
    }, 10000);
  }

  // Check if a response is complete (not still streaming)
  function isResponseComplete(element) {
    // Use dynamic streaming indicators
    const indicators = getStreamingIndicators();

    for (const selector of indicators) {
      try {
        // Check in element and document
        if (element.querySelector(selector) || document.querySelector(selector)) {
          return false;
        }
        // Check if element matches or is inside streaming indicator
        if (element.closest(selector)) {
          return false;
        }
      } catch (e) {
        debugLog('Invalid streaming selector:', selector);
      }
    }
    return true;
  }

  // Monitor for response completion and trigger auto-prompt
  function monitorResponseCompletion(responseElement) {
    if (promptedElements.has(responseElement)) return;

    const checkComplete = () => {
      if (isResponseComplete(responseElement)) {
        setTimeout(() => {
          if (isResponseComplete(responseElement)) {
            showAutoSavePrompt(responseElement);
          }
        }, AUTO_PROMPT_DELAY);
      } else {
        // Check again in 500ms
        setTimeout(checkComplete, 500);
      }
    };

    checkComplete();
  }

  async function saveSnippet(code, language, source) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'SAVE_SNIPPET',
        data: { code, language, source, description: '' }
      }, (response) => {
        if (response?.success) {
          // Check for limit warnings
          if (response.warning) {
            if (response.warning.type === 'grace_save') {
              showNotification(`Snippet saved! ${response.warning.message}`, 'info');
            } else if (response.warning.type === 'approaching') {
              showNotification(`Snippet saved! ${response.warning.message}`, 'info');
            } else {
              showNotification('Snippet saved to DevContext');
            }
          } else {
            showNotification('Snippet saved to DevContext');
          }
          resolve(true);
        } else {
          showNotification(response?.error || 'Failed to save', 'error');
          resolve(false);
        }
      });
    });
  }

  async function saveKnowledge(question, answer, source) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'SAVE_KNOWLEDGE',
        data: { question, answer, source, tags: [] }
      }, (response) => {
        if (response?.success) {
          // Check for limit warnings
          if (response.warning) {
            if (response.warning.type === 'grace_save') {
              showNotification(`Knowledge saved! ${response.warning.message}`, 'info');
            } else if (response.warning.type === 'approaching') {
              showNotification(`Knowledge saved! ${response.warning.message}`, 'info');
            } else {
              showNotification('Knowledge saved to DevContext');
            }
          } else {
            showNotification('Knowledge saved to DevContext');
          }
          resolve(true);
        } else {
          showNotification(response?.error || 'Failed to save', 'error');
          resolve(false);
        }
      });
    });
  }

  function addButtonsToCodeBlock(codeBlock) {
    if (processedElements.has(codeBlock)) return;

    const wrapper = codeBlock.closest('pre')?.parentElement;
    if (!wrapper) return;

    const existingBtn = wrapper.querySelector('.devcontext-save-btn');
    if (existingBtn) return;

    const btn = createSaveButton('snippet');
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const code = codeBlock.textContent.trim();
      let language = 'text';

      const classList = codeBlock.className;
      const langMatch = classList.match(/language-(\w+)/);
      if (langMatch) {
        language = langMatch[1];
      }

      await saveSnippet(code, language, PLATFORM);
    });

    const toolbar = wrapper.querySelector('[class*="toolbar"], [class*="header"]');
    if (toolbar) {
      toolbar.appendChild(btn);
    } else {
      wrapper.style.position = 'relative';
      btn.style.position = 'absolute';
      btn.style.top = '8px';
      btn.style.right = '8px';
      wrapper.insertBefore(btn, wrapper.firstChild);
    }

    processedElements.add(codeBlock);
  }

  function addButtonsToResponse(responseElement) {
    if (processedElements.has(responseElement)) return;

    const existingMenu = responseElement.querySelector('.devcontext-menu-wrapper');
    if (existingMenu) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'devcontext-menu-wrapper';

    const btn = createSaveButton('response');
    const menu = createSaveMenu();

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      menu.classList.toggle('hidden');
    });

    menu.addEventListener('click', async (e) => {
      const item = e.target.closest('.devcontext-menu-item');
      if (!item) return;

      const action = item.dataset.action;
      menu.classList.add('hidden');

      if (action === 'snippet') {
        const codeBlocks = extractCodeBlocks(responseElement);
        if (codeBlocks.length > 0) {
          for (const block of codeBlocks) {
            await saveSnippet(block.code, block.language, PLATFORM);
          }
        } else {
          showNotification('No code blocks found', 'error');
        }
      } else if (action === 'knowledge') {
        const { question, answer } = extractConversation(responseElement);
        await saveKnowledge(question || 'Untitled', answer, PLATFORM);
      }
    });

    wrapper.appendChild(btn);
    wrapper.appendChild(menu);

    responseElement.style.position = 'relative';
    responseElement.appendChild(wrapper);

    processedElements.add(responseElement);

    // Start monitoring for auto-save prompt
    monitorResponseCompletion(responseElement);
  }

  function processPage() {
    debugLog('Processing page for platform:', PLATFORM);

    // Use dynamic selectors from config
    const responseSelectors = getResponseSelectors();
    const codeSelector = getCodeBlockSelector();

    debugLog('Using selectors:', responseSelectors);

    // Process all response selectors
    responseSelectors.forEach(selector => {
      try {
        const elements = document.querySelectorAll(selector);
        debugLog(`Selector "${selector}" found ${elements.length} elements`);
        elements.forEach((el) => {
          addButtonsToResponse(el);
        });
      } catch (e) {
        debugLog(`Invalid selector "${selector}":`, e.message);
      }
    });

    // Process code blocks
    try {
      document.querySelectorAll(codeSelector).forEach((el) => {
        addButtonsToCodeBlock(el);
      });
    } catch (e) {
      debugLog('Code block selector error:', e.message);
      // Fallback to standard code blocks
      document.querySelectorAll('pre code').forEach((el) => {
        addButtonsToCodeBlock(el);
      });
    }
  }

  function setupObserver() {
    if (observerActive) return;

    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;

      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldProcess = true;
          break;
        }
      }

      if (shouldProcess) {
        requestAnimationFrame(processPage);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    observerActive = true;
  }

  function setupMenuClickListener() {
    if (menuClickListenerAttached) return;

    // Single delegated listener for closing all menus
    document.addEventListener('click', (e) => {
      document.querySelectorAll('.devcontext-menu:not(.hidden)').forEach(menu => {
        const menuWrapper = menu.closest('.devcontext-menu-wrapper');
        if (menuWrapper && !menuWrapper.contains(e.target)) {
          menu.classList.add('hidden');
        }
      });
    }, { capture: true });

    menuClickListenerAttached = true;
  }

  async function init() {
    debugLog('Initializing DevContext Sync');
    debugLog('Detected platform:', PLATFORM);

    if (!PLATFORM) {
      debugLog('Platform not supported, exiting');
      return;
    }

    // Load dynamic selectors from background
    await loadSelectors();

    // Load user preference for auto-prompts
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, resolve);
      });
      if (response?.settings?.autoPromptEnabled === false) {
        autoPromptEnabled = false;
        debugLog('Auto-prompts disabled by user preference');
      }
    } catch (e) {
      debugLog('Could not load settings:', e);
    }
    // Mark settings as loaded so other triggers (selector updates) can safely run
    settingsLoaded = true;

    injectStyles();
    setupMenuClickListener();

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        processPage();
        setupObserver();
      });
    } else {
      processPage();
      setupObserver();
    }
  }

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .devcontext-save-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        background: rgba(88, 166, 255, 0.1);
        border: 1px solid rgba(88, 166, 255, 0.3);
        border-radius: 4px;
        color: #58a6ff;
        font-size: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        cursor: pointer;
        transition: all 0.15s ease;
        z-index: 1000;
      }

      .devcontext-save-btn:hover {
        background: rgba(88, 166, 255, 0.2);
        border-color: #58a6ff;
      }

      .devcontext-menu-wrapper {
        position: absolute;
        bottom: 8px;
        right: 8px;
        z-index: 1000;
      }

      .devcontext-menu {
        position: absolute;
        bottom: 100%;
        right: 0;
        margin-bottom: 4px;
        min-width: 160px;
        background: #161b22;
        border: 1px solid #30363d;
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        overflow: hidden;
      }

      .devcontext-menu.hidden {
        display: none;
      }

      .devcontext-menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        color: #e6edf3;
        font-size: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        cursor: pointer;
        transition: background 0.15s ease;
      }

      .devcontext-menu-item:hover {
        background: #21262d;
      }

      .devcontext-menu-item svg {
        flex-shrink: 0;
      }

      .devcontext-notification {
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 12px 20px;
        background: #161b22;
        border: 1px solid #3fb950;
        border-radius: 6px;
        color: #3fb950;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        z-index: 10000;
        animation: devcontext-slide-in 0.2s ease;
      }

      .devcontext-notification.error {
        border-color: #f85149;
        color: #f85149;
      }

      .devcontext-notification.info {
        border-color: #58a6ff;
        color: #58a6ff;
      }

      /* Auto-save prompt styles */
      .devcontext-auto-prompt {
        margin-top: 16px;
        padding: 12px 16px;
        background: linear-gradient(135deg, rgba(88, 166, 255, 0.08) 0%, rgba(163, 113, 247, 0.08) 100%);
        border: 1px solid rgba(88, 166, 255, 0.3);
        border-radius: 8px;
        animation: devcontext-prompt-slide-in 0.3s ease;
      }

      .devcontext-auto-prompt.fade-out {
        animation: devcontext-prompt-fade-out 0.3s ease forwards;
      }

      .devcontext-prompt-content {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .devcontext-prompt-icon {
        color: #58a6ff;
        display: flex;
        align-items: center;
      }

      .devcontext-prompt-text {
        font-size: 13px;
        color: #e6edf3;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        flex: 1;
        min-width: 150px;
      }

      .devcontext-prompt-actions {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .devcontext-prompt-btn {
        padding: 6px 12px;
        border-radius: 5px;
        font-size: 12px;
        font-weight: 500;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        cursor: pointer;
        transition: all 0.15s ease;
        border: none;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      .devcontext-prompt-btn.primary {
        background: #58a6ff;
        color: #0d1117;
      }

      .devcontext-prompt-btn.primary:hover {
        background: #79b8ff;
      }

      .devcontext-prompt-btn.secondary {
        background: rgba(88, 166, 255, 0.15);
        color: #58a6ff;
        border: 1px solid rgba(88, 166, 255, 0.3);
      }

      .devcontext-prompt-btn.secondary:hover {
        background: rgba(88, 166, 255, 0.25);
      }

      .devcontext-prompt-btn.dismiss {
        background: transparent;
        color: #8b949e;
        padding: 6px;
        border-radius: 4px;
      }

      .devcontext-prompt-btn.dismiss:hover {
        background: rgba(139, 148, 158, 0.15);
        color: #e6edf3;
      }

      .devcontext-prompt-disable {
        display: block;
        margin-top: 8px;
        padding: 0;
        background: none;
        border: none;
        color: #6e7681;
        font-size: 11px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 2px;
      }

      .devcontext-prompt-disable:hover {
        color: #8b949e;
      }

      @keyframes devcontext-prompt-slide-in {
        from {
          opacity: 0;
          transform: translateY(-10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes devcontext-prompt-fade-out {
        from {
          opacity: 1;
          transform: translateY(0);
        }
        to {
          opacity: 0;
          transform: translateY(-10px);
        }
      }

      @keyframes devcontext-slide-in {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `;
    document.head.appendChild(style);
  }

  init();
})();
