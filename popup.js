const FREE_TIER_LIMITS = {
  maxProjects: 2,
  maxSnippets: 50
};

const DEFAULT_DATA = {
  projects: [],
  activeProjectId: null,
  settings: {
    theme: 'dark',
    isPremium: false
  }
};

class DevContextSync {
  constructor() {
    this.data = { ...DEFAULT_DATA };
    this.init();
  }

  async init() {
    await this.loadData();
    this.bindEvents();
    this.render();
  }

  async loadData() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['devContextData'], (result) => {
        if (result.devContextData) {
          this.data = result.devContextData;
        }
        resolve();
      });
    });
  }

  async saveData() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ devContextData: this.data }, resolve);
    });
  }

  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  bindEvents() {
    document.getElementById('projectSelect').addEventListener('change', (e) => {
      this.switchProject(e.target.value);
    });

    document.getElementById('newProjectBtn').addEventListener('click', () => {
      this.showNewProjectModal();
    });

    document.getElementById('deleteProjectBtn').addEventListener('click', () => {
      this.deleteCurrentProject();
    });

    document.getElementById('saveSnippetBtn').addEventListener('click', () => {
      this.showSaveSnippetModal();
    });

    document.getElementById('searchKnowledgeBtn').addEventListener('click', () => {
      this.showSearchModal();
    });

    document.getElementById('exportBtn').addEventListener('click', () => {
      this.exportToVSCode();
    });

    document.getElementById('upgradeBtn').addEventListener('click', () => {
      this.showUpgradeModal();
    });

    document.getElementById('settingsBtn').addEventListener('click', () => {
      this.showSettingsModal();
    });

    document.getElementById('closeModalBtn').addEventListener('click', () => {
      this.hideModal();
    });

    document.getElementById('modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal') {
        this.hideModal();
      }
    });
  }

  render() {
    this.renderProjectSelector();
    this.renderStats();
    this.renderTierBadge();
  }

  renderProjectSelector() {
    const select = document.getElementById('projectSelect');
    select.innerHTML = '<option value="">Select a project...</option>';

    this.data.projects.forEach((project) => {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      if (project.id === this.data.activeProjectId) {
        option.selected = true;
      }
      select.appendChild(option);
    });
  }

  renderStats() {
    const activeProject = this.getActiveProject();

    document.getElementById('snippetCount').textContent =
      activeProject ? activeProject.snippets.length : 0;
    document.getElementById('knowledgeCount').textContent =
      activeProject ? activeProject.knowledge.length : 0;
    document.getElementById('projectCount').textContent =
      this.data.projects.length;
  }

  renderTierBadge() {
    const badge = document.getElementById('tierBadge');
    const isPremium = this.data.settings.isPremium;

    if (isPremium) {
      badge.classList.add('premium');
      badge.querySelector('.tier-label').textContent = 'Pro';
      badge.querySelector('.tier-limits').textContent = 'Unlimited';
    } else {
      badge.classList.remove('premium');
      badge.querySelector('.tier-label').textContent = 'Free Tier';
      badge.querySelector('.tier-limits').textContent =
        `${this.data.projects.length}/${FREE_TIER_LIMITS.maxProjects} projects`;
    }
  }

  getActiveProject() {
    return this.data.projects.find((p) => p.id === this.data.activeProjectId);
  }

  async switchProject(projectId) {
    this.data.activeProjectId = projectId || null;
    await this.saveData();
    this.render();

    chrome.runtime.sendMessage({
      type: 'PROJECT_CHANGED',
      projectId: projectId
    });
  }

  canCreateProject() {
    if (this.data.settings.isPremium) return true;
    return this.data.projects.length < FREE_TIER_LIMITS.maxProjects;
  }

  canAddSnippet() {
    if (this.data.settings.isPremium) return true;
    const activeProject = this.getActiveProject();
    if (!activeProject) return false;
    return activeProject.snippets.length < FREE_TIER_LIMITS.maxSnippets;
  }

  showNewProjectModal() {
    if (!this.canCreateProject()) {
      this.showToast('Upgrade to Pro to create more projects', 'error');
      return;
    }

    const modalBody = document.getElementById('modalBody');
    document.getElementById('modalTitle').textContent = 'New Project';

    modalBody.innerHTML = `
      <div class="form-group">
        <label class="form-label">Project Name</label>
        <input type="text" class="form-input" id="projectNameInput"
               placeholder="e.g., my-react-app" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="form-label">Context Description</label>
        <textarea class="form-textarea" id="projectContextInput"
                  placeholder="Describe your project for AI context..."></textarea>
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" id="cancelProjectBtn">Cancel</button>
        <button class="btn btn-primary" id="createProjectBtn">Create</button>
      </div>
    `;

    document.getElementById('cancelProjectBtn').addEventListener('click', () => {
      this.hideModal();
    });

    document.getElementById('createProjectBtn').addEventListener('click', () => {
      this.createProject();
    });

    document.getElementById('projectNameInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.createProject();
      }
    });

    this.showModal();
    document.getElementById('projectNameInput').focus();
  }

  async createProject() {
    const name = document.getElementById('projectNameInput').value.trim();
    const context = document.getElementById('projectContextInput').value.trim();

    if (!name) {
      this.showToast('Please enter a project name', 'error');
      return;
    }

    const project = {
      id: this.generateId(),
      name,
      context,
      snippets: [],
      knowledge: [],
      createdAt: Date.now()
    };

    this.data.projects.push(project);
    this.data.activeProjectId = project.id;
    await this.saveData();

    this.hideModal();
    this.render();
    this.showToast('Project created successfully', 'success');
  }

  async deleteCurrentProject() {
    const activeProject = this.getActiveProject();
    if (!activeProject) {
      this.showToast('No project selected', 'error');
      return;
    }

    if (!confirm(`Delete "${activeProject.name}" and all its data?`)) {
      return;
    }

    this.data.projects = this.data.projects.filter(
      (p) => p.id !== activeProject.id
    );
    this.data.activeProjectId = this.data.projects[0]?.id || null;
    await this.saveData();

    this.render();
    this.showToast('Project deleted', 'success');
  }

  showSaveSnippetModal() {
    const activeProject = this.getActiveProject();
    if (!activeProject) {
      this.showToast('Please select a project first', 'error');
      return;
    }

    if (!this.canAddSnippet()) {
      this.showToast('Upgrade to Pro for unlimited snippets', 'error');
      return;
    }

    const modalBody = document.getElementById('modalBody');
    document.getElementById('modalTitle').textContent = 'Save Snippet';

    modalBody.innerHTML = `
      <div class="form-group">
        <label class="form-label">Language</label>
        <input type="text" class="form-input" id="snippetLangInput"
               placeholder="e.g., javascript, python" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="form-label">Code</label>
        <textarea class="form-textarea" id="snippetCodeInput"
                  placeholder="Paste your code here..." style="min-height: 100px;"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <input type="text" class="form-input" id="snippetDescInput"
               placeholder="What does this code do?" autocomplete="off">
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" id="cancelSnippetBtn">Cancel</button>
        <button class="btn btn-primary" id="saveSnippetConfirmBtn">Save</button>
      </div>
    `;

    document.getElementById('cancelSnippetBtn').addEventListener('click', () => {
      this.hideModal();
    });

    document.getElementById('saveSnippetConfirmBtn').addEventListener('click', () => {
      this.saveSnippet();
    });

    this.showModal();
    document.getElementById('snippetLangInput').focus();
  }

  async saveSnippet() {
    const language = document.getElementById('snippetLangInput').value.trim();
    const code = document.getElementById('snippetCodeInput').value.trim();
    const description = document.getElementById('snippetDescInput').value.trim();

    if (!code) {
      this.showToast('Please enter code', 'error');
      return;
    }

    const activeProject = this.getActiveProject();
    if (!activeProject) return;

    const snippet = {
      id: this.generateId(),
      code,
      language: language || 'text',
      description,
      source: 'manual',
      createdAt: Date.now()
    };

    activeProject.snippets.push(snippet);
    await this.saveData();

    this.hideModal();
    this.render();
    this.showToast('Snippet saved', 'success');
  }

  showSearchModal() {
    const activeProject = this.getActiveProject();
    if (!activeProject) {
      this.showToast('Please select a project first', 'error');
      return;
    }

    const modalBody = document.getElementById('modalBody');
    document.getElementById('modalTitle').textContent = 'Search Knowledge Base';

    modalBody.innerHTML = `
      <div class="search-input-wrapper">
        <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input type="text" class="search-input" id="searchInput"
               placeholder="Search snippets and knowledge..." autocomplete="off">
      </div>
      <div id="searchResults" class="knowledge-list"></div>
    `;

    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
      this.performSearch(e.target.value);
    });

    this.showModal();
    searchInput.focus();
    this.performSearch('');
  }

  performSearch(query) {
    const activeProject = this.getActiveProject();
    if (!activeProject) return;

    const resultsContainer = document.getElementById('searchResults');
    const lowerQuery = query.toLowerCase();

    const matchingSnippets = activeProject.snippets.filter((s) =>
      s.code.toLowerCase().includes(lowerQuery) ||
      s.description.toLowerCase().includes(lowerQuery) ||
      s.language.toLowerCase().includes(lowerQuery)
    );

    const matchingKnowledge = activeProject.knowledge.filter((k) =>
      k.question.toLowerCase().includes(lowerQuery) ||
      k.answer.toLowerCase().includes(lowerQuery) ||
      k.tags.some((t) => t.toLowerCase().includes(lowerQuery))
    );

    if (matchingSnippets.length === 0 && matchingKnowledge.length === 0) {
      resultsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">&#128269;</div>
          <div class="empty-state-text">No results found</div>
        </div>
      `;
      return;
    }

    let html = '';

    matchingKnowledge.forEach((k) => {
      html += `
        <div class="knowledge-item" data-id="${k.id}" data-type="knowledge">
          <div class="knowledge-question">${this.escapeHtml(k.question)}</div>
          <div class="knowledge-meta">
            <span>${new Date(k.createdAt).toLocaleDateString()}</span>
            ${k.tags.slice(0, 2).map((t) =>
              `<span class="knowledge-tag">${this.escapeHtml(t)}</span>`
            ).join('')}
          </div>
        </div>
      `;
    });

    matchingSnippets.forEach((s) => {
      html += `
        <div class="snippet-item" data-id="${s.id}" data-type="snippet">
          <div class="snippet-header">
            <span class="snippet-lang">${this.escapeHtml(s.language)}</span>
            <button class="icon-btn delete-snippet-btn" data-id="${s.id}" title="Delete">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="snippet-code">${this.escapeHtml(s.code.substring(0, 150))}${s.code.length > 150 ? '...' : ''}</div>
        </div>
      `;
    });

    resultsContainer.innerHTML = html;

    resultsContainer.querySelectorAll('.delete-snippet-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        await this.deleteSnippet(id);
        this.performSearch(query);
      });
    });
  }

  async deleteSnippet(snippetId) {
    const activeProject = this.getActiveProject();
    if (!activeProject) return;

    activeProject.snippets = activeProject.snippets.filter(
      (s) => s.id !== snippetId
    );
    await this.saveData();
    this.render();
    this.showToast('Snippet deleted', 'success');
  }

  async exportToVSCode() {
    const activeProject = this.getActiveProject();
    if (!activeProject) {
      this.showToast('Please select a project first', 'error');
      return;
    }

    const exportData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      project: {
        id: activeProject.id,
        name: activeProject.name,
        context: activeProject.context
      },
      snippets: activeProject.snippets,
      knowledge: activeProject.knowledge
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json'
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `devcontext-${activeProject.name.toLowerCase().replace(/\s+/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showToast('Exported successfully', 'success');
  }

  showUpgradeModal() {
    const modalBody = document.getElementById('modalBody');
    document.getElementById('modalTitle').textContent = 'Upgrade to Pro';

    modalBody.innerHTML = `
      <div style="text-align: center; padding: 16px 0;">
        <div style="font-size: 24px; margin-bottom: 12px;">&#9734;</div>
        <div style="font-weight: 600; margin-bottom: 8px;">DevContext Sync Pro</div>
        <div style="font-size: 20px; color: var(--accent-primary); margin-bottom: 8px;">$12/month</div>
        <div style="color: var(--text-secondary); font-size: 12px; margin-bottom: 16px;">
          Unlimited projects and snippets<br>
          Searchable knowledge base<br>
          Priority support
        </div>
        <button class="btn btn-primary" id="buyProBtn" style="width: 100%; margin-bottom: 16px;">
          Buy Pro License
        </button>
        <div style="border-top: 1px solid var(--border-color); padding-top: 16px; margin-top: 8px;">
          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">Already have a license?</div>
          <div style="display: flex; gap: 8px;">
            <input type="text" id="licenseKeyInput" class="form-input" placeholder="DCS-XXXX-XXXX-XXXX" style="flex: 1; font-family: monospace; text-transform: uppercase;">
            <button class="btn btn-secondary" id="activateLicenseBtn">Activate</button>
          </div>
          <div id="licenseError" style="color: var(--accent-danger); font-size: 11px; margin-top: 8px; display: none;"></div>
        </div>
      </div>
    `;

    document.getElementById('buyProBtn').addEventListener('click', () => {
      openPaymentPage('pro');
    });

    document.getElementById('activateLicenseBtn').addEventListener('click', async () => {
      const key = document.getElementById('licenseKeyInput').value;
      const errorEl = document.getElementById('licenseError');

      const result = await activateLicense(key);

      if (result.success) {
        this.data.settings.isPremium = true;
        await this.saveData();
        this.hideModal();
        this.render();
        this.showToast(result.message, 'success');
      } else {
        errorEl.textContent = result.message;
        errorEl.style.display = 'block';
      }
    });

    document.getElementById('licenseKeyInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('activateLicenseBtn').click();
      }
    });

    this.showModal();
  }

  showSettingsModal() {
    const modalBody = document.getElementById('modalBody');
    document.getElementById('modalTitle').textContent = 'Settings';

    modalBody.innerHTML = `
      <div class="form-group">
        <label class="form-label">Account Status</label>
        <div style="padding: 8px 12px; background: var(--bg-primary); border-radius: var(--radius-md); font-size: 12px;">
          ${this.data.settings.isPremium ? 'Pro' : 'Free Tier'}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Storage Used</label>
        <div style="padding: 8px 12px; background: var(--bg-primary); border-radius: var(--radius-md); font-size: 12px;">
          ${this.data.projects.length} projects,
          ${this.data.projects.reduce((sum, p) => sum + p.snippets.length, 0)} snippets,
          ${this.data.projects.reduce((sum, p) => sum + p.knowledge.length, 0)} knowledge items
        </div>
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" id="clearDataBtn" style="color: var(--accent-danger);">
          Clear All Data
        </button>
      </div>
    `;

    document.getElementById('clearDataBtn').addEventListener('click', async () => {
      if (confirm('This will delete all projects and data. Are you sure?')) {
        this.data = { ...DEFAULT_DATA };
        await this.saveData();
        this.hideModal();
        this.render();
        this.showToast('All data cleared', 'success');
      }
    });

    this.showModal();
  }

  showModal() {
    document.getElementById('modal').classList.remove('hidden');
  }

  hideModal() {
    document.getElementById('modal').classList.add('hidden');
  }

  showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;

    setTimeout(() => {
      toast.classList.add('hidden');
    }, 2500);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new DevContextSync();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_SNIPPET' || message.type === 'SAVE_KNOWLEDGE') {
    chrome.storage.local.get(['devContextData'], async (result) => {
      const data = result.devContextData || DEFAULT_DATA;
      const activeProject = data.projects.find(
        (p) => p.id === data.activeProjectId
      );

      if (!activeProject) {
        sendResponse({ success: false, error: 'No active project' });
        return;
      }

      if (message.type === 'SAVE_SNIPPET') {
        if (!data.settings.isPremium &&
            activeProject.snippets.length >= FREE_TIER_LIMITS.maxSnippets) {
          sendResponse({ success: false, error: 'Snippet limit reached' });
          return;
        }

        activeProject.snippets.push({
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
          code: message.data.code,
          language: message.data.language || 'text',
          description: message.data.description || '',
          source: message.data.source || 'chatgpt',
          createdAt: Date.now()
        });
      } else if (message.type === 'SAVE_KNOWLEDGE') {
        activeProject.knowledge.push({
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
          question: message.data.question,
          answer: message.data.answer,
          source: message.data.source || 'chatgpt',
          tags: message.data.tags || [],
          createdAt: Date.now()
        });
      }

      chrome.storage.local.set({ devContextData: data }, () => {
        sendResponse({ success: true });
      });
    });

    return true;
  }
});
