import * as vscode from 'vscode';
import * as fs from 'fs';

// Data interfaces matching Chrome extension export format
interface Project {
    id: string;
    name: string;
    createdAt: number;
}

interface Snippet {
    id: string;
    projectId: string;
    code: string;
    language: string;
    description: string;
    source: string;
    createdAt: number;
}

interface Knowledge {
    id: string;
    projectId: string;
    question: string;
    answer: string;
    source: string;
    tags: string[];
    createdAt: number;
}

interface DevContextData {
    version?: number;
    exportedAt?: string;
    data?: {
        projects: Project[];
        snippets: Snippet[];
        knowledge: Knowledge[];
    };
    // Single project export format
    project?: Project;
    snippets?: Snippet[];
    knowledge?: Knowledge[];
}

let statusBarItem: vscode.StatusBarItem;
let contextData: DevContextData | null = null;
let activeProjectId: string | null = null;
let fileWatcher: vscode.FileSystemWatcher | null = null;

// Debounce and loop prevention for file watcher
let isLoadingFile = false;
let fileWatcherDebounceTimer: NodeJS.Timeout | null = null;
const FILE_WATCHER_DEBOUNCE_MS = 500;

// Data size limits to prevent malicious payloads
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB max
const MAX_PROJECTS = 1000;
const MAX_SNIPPETS = 10000;
const MAX_KNOWLEDGE = 10000;
const MAX_STRING_LENGTH = 500000; // 500KB per string field

// Tree data providers
let projectsProvider: ProjectsTreeDataProvider;
let snippetsProvider: SnippetsTreeDataProvider;
let knowledgeProvider: KnowledgeTreeDataProvider;

export function activate(context: vscode.ExtensionContext) {
    console.log('DevContext Sync extension activated');

    // Load saved data
    contextData = context.globalState.get<DevContextData>('devContextData') || null;
    activeProjectId = context.globalState.get<string>('activeProjectId') || null;

    // Create tree data providers
    projectsProvider = new ProjectsTreeDataProvider();
    snippetsProvider = new SnippetsTreeDataProvider();
    knowledgeProvider = new KnowledgeTreeDataProvider();

    // Register tree views
    vscode.window.registerTreeDataProvider('devcontext.projects', projectsProvider);
    vscode.window.registerTreeDataProvider('devcontext.snippets', snippetsProvider);
    vscode.window.registerTreeDataProvider('devcontext.knowledge', knowledgeProvider);

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'devcontext.switchProject';
    updateStatusBar();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Setup file watcher for auto-refresh
    setupFileWatcher(context);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('devcontext.refresh', () => refresh()),
        vscode.commands.registerCommand('devcontext.importFromFile', () => importFromFile(context)),
        vscode.commands.registerCommand('devcontext.search', () => showSearch()),
        vscode.commands.registerCommand('devcontext.copySnippet', (item: SnippetItem) => copySnippet(item)),
        vscode.commands.registerCommand('devcontext.insertSnippet', (item: SnippetItem) => insertSnippet(item)),
        vscode.commands.registerCommand('devcontext.openSnippetPreview', (item: SnippetItem) => previewSnippet(item)),
        vscode.commands.registerCommand('devcontext.switchProject', () => switchProject(context)),
        vscode.commands.registerCommand('devcontext.selectProject', (projectId: string) => selectProject(context, projectId))
    );

    refresh();
}

function setupFileWatcher(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('devcontext');
    const dataPath = config.get<string>('dataPath');

    if (dataPath && config.get<boolean>('autoRefresh')) {
        try {
            fileWatcher = vscode.workspace.createFileSystemWatcher(dataPath);
            fileWatcher.onDidChange(() => {
                // Prevent infinite loop: debounce and skip if already loading
                if (isLoadingFile) {
                    return;
                }

                // Debounce rapid file changes
                if (fileWatcherDebounceTimer) {
                    clearTimeout(fileWatcherDebounceTimer);
                }

                fileWatcherDebounceTimer = setTimeout(async () => {
                    fileWatcherDebounceTimer = null;
                    await loadFromFile(dataPath, context);
                    refresh();
                }, FILE_WATCHER_DEBOUNCE_MS);
            });
            context.subscriptions.push(fileWatcher);
        } catch {
            // Failed to create file watcher, ignore
        }
    }
}

async function importFromFile(context: vscode.ExtensionContext) {
    const options: vscode.OpenDialogOptions = {
        canSelectMany: false,
        openLabel: 'Import DevContext Data',
        filters: { 'JSON files': ['json'] }
    };

    const fileUri = await vscode.window.showOpenDialog(options);
    if (fileUri && fileUri[0]) {
        await loadFromFile(fileUri[0].fsPath, context);

        // Save path for auto-refresh
        const config = vscode.workspace.getConfiguration('devcontext');
        await config.update('dataPath', fileUri[0].fsPath, vscode.ConfigurationTarget.Global);

        refresh();
        vscode.window.showInformationMessage('DevContext data imported successfully!');
    }
}

async function loadFromFile(filePath: string, context: vscode.ExtensionContext) {
    // Prevent re-entry during file loading
    if (isLoadingFile) {
        return;
    }

    isLoadingFile = true;

    try {
        // Check file size before reading
        const stats = fs.statSync(filePath);
        if (stats.size > MAX_FILE_SIZE_BYTES) {
            vscode.window.showErrorMessage(`File too large (${Math.round(stats.size / 1024 / 1024)}MB). Maximum allowed: 50MB`);
            return;
        }

        const content = fs.readFileSync(filePath, 'utf8');

        // Parse and validate JSON
        let data: unknown;
        try {
            data = JSON.parse(content);
        } catch {
            vscode.window.showErrorMessage('Invalid JSON file. Please check the file format.');
            return;
        }

        // Validate data structure
        const validatedData = validateDevContextData(data);
        if (!validatedData) {
            vscode.window.showErrorMessage('Invalid DevContext data format. Expected projects, snippets, or knowledge arrays.');
            return;
        }

        // Normalize data format
        if (validatedData.project && !validatedData.data) {
            // Single project export format
            validatedData.data = {
                projects: [validatedData.project],
                snippets: validatedData.snippets || [],
                knowledge: validatedData.knowledge || []
            };
        }

        contextData = validatedData;
        await context.globalState.update('devContextData', contextData);

        // Set first project as active if none selected
        if (!activeProjectId && validatedData.data?.projects?.length) {
            activeProjectId = validatedData.data.projects[0].id;
            await context.globalState.update('activeProjectId', activeProjectId);
        }

        updateStatusBar();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to load DevContext data: ${error}`);
    } finally {
        isLoadingFile = false;
    }
}

// Validate and sanitize imported data
function validateDevContextData(data: unknown): DevContextData | null {
    if (!data || typeof data !== 'object') {
        return null;
    }

    const obj = data as Record<string, unknown>;

    // Must have either 'data' object or 'project' for single export
    const hasDataObject = obj.data && typeof obj.data === 'object';
    const hasSingleProject = obj.project && typeof obj.project === 'object';

    if (!hasDataObject && !hasSingleProject) {
        return null;
    }

    const result: DevContextData = {};

    // Validate version if present
    if ('version' in obj && typeof obj.version === 'number') {
        result.version = obj.version;
    }

    // Validate exportedAt if present
    if ('exportedAt' in obj && typeof obj.exportedAt === 'string') {
        result.exportedAt = sanitizeString(obj.exportedAt, 100);
    }

    // Validate data object
    if (hasDataObject) {
        const dataObj = obj.data as Record<string, unknown>;
        result.data = {
            projects: validateProjects(dataObj.projects),
            snippets: validateSnippets(dataObj.snippets),
            knowledge: validateKnowledge(dataObj.knowledge)
        };
    }

    // Validate single project format
    if (hasSingleProject) {
        const validatedProjects = validateProjects([obj.project]);
        if (validatedProjects.length > 0) {
            result.project = validatedProjects[0];
        }
        result.snippets = validateSnippets(obj.snippets);
        result.knowledge = validateKnowledge(obj.knowledge);
    }

    return result;
}

function sanitizeString(value: unknown, maxLength: number = MAX_STRING_LENGTH): string {
    if (typeof value !== 'string') {
        return '';
    }
    return value.slice(0, maxLength);
}

function validateProjects(data: unknown): Project[] {
    if (!Array.isArray(data)) {
        return [];
    }

    return data
        .slice(0, MAX_PROJECTS)
        .filter((item): item is Record<string, unknown> =>
            item && typeof item === 'object' &&
            typeof item.id === 'string' &&
            typeof item.name === 'string'
        )
        .map(item => ({
            id: sanitizeString(item.id, 100),
            name: sanitizeString(item.name, 200),
            createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now()
        }));
}

function validateSnippets(data: unknown): Snippet[] {
    if (!Array.isArray(data)) {
        return [];
    }

    return data
        .slice(0, MAX_SNIPPETS)
        .filter((item): item is Record<string, unknown> =>
            item && typeof item === 'object' &&
            typeof item.id === 'string' &&
            typeof item.projectId === 'string' &&
            typeof item.code === 'string'
        )
        .map(item => ({
            id: sanitizeString(item.id, 100),
            projectId: sanitizeString(item.projectId, 100),
            code: sanitizeString(item.code, MAX_STRING_LENGTH),
            language: sanitizeString(item.language || 'text', 50),
            description: sanitizeString(item.description || '', 500),
            source: sanitizeString(item.source || '', 200),
            createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now()
        }));
}

function validateKnowledge(data: unknown): Knowledge[] {
    if (!Array.isArray(data)) {
        return [];
    }

    return data
        .slice(0, MAX_KNOWLEDGE)
        .filter((item): item is Record<string, unknown> =>
            item && typeof item === 'object' &&
            typeof item.id === 'string' &&
            typeof item.projectId === 'string' &&
            typeof item.question === 'string' &&
            typeof item.answer === 'string'
        )
        .map(item => ({
            id: sanitizeString(item.id, 100),
            projectId: sanitizeString(item.projectId, 100),
            question: sanitizeString(item.question, 2000),
            answer: sanitizeString(item.answer, MAX_STRING_LENGTH),
            source: sanitizeString(item.source || '', 200),
            tags: validateTags(item.tags),
            createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now()
        }));
}

function validateTags(data: unknown): string[] {
    if (!Array.isArray(data)) {
        return [];
    }

    return data
        .slice(0, 50) // Max 50 tags
        .filter((tag): tag is string => typeof tag === 'string')
        .map(tag => sanitizeString(tag, 50));
}

function refresh() {
    projectsProvider.refresh();
    snippetsProvider.refresh();
    knowledgeProvider.refresh();
    updateStatusBar();
}

function updateStatusBar() {
    const projects = contextData?.data?.projects || [];
    const activeProject = projects.find(p => p.id === activeProjectId);

    if (activeProject) {
        statusBarItem.text = `$(book) ${activeProject.name}`;
        statusBarItem.tooltip = 'Click to switch project';
    } else if (projects.length > 0) {
        statusBarItem.text = `$(book) ${projects.length} projects`;
        statusBarItem.tooltip = 'Click to select a project';
    } else {
        statusBarItem.text = '$(book) No Data';
        statusBarItem.tooltip = 'Click to import DevContext data';
    }
}

async function switchProject(context: vscode.ExtensionContext) {
    const projects = contextData?.data?.projects || [];

    if (projects.length === 0) {
        const action = await vscode.window.showInformationMessage(
            'No projects found. Import data from browser extension first.',
            'Import'
        );
        if (action === 'Import') {
            importFromFile(context);
        }
        return;
    }

    const items = projects.map(p => ({
        label: p.name,
        description: p.id === activeProjectId ? '(active)' : '',
        projectId: p.id
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a project'
    });

    if (selected) {
        await selectProject(context, selected.projectId);
    }
}

async function selectProject(context: vscode.ExtensionContext, projectId: string) {
    activeProjectId = projectId;
    await context.globalState.update('activeProjectId', activeProjectId);
    refresh();
}

async function showSearch() {
    const query = await vscode.window.showInputBox({
        placeHolder: 'Search snippets and knowledge...',
        prompt: 'Enter search terms'
    });

    if (!query) return;

    const snippets = getActiveSnippets();
    const knowledge = getActiveKnowledge();
    const lowerQuery = query.toLowerCase();

    const matchingSnippets = snippets.filter(s =>
        s.code.toLowerCase().includes(lowerQuery) ||
        s.description.toLowerCase().includes(lowerQuery) ||
        s.language.toLowerCase().includes(lowerQuery)
    );

    const matchingKnowledge = knowledge.filter(k =>
        k.question.toLowerCase().includes(lowerQuery) ||
        k.answer.toLowerCase().includes(lowerQuery)
    );

    const items: vscode.QuickPickItem[] = [
        ...matchingSnippets.map(s => ({
            label: `$(code) ${s.description || s.language}`,
            description: `${s.language} snippet`,
            detail: s.code.substring(0, 100) + (s.code.length > 100 ? '...' : '')
        })),
        ...matchingKnowledge.map(k => ({
            label: `$(book) ${k.question}`,
            description: 'knowledge',
            detail: k.answer.substring(0, 100) + (k.answer.length > 100 ? '...' : '')
        }))
    ];

    if (items.length === 0) {
        vscode.window.showInformationMessage('No results found');
        return;
    }

    await vscode.window.showQuickPick(items, {
        placeHolder: `${items.length} results for "${query}"`
    });
}

function copySnippet(item: SnippetItem) {
    if (item.snippet) {
        vscode.env.clipboard.writeText(item.snippet.code);
        vscode.window.showInformationMessage('Snippet copied to clipboard');
    }
}

function insertSnippet(item: SnippetItem) {
    if (item.snippet) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            editor.edit((editBuilder: vscode.TextEditorEdit) => {
                editBuilder.insert(editor.selection.active, item.snippet!.code);
            });
        } else {
            vscode.window.showWarningMessage('No active editor');
        }
    }
}

function previewSnippet(item: SnippetItem) {
    if (item.snippet) {
        const panel = vscode.window.createWebviewPanel(
            'snippetPreview',
            `Snippet: ${item.snippet.description || item.snippet.language}`,
            vscode.ViewColumn.One,
            {}
        );

        panel.webview.html = getSnippetPreviewHtml(item.snippet);
    }
}

function getSnippetPreviewHtml(snippet: Snippet): string {
    const escapeHtml = (text: string) => text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: var(--vscode-font-family); padding: 20px; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
        .header { margin-bottom: 16px; }
        .language { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 2px 8px; border-radius: 4px; font-size: 12px; }
        .source { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 8px; }
        pre { background: var(--vscode-textBlockQuote-background); padding: 16px; border-radius: 4px; overflow-x: auto; }
        code { font-family: var(--vscode-editor-font-family); }
    </style>
</head>
<body>
    <div class="header">
        <span class="language">${escapeHtml(snippet.language)}</span>
        ${snippet.description ? `<p>${escapeHtml(snippet.description)}</p>` : ''}
        <div class="source">Source: ${escapeHtml(snippet.source)}</div>
    </div>
    <pre><code>${escapeHtml(snippet.code)}</code></pre>
</body>
</html>`;
}

// Helper functions
function getActiveSnippets(): Snippet[] {
    if (!contextData?.data?.snippets) return [];
    if (!activeProjectId) return contextData.data.snippets;
    return contextData.data.snippets.filter(s => s.projectId === activeProjectId);
}

function getActiveKnowledge(): Knowledge[] {
    if (!contextData?.data?.knowledge) return [];
    if (!activeProjectId) return contextData.data.knowledge;
    return contextData.data.knowledge.filter(k => k.projectId === activeProjectId);
}

// Tree Item Classes
class ProjectItem extends vscode.TreeItem {
    public project: Project;

    constructor(project: Project, isActive: boolean) {
        super(project.name, vscode.TreeItemCollapsibleState.None);
        this.project = project;
        this.contextValue = 'project';
        this.iconPath = new vscode.ThemeIcon(isActive ? 'folder-opened' : 'folder');
        this.description = isActive ? '(active)' : '';
        this.command = {
            command: 'devcontext.selectProject',
            title: 'Select Project',
            arguments: [project.id]
        };
    }
}

class SnippetItem extends vscode.TreeItem {
    public snippet: Snippet;

    constructor(snippet: Snippet) {
        super(snippet.description || snippet.language, vscode.TreeItemCollapsibleState.None);
        this.snippet = snippet;
        this.contextValue = 'snippet';
        this.iconPath = new vscode.ThemeIcon('code');
        this.description = snippet.language;
        this.tooltip = new vscode.MarkdownString(`**${snippet.language}**\n\n\`\`\`${snippet.language}\n${snippet.code.substring(0, 200)}\n\`\`\``);
        this.command = {
            command: 'devcontext.openSnippetPreview',
            title: 'Preview',
            arguments: [this]
        };
    }
}

class KnowledgeItem extends vscode.TreeItem {
    public knowledge: Knowledge;

    constructor(knowledge: Knowledge) {
        super(knowledge.question, vscode.TreeItemCollapsibleState.None);
        this.knowledge = knowledge;
        this.contextValue = 'knowledge';
        this.iconPath = new vscode.ThemeIcon('book');
        this.description = knowledge.tags?.slice(0, 2).join(', ') || '';
        this.tooltip = new vscode.MarkdownString(`**Q:** ${knowledge.question}\n\n**A:** ${knowledge.answer.substring(0, 300)}...`);
    }
}

// Tree Data Providers
class ProjectsTreeDataProvider implements vscode.TreeDataProvider<ProjectItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ProjectItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ProjectItem): vscode.TreeItem {
        return element;
    }

    getChildren(): ProjectItem[] {
        const projects = contextData?.data?.projects || [];
        return projects.map(p => new ProjectItem(p, p.id === activeProjectId));
    }
}

class SnippetsTreeDataProvider implements vscode.TreeDataProvider<SnippetItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SnippetItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: SnippetItem): vscode.TreeItem {
        return element;
    }

    getChildren(): SnippetItem[] {
        const snippets = getActiveSnippets();
        return snippets
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(s => new SnippetItem(s));
    }
}

class KnowledgeTreeDataProvider implements vscode.TreeDataProvider<KnowledgeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<KnowledgeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: KnowledgeItem): vscode.TreeItem {
        return element;
    }

    getChildren(): KnowledgeItem[] {
        const knowledge = getActiveKnowledge();
        return knowledge
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(k => new KnowledgeItem(k));
    }
}

export function deactivate() {
    if (statusBarItem) {
        statusBarItem.dispose();
    }
    if (fileWatcher) {
        fileWatcher.dispose();
    }
}
