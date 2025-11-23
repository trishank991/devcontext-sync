(function() {
  'use strict';

  const PLATFORM = detectPlatform();
  let observerActive = false;
  let processedElements = new WeakSet();

  function detectPlatform() {
    const hostname = window.location.hostname;
    if (hostname.includes('chatgpt.com') || hostname.includes('chat.openai.com')) {
      return 'chatgpt';
    }
    if (hostname.includes('claude.ai')) {
      return 'claude';
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

  async function saveSnippet(code, language, source) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'SAVE_SNIPPET',
        data: { code, language, source, description: '' }
      }, (response) => {
        if (response?.success) {
          showNotification('Snippet saved to DevContext');
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
          showNotification('Knowledge saved to DevContext');
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

    const closeMenuHandler = (e) => {
      if (!wrapper.contains(e.target)) {
        menu.classList.add('hidden');
      }
    };
    document.addEventListener('click', closeMenuHandler);

    // Store handler reference for potential cleanup
    wrapper._closeMenuHandler = closeMenuHandler;

    wrapper.appendChild(btn);
    wrapper.appendChild(menu);

    responseElement.style.position = 'relative';
    responseElement.appendChild(wrapper);

    processedElements.add(responseElement);
  }

  function processPage() {
    if (PLATFORM === 'chatgpt') {
      document.querySelectorAll('[data-message-author-role="assistant"] .markdown').forEach((el) => {
        addButtonsToResponse(el);
      });

      document.querySelectorAll('pre code').forEach((el) => {
        addButtonsToCodeBlock(el);
      });
    } else if (PLATFORM === 'claude') {
      document.querySelectorAll('[class*="assistant-message"], [class*="claude-message"]').forEach((el) => {
        addButtonsToResponse(el);
      });

      document.querySelectorAll('[class*="prose"]').forEach((el) => {
        addButtonsToResponse(el);
      });

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

  function init() {
    if (!PLATFORM) return;

    injectStyles();

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
