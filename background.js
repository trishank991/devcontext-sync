const DEFAULT_DATA = {
  projects: [],
  activeProjectId: null,
  settings: {
    theme: 'dark',
    isPremium: false
  }
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['devContextData'], (result) => {
    if (!result.devContextData) {
      chrome.storage.local.set({ devContextData: DEFAULT_DATA });
    }
  });

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
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!info.selectionText) return;

  chrome.storage.local.get(['devContextData'], (result) => {
    const data = result.devContextData || DEFAULT_DATA;
    const activeProject = data.projects.find(
      (p) => p.id === data.activeProjectId
    );

    if (!activeProject) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'DevContext Sync',
        message: 'Please select a project first'
      });
      return;
    }

    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    if (info.menuItemId === 'devcontext-save-selection') {
      activeProject.knowledge.push({
        id,
        question: 'Selected text from ' + new URL(tab.url).hostname,
        answer: info.selectionText,
        source: tab.url,
        tags: [],
        createdAt: Date.now()
      });
    } else if (info.menuItemId === 'devcontext-save-code') {
      activeProject.snippets.push({
        id,
        code: info.selectionText,
        language: 'text',
        description: 'Selected from ' + new URL(tab.url).hostname,
        source: tab.url,
        createdAt: Date.now()
      });
    }

    chrome.storage.local.set({ devContextData: data }, () => {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'DevContext Sync',
        message: 'Saved successfully!'
      });
    });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_SNIPPET') {
    handleSaveSnippet(message.data, sendResponse);
    return true;
  }

  if (message.type === 'SAVE_KNOWLEDGE') {
    handleSaveKnowledge(message.data, sendResponse);
    return true;
  }

  if (message.type === 'GET_ACTIVE_PROJECT') {
    chrome.storage.local.get(['devContextData'], (result) => {
      const data = result.devContextData || DEFAULT_DATA;
      const activeProject = data.projects.find(
        (p) => p.id === data.activeProjectId
      );
      sendResponse({ project: activeProject || null });
    });
    return true;
  }

  if (message.type === 'PROJECT_CHANGED') {
    chrome.tabs.query({}, (tabs) => {
      const targetUrls = [
        'chat.openai.com',
        'chatgpt.com',
        'claude.ai'
      ];

      tabs.forEach((tab) => {
        if (tab.url && targetUrls.some((url) => tab.url.includes(url))) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'PROJECT_UPDATED',
            projectId: message.projectId
          }).catch(() => {});
        }
      });
    });
    sendResponse({ success: true });
    return true;
  }

  return false;
});

function handleSaveSnippet(data, sendResponse) {
  chrome.storage.local.get(['devContextData'], (result) => {
    const storageData = result.devContextData || DEFAULT_DATA;
    const activeProject = storageData.projects.find(
      (p) => p.id === storageData.activeProjectId
    );

    if (!activeProject) {
      sendResponse({ success: false, error: 'No active project' });
      return;
    }

    const FREE_LIMIT = 50;
    if (!storageData.settings.isPremium &&
        activeProject.snippets.length >= FREE_LIMIT) {
      sendResponse({ success: false, error: 'Snippet limit reached' });
      return;
    }

    activeProject.snippets.push({
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      code: data.code,
      language: data.language || 'text',
      description: data.description || '',
      source: data.source || 'unknown',
      createdAt: Date.now()
    });

    chrome.storage.local.set({ devContextData: storageData }, () => {
      sendResponse({ success: true });
    });
  });
}

function handleSaveKnowledge(data, sendResponse) {
  chrome.storage.local.get(['devContextData'], (result) => {
    const storageData = result.devContextData || DEFAULT_DATA;
    const activeProject = storageData.projects.find(
      (p) => p.id === storageData.activeProjectId
    );

    if (!activeProject) {
      sendResponse({ success: false, error: 'No active project' });
      return;
    }

    activeProject.knowledge.push({
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      question: data.question,
      answer: data.answer,
      source: data.source || 'unknown',
      tags: data.tags || [],
      createdAt: Date.now()
    });

    chrome.storage.local.set({ devContextData: storageData }, () => {
      sendResponse({ success: true });
    });
  });
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.devContextData) {
    chrome.runtime.sendMessage({
      type: 'DATA_UPDATED',
      data: changes.devContextData.newValue
    }).catch(() => {});
  }
});
