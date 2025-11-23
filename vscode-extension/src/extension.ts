import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface DevContext {
    projectName?: string;
    summary?: string;
    files?: string[];
    dependencies?: string[];
    notes?: string;
    timestamp?: string;
    source?: string;
}

let statusBarItem: vscode.StatusBarItem;
let currentContext: DevContext | null = null;

export function activate(context: vscode.ExtensionContext) {
    console.log('DevContext Sync extension activated');

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'devcontext-sync.showContext';
    updateStatusBar();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Load any saved context from workspace state
    currentContext = context.workspaceState.get<DevContext>('devContext') || null;
    updateStatusBar();

    // Register Import Context command
    const importContextCmd = vscode.commands.registerCommand('devcontext-sync.importContext', async () => {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: 'Import Context',
            filters: {
                'JSON files': ['json']
            }
        };

        const fileUri = await vscode.window.showOpenDialog(options);
        if (fileUri && fileUri[0]) {
            try {
                const content = fs.readFileSync(fileUri[0].fsPath, 'utf8');
                const imported = JSON.parse(content) as DevContext;

                currentContext = {
                    ...imported,
                    timestamp: new Date().toISOString(),
                    source: 'chrome-extension'
                };

                // Save to workspace state
                await context.workspaceState.update('devContext', currentContext);

                // Write to .devcontext file for Cursor/Continue.dev compatibility
                await writeContextFile(currentContext);

                updateStatusBar();
                vscode.window.showInformationMessage(`DevContext imported: ${currentContext.projectName || 'Unnamed project'}`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to import context: ${error}`);
            }
        }
    });

    // Register Show Context command
    const showContextCmd = vscode.commands.registerCommand('devcontext-sync.showContext', async () => {
        if (!currentContext) {
            vscode.window.showInformationMessage('No context imported. Use "DevContext: Import Context" to import.');
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'devcontextView',
            'DevContext',
            vscode.ViewColumn.One,
            {}
        );

        panel.webview.html = getContextWebviewContent(currentContext);
    });

    // Register Clear Context command
    const clearContextCmd = vscode.commands.registerCommand('devcontext-sync.clearContext', async () => {
        currentContext = null;
        await context.workspaceState.update('devContext', null);
        updateStatusBar();
        vscode.window.showInformationMessage('DevContext cleared');
    });

    context.subscriptions.push(importContextCmd, showContextCmd, clearContextCmd);
}

function updateStatusBar() {
    if (currentContext && currentContext.projectName) {
        statusBarItem.text = `$(book) ${currentContext.projectName}`;
        statusBarItem.tooltip = 'Click to view DevContext';
    } else {
        statusBarItem.text = '$(book) No Context';
        statusBarItem.tooltip = 'Click to import DevContext';
    }
}

async function writeContextFile(ctx: DevContext): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;

    // Write .devcontext.json for general use
    const contextPath = path.join(rootPath, '.devcontext.json');
    fs.writeFileSync(contextPath, JSON.stringify(ctx, null, 2));

    // Write .cursorrules format for Cursor compatibility
    if (ctx.summary || ctx.notes) {
        const cursorContent = [
            '# Project Context (via DevContext Sync)',
            '',
            ctx.summary ? `## Summary\n${ctx.summary}` : '',
            ctx.notes ? `## Notes\n${ctx.notes}` : '',
            ctx.dependencies?.length ? `## Dependencies\n${ctx.dependencies.join(', ')}` : ''
        ].filter(Boolean).join('\n\n');

        const cursorPath = path.join(rootPath, '.cursorrules');
        // Only write if .cursorrules doesn't exist (don't overwrite user rules)
        if (!fs.existsSync(cursorPath)) {
            fs.writeFileSync(cursorPath, cursorContent);
        }
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getContextWebviewContent(ctx: DevContext): string {
    const safeProjectName = escapeHtml(ctx.projectName || 'Project Context');
    const safeSummary = ctx.summary ? escapeHtml(ctx.summary) : '';
    const safeNotes = ctx.notes ? escapeHtml(ctx.notes) : '';
    const safeFiles = ctx.files?.map(f => escapeHtml(f)) || [];
    const safeDeps = ctx.dependencies?.map(d => escapeHtml(d)) || [];
    const safeTimestamp = escapeHtml(ctx.timestamp || 'Unknown');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DevContext</title>
    <style>
        body { font-family: var(--vscode-font-family); padding: 20px; }
        h1 { color: var(--vscode-foreground); }
        .section { margin: 16px 0; }
        .label { font-weight: bold; color: var(--vscode-descriptionForeground); }
        .value { margin-top: 4px; }
        pre { background: var(--vscode-textBlockQuote-background); padding: 10px; overflow-x: auto; }
    </style>
</head>
<body>
    <h1>${safeProjectName}</h1>

    ${safeSummary ? `<div class="section"><div class="label">Summary</div><div class="value">${safeSummary}</div></div>` : ''}

    ${safeFiles.length ? `<div class="section"><div class="label">Files</div><pre>${safeFiles.join('\n')}</pre></div>` : ''}

    ${safeDeps.length ? `<div class="section"><div class="label">Dependencies</div><pre>${safeDeps.join('\n')}</pre></div>` : ''}

    ${safeNotes ? `<div class="section"><div class="label">Notes</div><div class="value">${safeNotes}</div></div>` : ''}

    <div class="section"><div class="label">Imported</div><div class="value">${safeTimestamp}</div></div>
</body>
</html>`;
}

export function deactivate() {
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}
