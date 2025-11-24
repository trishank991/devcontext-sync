// DevContext Sync - Popup UI
// Uses message-based API to communicate with background.js

// Beta limits - more generous to encourage adoption
const FREE_TIER_LIMITS = {
  maxProjects: 5,      // Was 3, increased for beta
  maxSnippets: 100,    // Was 50, increased for beta
  maxKnowledge: 200    // Was 100, increased for beta
};

class DevContextSync {
  constructor() {
    this.projects = [];
    this.activeProject = null;
    this.settings = {};
    this.currentOnboardingSlide = 0;
    this.init();
  }

  async init() {
    await this.loadData();
    this.bindEvents();
    this.render();
    this.updateStorageInfo();
    this.checkCloudStatus();
    await this.checkFirstRun();
  }

  async checkFirstRun() {
    const result = await this.sendMessage('GET_SETTINGS');
    if (result.settings?.isFirstRun) {
      this.showOnboarding();
    }
  }

  showOnboarding() {
    const modal = document.getElementById('onboardingModal');
    modal.classList.remove('hidden');
    this.currentOnboardingSlide = 0;
    this.updateOnboardingSlide();
  }

  hideOnboarding() {
    const modal = document.getElementById('onboardingModal');
    modal.classList.add('hidden');
    // Mark first run as complete
    this.sendMessage('UPDATE_SETTING', { key: 'isFirstRun', value: false });
  }

  updateOnboardingSlide() {
    const slides = document.querySelectorAll('.onboarding-slide');
    const dots = document.querySelectorAll('.onboarding-dot');
    const nextBtn = document.getElementById('nextOnboarding');

    slides.forEach((slide, i) => {
      slide.classList.toggle('active', i === this.currentOnboardingSlide);
    });

    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === this.currentOnboardingSlide);
    });

    // Change button text on last slide
    if (this.currentOnboardingSlide === slides.length - 1) {
      nextBtn.textContent = 'Get Started';
    } else {
      nextBtn.textContent = 'Next';
    }
  }

  nextOnboardingSlide() {
    const slides = document.querySelectorAll('.onboarding-slide');
    if (this.currentOnboardingSlide < slides.length - 1) {
      this.currentOnboardingSlide++;
      this.updateOnboardingSlide();
    } else {
      this.hideOnboarding();
    }
  }

  // ============================================
  // Data Loading via Messages
  // ============================================

  async sendMessage(type, data = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('No response from background (timeout)'));
        }
      }, 5000);

      try {
        chrome.runtime.sendMessage({ type, data }, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            return reject(chrome.runtime.lastError);
          }
          if (typeof response === 'undefined') {
            return reject(new Error('No response from background'));
          }
          resolve(response);
        });
      } catch (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(err);
        }
      }
    });
  }

  async loadData() {
    const [projectsResult, settingsResult] = await Promise.all([
      this.sendMessage('GET_ALL_PROJECTS'),
      this.sendMessage('GET_SETTINGS')
    ]);

    this.projects = projectsResult.projects || [];
    this.settings = settingsResult.settings || {};

    // Get active project details
    const activeResult = await this.sendMessage('GET_ACTIVE_PROJECT');
    this.activeProject = activeResult.project;
  }

  // ============================================
  // Event Bindings
  // ============================================

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

    document.getElementById('activityLogBtn').addEventListener('click', () => {
      this.showActivityLogModal();
    });

    document.getElementById('backupBtn').addEventListener('click', () => {
      this.backupAllData();
    });

    document.getElementById('restoreBtn').addEventListener('click', () => {
      document.getElementById('restoreFileInput').click();
    });

    document.getElementById('restoreFileInput').addEventListener('change', (e) => {
      this.restoreFromFile(e.target.files[0]);
    });

    document.getElementById('upgradeBtn').addEventListener('click', () => {
      this.showUpgradeModal();
    });

    document.getElementById('settingsBtn').addEventListener('click', () => {
      this.showSettingsModal();
    });

    document.getElementById('syncStatusBtn').addEventListener('click', () => {
      this.showCloudSyncModal();
    });

    document.getElementById('closeModalBtn').addEventListener('click', () => {
      this.hideModal();
    });

    document.getElementById('modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal') {
        this.hideModal();
      }
    });

    // Onboarding events
    document.getElementById('skipOnboarding').addEventListener('click', () => {
      this.hideOnboarding();
    });

    document.getElementById('nextOnboarding').addEventListener('click', () => {
      this.nextOnboardingSlide();
    });

    // Allow clicking dots to navigate
    document.querySelectorAll('.onboarding-dot').forEach((dot) => {
      dot.addEventListener('click', () => {
        this.currentOnboardingSlide = parseInt(dot.dataset.slide);
        this.updateOnboardingSlide();
      });
    });
  }

  // ============================================
  // Rendering
  // ============================================

  render() {
    this.renderProjectSelector();
    this.renderStats();
    this.renderTierBadge();
  }

  renderProjectSelector() {
    const select = document.getElementById('projectSelect');
    select.innerHTML = '<option value="">Select a project...</option>';

    this.projects.forEach((project) => {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      if (project.isActive) {
        option.selected = true;
      }
      select.appendChild(option);
    });
  }

  renderStats() {
    document.getElementById('snippetCount').textContent =
      this.activeProject?.snippetCount || 0;
    document.getElementById('knowledgeCount').textContent =
      this.activeProject?.knowledgeCount || 0;
    document.getElementById('projectCount').textContent =
      this.projects.length;
  }

  renderTierBadge() {
    const badge = document.getElementById('tierBadge');
    const isPremium = this.settings.isPremium;

    if (isPremium) {
      badge.classList.add('premium');
      badge.querySelector('.tier-label').textContent = 'Pro';
      badge.querySelector('.tier-limits').textContent = 'Unlimited + Cloud Sync';
      document.getElementById('upgradeBtn').textContent = 'Manage';
    } else {
      badge.classList.remove('premium');
      badge.querySelector('.tier-label').textContent = 'Free Tier';
      badge.querySelector('.tier-limits').textContent =
        `${this.projects.length}/${FREE_TIER_LIMITS.maxProjects} projects`;
      document.getElementById('upgradeBtn').textContent = 'Upgrade';
    }
  }

  async updateStorageInfo() {
    const stats = await this.sendMessage('GET_STORAGE_STATS');
    const storageInfo = document.getElementById('storageInfo');

    if (stats) {
      const usedMB = (stats.used / (1024 * 1024)).toFixed(2);
      storageInfo.querySelector('.storage-type').textContent = stats.type;
      storageInfo.querySelector('.storage-usage').textContent =
        `${usedMB} MB (${stats.percentage}%)`;
    }
  }

  async checkCloudStatus() {
    const status = await this.sendMessage('GET_CLOUD_STATUS');
    const syncBtn = document.getElementById('syncStatusBtn');
    const syncBar = document.getElementById('syncStatusBar');
    const syncStatusText = document.getElementById('syncStatusText');
    const lastSyncTime = document.getElementById('lastSyncTime');
    const pendingCount = document.getElementById('pendingCount');

    if (status.available && status.enabled) {
      // Show sync button in header
      syncBtn.classList.remove('hidden');

      // Show sync status bar
      syncBar.classList.remove('hidden');
      syncBar.classList.remove('syncing', 'error', 'pending');

      if (status.syncing) {
        syncBar.classList.add('syncing');
        syncStatusText.textContent = 'Syncing...';
        syncBtn.title = 'Syncing...';
      } else if (status.error) {
        syncBar.classList.add('error');
        syncStatusText.textContent = 'Sync error';
        syncBtn.title = 'Sync error - click to retry';
      } else if (status.pendingChanges > 0) {
        syncBar.classList.add('pending');
        syncStatusText.textContent = 'Changes pending';
        syncBtn.classList.add('pending');
        syncBtn.title = `${status.pendingChanges} changes pending sync`;
        pendingCount.textContent = `${status.pendingChanges} pending`;
        pendingCount.classList.remove('hidden');
      } else {
        syncStatusText.textContent = 'Cloud sync enabled';
        syncBtn.classList.remove('pending');
        syncBtn.title = 'Cloud sync active';
        pendingCount.classList.add('hidden');
      }

      // Format last sync time
      if (status.lastSyncAt) {
        lastSyncTime.textContent = `Last synced: ${this.formatTimeAgo(new Date(status.lastSyncAt).getTime())}`;
      } else {
        lastSyncTime.textContent = 'Never synced';
      }
    } else {
      syncBtn.classList.add('hidden');
      syncBar.classList.add('hidden');
    }
  }

  // ============================================
  // Project Operations
  // ============================================

  async switchProject(projectId) {
    if (projectId) {
      await this.sendMessage('SET_ACTIVE_PROJECT', { projectId });
    }
    await this.loadData();
    this.render();
  }

  canCreateProject() {
    if (this.settings.isPremium) return true;
    return this.projects.length < FREE_TIER_LIMITS.maxProjects;
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

    if (!name) {
      this.showToast('Please enter a project name', 'error');
      return;
    }

    const result = await this.sendMessage('CREATE_PROJECT', { name });

    if (result.success) {
      await this.loadData();
      this.hideModal();
      this.render();
      this.showToast('Project created successfully', 'success');
    } else {
      this.showToast(result.error || 'Failed to create project', 'error');
    }
  }

  async deleteCurrentProject() {
    if (!this.activeProject) {
      this.showToast('No project selected', 'error');
      return;
    }

    if (!confirm(`Delete "${this.activeProject.name}" and all its data?`)) {
      return;
    }

    const result = await this.sendMessage('DELETE_PROJECT', {
      projectId: this.activeProject.id
    });

    if (result.success) {
      await this.loadData();
      this.render();
      this.showToast('Project deleted', 'success');
    } else {
      this.showToast(result.error || 'Failed to delete project', 'error');
    }
  }

  // ============================================
  // Snippet Operations
  // ============================================

  showSaveSnippetModal() {
    if (!this.activeProject) {
      this.showToast('Please select a project first', 'error');
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

    const result = await this.sendMessage('SAVE_SNIPPET', {
      code,
      language: language || 'text',
      description,
      source: 'manual'
    });

    if (result.success) {
      await this.loadData();
      this.hideModal();
      this.render();
      this.showToast('Snippet saved', 'success');
    } else {
      this.showToast(result.error || 'Failed to save snippet', 'error');
    }
  }

  // ============================================
  // Search
  // ============================================

  async showSearchModal() {
    if (!this.activeProject) {
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

  async performSearch(query) {
    const resultsContainer = document.getElementById('searchResults');

    // Use fuzzy search if query is provided, otherwise get all
    let matchingSnippets = [];
    let matchingKnowledge = [];

    if (query && query.trim()) {
      // Use the new fuzzy search
      const searchResult = await this.sendMessage('SEARCH_ALL', { query: query.trim() });
      const results = searchResult.results || [];

      matchingSnippets = results.filter(r => r.type === 'snippet');
      matchingKnowledge = results.filter(r => r.type === 'knowledge');
    } else {
      // Get all items when no query
      const [snippetsResult, knowledgeResult] = await Promise.all([
        this.sendMessage('GET_SNIPPETS'),
        this.sendMessage('GET_KNOWLEDGE')
      ]);
      matchingSnippets = snippetsResult.snippets || [];
      matchingKnowledge = knowledgeResult.knowledge || [];
    }

    if (matchingSnippets.length === 0 && matchingKnowledge.length === 0) {
      resultsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">&#128269;</div>
          <div class="empty-state-text">${query ? 'No results found' : 'No items saved yet'}</div>
        </div>
      `;
      return;
    }

    let html = '';

    matchingKnowledge.forEach((k) => {
      const scoreIndicator = k.searchScore ? `<span class="search-score" title="Relevance score">${k.searchScore}</span>` : '';
      html += `
        <div class="knowledge-item" data-id="${k.id}" data-type="knowledge">
          <div class="knowledge-question">${this.escapeHtml(k.question)}</div>
          <div class="knowledge-meta">
            <span>${new Date(k.createdAt).toLocaleDateString()}</span>
            ${(k.tags || []).slice(0, 2).map((t) =>
              `<span class="knowledge-tag">${this.escapeHtml(t)}</span>`
            ).join('')}
            ${scoreIndicator}
          </div>
        </div>
      `;
    });

    matchingSnippets.forEach((s) => {
      const scoreIndicator = s.searchScore ? `<span class="search-score" title="Relevance score">${s.searchScore}</span>` : '';
      html += `
        <div class="snippet-item" data-id="${s.id}" data-type="snippet">
          <div class="snippet-header">
            <span class="snippet-lang">${this.escapeHtml(s.language)}</span>
            ${scoreIndicator}
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
        await this.sendMessage('DELETE_SNIPPET', { id });
        await this.loadData();
        this.render();
        this.performSearch(query);
        this.showToast('Snippet deleted', 'success');
      });
    });
  }

  // ============================================
  // Export / Import
  // ============================================

  async exportToVSCode() {
    if (!this.activeProject) {
      this.showToast('Please select a project first', 'error');
      return;
    }

    const [snippetsResult, knowledgeResult] = await Promise.all([
      this.sendMessage('GET_SNIPPETS'),
      this.sendMessage('GET_KNOWLEDGE')
    ]);

    const exportData = {
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
      project: {
        id: this.activeProject.id,
        name: this.activeProject.name
      },
      snippets: snippetsResult.snippets || [],
      knowledge: knowledgeResult.knowledge || []
    };

    this.downloadJson(exportData, `devcontext-${this.activeProject.name.toLowerCase().replace(/\s+/g, '-')}.json`);
    this.showToast('Exported successfully', 'success');
  }

  async backupAllData() {
    const result = await this.sendMessage('EXPORT_DATA');

    if (result) {
      this.downloadJson(result, `devcontext-backup-${new Date().toISOString().split('T')[0]}.json`);
      this.showToast('Backup created successfully', 'success');
    } else {
      this.showToast('Failed to create backup', 'error');
    }
  }

  async restoreFromFile(file) {
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.data && !data.project) {
        throw new Error('Invalid backup format');
      }

      const result = await this.sendMessage('IMPORT_DATA', data);

      if (result.imported) {
        await this.loadData();
        this.render();
        this.showToast(
          `Restored: ${result.imported.projects || 0} projects, ${result.imported.snippets || 0} snippets`,
          'success'
        );
      }
    } catch (error) {
      this.showToast('Failed to restore: ' + error.message, 'error');
    }

    // Reset file input
    document.getElementById('restoreFileInput').value = '';
  }

  downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json'
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ============================================
  // Cloud Sync Modal (Premium)
  // ============================================

  async showCloudSyncModal() {
    const status = await this.sendMessage('GET_CLOUD_STATUS');
    const modalBody = document.getElementById('modalBody');
    document.getElementById('modalTitle').textContent = 'Cloud Sync';

    if (!status.available) {
      modalBody.innerHTML = `
        <div style="text-align: center; padding: 16px 0;">
          <div style="font-size: 24px; margin-bottom: 12px;">&#9729;</div>
          <div style="color: var(--text-secondary); margin-bottom: 16px;">
            Cloud sync is a Pro feature
          </div>
          <button class="btn btn-primary" id="upgradeForCloudBtn">Upgrade to Pro</button>
        </div>
      `;

      document.getElementById('upgradeForCloudBtn').addEventListener('click', () => {
        this.hideModal();
        this.showUpgradeModal();
      });
    } else if (!status.enabled || !status.user) {
      modalBody.innerHTML = `
        <div style="text-align: center; padding: 16px 0;">
          <div style="font-size: 24px; margin-bottom: 12px;">&#9729;</div>
          <div style="margin-bottom: 16px;">Sign in to enable cloud sync</div>
          <div class="form-group">
            <input type="email" class="form-input" id="cloudEmailInput" placeholder="Email">
          </div>
          <div class="form-group">
            <input type="password" class="form-input" id="cloudPasswordInput" placeholder="Password">
          </div>
          <div id="cloudLoginError" style="color: var(--accent-danger); font-size: 11px; margin-bottom: 8px; display: none;"></div>
          <button class="btn btn-primary" id="cloudLoginBtn" style="width: 100%;">Sign In</button>
        </div>
      `;

      document.getElementById('cloudLoginBtn').addEventListener('click', async () => {
        const email = document.getElementById('cloudEmailInput').value;
        const password = document.getElementById('cloudPasswordInput').value;
        const errorEl = document.getElementById('cloudLoginError');

        const result = await this.sendMessage('CLOUD_LOGIN', { email, password });

        if (result.success) {
          this.hideModal();
          this.checkCloudStatus();
          this.showToast('Cloud sync enabled', 'success');
        } else {
          errorEl.textContent = result.message;
          errorEl.style.display = 'block';
        }
      });
    } else {
      const lastSync = status.lastSyncAt
        ? new Date(status.lastSyncAt).toLocaleString()
        : 'Never';

      modalBody.innerHTML = `
        <div style="padding: 8px 0;">
          <div class="form-group">
            <label class="form-label">Account</label>
            <div style="padding: 8px 12px; background: var(--bg-primary); border-radius: var(--radius-md); font-size: 12px;">
              ${this.escapeHtml(status.user?.email || 'Unknown')}
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Status</label>
            <div style="padding: 8px 12px; background: var(--bg-primary); border-radius: var(--radius-md); font-size: 12px; display: flex; justify-content: space-between;">
              <span style="color: #3fb950;">&#9679; Connected</span>
              <span>${status.pendingChanges} pending</span>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Last Synced</label>
            <div style="padding: 8px 12px; background: var(--bg-primary); border-radius: var(--radius-md); font-size: 12px;">
              ${lastSync}
            </div>
          </div>
          <div class="form-actions" style="margin-top: 16px;">
            <button class="btn btn-secondary" id="cloudLogoutBtn">Sign Out</button>
            <button class="btn btn-primary" id="forceSyncBtn">Sync Now</button>
          </div>
        </div>
      `;

      document.getElementById('cloudLogoutBtn').addEventListener('click', async () => {
        await this.sendMessage('CLOUD_LOGOUT');
        this.hideModal();
        this.checkCloudStatus();
        this.showToast('Signed out', 'success');
      });

      document.getElementById('forceSyncBtn').addEventListener('click', async () => {
        try {
          const result = await this.sendMessage('FORCE_SYNC');
          const pushed = Number(result?.pushed) || 0;
          const pulledCount = Object.values(result?.pulled || {}).reduce((a, b) => a + (Number(b) || 0), 0);
          if (result?.success) {
            await this.loadData();
            this.render();
            this.checkCloudStatus();
            this.showToast(`Synced: ${pushed} pushed, ${pulledCount} pulled`, 'success');
          } else {
            this.showToast(result?.error || 'Sync failed', 'error');
          }
        } catch (err) {
          this.showToast(err?.message || 'Sync failed', 'error');
        }
      });
    }

    this.showModal();
  }

  // ============================================
  // Upgrade Modal
  // ============================================

  showUpgradeModal() {
    const modalBody = document.getElementById('modalBody');
    document.getElementById('modalTitle').textContent = 'Upgrade to Pro';

    modalBody.innerHTML = `
      <div style="text-align: center; padding: 16px 0;">
        <div style="font-size: 24px; margin-bottom: 12px;">&#9734;</div>
        <div style="font-weight: 600; margin-bottom: 8px;">DevContext Sync Pro</div>
        <div style="font-size: 20px; color: var(--accent-primary); margin-bottom: 8px;">$12/month</div>
        <div style="color: var(--text-secondary); font-size: 12px; margin-bottom: 16px;">
          &#10003; Unlimited projects and snippets<br>
          &#10003; Cloud sync across devices<br>
          &#10003; 50MB+ storage (IndexedDB)<br>
          &#10003; Priority support
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
        await this.sendMessage('UPDATE_SETTING', { key: 'isPremium', value: true });
        await this.loadData();
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

  // ============================================
  // Settings Modal
  // ============================================

  async showSettingsModal() {
    const stats = await this.sendMessage('GET_STORAGE_STATS');
    const settingsResult = await this.sendMessage('GET_SETTINGS');
    const autoPromptEnabled = settingsResult.settings?.autoPromptEnabled !== false;
    const modalBody = document.getElementById('modalBody');
    document.getElementById('modalTitle').textContent = 'Settings';

    modalBody.innerHTML = `
      <div class="form-group">
        <label class="form-label">Account Status</label>
        <div style="padding: 8px 12px; background: var(--bg-primary); border-radius: var(--radius-md); font-size: 12px;">
          ${this.settings.isPremium ? 'Pro' : 'Free Tier'}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Auto-Prompt to Save</label>
        <div style="padding: 8px 12px; background: var(--bg-primary); border-radius: var(--radius-md); font-size: 12px; display: flex; justify-content: space-between; align-items: center;">
          <span style="color: var(--text-secondary);">Show save prompts after AI responses</span>
          <label class="toggle-switch">
            <input type="checkbox" id="autoPromptToggle" ${autoPromptEnabled ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Storage</label>
        <div style="padding: 8px 12px; background: var(--bg-primary); border-radius: var(--radius-md); font-size: 12px;">
          ${stats.type}: ${(stats.used / (1024 * 1024)).toFixed(2)} MB (${stats.percentage}%)<br>
          <span style="color: var(--text-secondary);">
            ${stats.counts?.projects || 0} projects,
            ${stats.counts?.snippets || 0} snippets,
            ${stats.counts?.knowledge || 0} knowledge items
          </span>
        </div>
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" id="clearDataBtn" style="color: var(--accent-danger);">
          Clear All Data
        </button>
      </div>
    `;

    document.getElementById('autoPromptToggle').addEventListener('change', async (e) => {
      await this.sendMessage('UPDATE_SETTING', { key: 'autoPromptEnabled', value: e.target.checked });
      this.showToast(e.target.checked ? 'Auto-prompt enabled' : 'Auto-prompt disabled', 'success');
    });

    document.getElementById('clearDataBtn').addEventListener('click', async () => {
      if (confirm('This will delete all projects and data. Are you sure?')) {
        // Clear via IndexedDB
        await new Promise((resolve) => {
          const request = indexedDB.deleteDatabase('DevContextDB');
          request.onsuccess = resolve;
          request.onerror = resolve;
        });

        // Reload extension
        chrome.runtime.reload();
      }
    });

    this.showModal();
  }

  // ============================================
  // Activity Log Modal
  // ============================================

  async showActivityLogModal() {
    const modalBody = document.getElementById('modalBody');
    document.getElementById('modalTitle').textContent = 'Activity Log';

    modalBody.innerHTML = `
      <div class="activity-log-container">
        <div class="activity-log-header">
          <select id="activityFilter" class="select" style="width: auto; min-width: 120px;">
            <option value="">All Activity</option>
            <option value="save">Saves</option>
            <option value="duplicate_detected">Duplicates</option>
            <option value="export">Exports</option>
          </select>
          <button class="btn btn-secondary" id="clearActivityBtn" style="font-size: 11px;">Clear Log</button>
        </div>
        <div id="activityLogList" class="activity-log-list">
          <div class="loading-state">Loading...</div>
        </div>
      </div>
    `;

    this.showModal();
    await this.loadActivityLog();

    document.getElementById('activityFilter').addEventListener('change', (e) => {
      this.loadActivityLog(e.target.value);
    });

    document.getElementById('clearActivityBtn').addEventListener('click', async () => {
      if (confirm('Clear all activity logs?')) {
        await this.sendMessage('CLEAR_ACTIVITY_LOG');
        this.loadActivityLog();
        this.showToast('Activity log cleared', 'success');
      }
    });
  }

  async loadActivityLog(filter = '') {
    const result = await this.sendMessage('GET_ACTIVITY_LOG', { action: filter || undefined, limit: 50 });
    const logs = result.logs || [];
    const container = document.getElementById('activityLogList');

    if (logs.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">&#128203;</div>
          <div class="empty-state-text">No activity yet</div>
        </div>
      `;
      return;
    }

    const platformIcons = {
      chatgpt: '&#129302;',
      claude: '&#128640;',
      gemini: '&#10024;',
      github: '&#128025;',
      stackoverflow: '&#128218;',
      documentation: '&#128196;',
      web: '&#127760;',
      unknown: '&#128204;'
    };

    const actionLabels = {
      save: { label: 'Saved', color: '#3fb950' },
      duplicate_detected: { label: 'Duplicate', color: '#f0883e' },
      export: { label: 'Exported', color: '#58a6ff' },
      delete: { label: 'Deleted', color: '#f85149' }
    };

    container.innerHTML = logs.map(log => {
      const action = actionLabels[log.action] || { label: log.action, color: '#8b949e' };
      const platform = platformIcons[log.platform] || platformIcons.unknown;
      const time = this.formatTimeAgo(log.timestamp);
      const type = log.itemType === 'snippet' ? 'Code' : 'Knowledge';

      return `
        <div class="activity-log-item">
          <span class="activity-platform" title="${log.platform || 'unknown'}">${platform}</span>
          <div class="activity-details">
            <div class="activity-action" style="color: ${action.color};">${action.label} ${type}</div>
            <div class="activity-meta">${time}${log.source ? ' • ' + this.escapeHtml(this.truncateUrl(log.source)) : ''}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

    return new Date(timestamp).toLocaleDateString();
  }

  truncateUrl(url) {
    try {
      const hostname = new URL(url).hostname;
      return hostname.replace('www.', '');
    } catch {
      return url.substring(0, 30);
    }
  }

  // ============================================
  // Modal Helpers
  // ============================================

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

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  new DevContextSync();
});
