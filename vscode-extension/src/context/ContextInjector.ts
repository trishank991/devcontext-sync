import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MatchResult, Snippet, Knowledge } from './ContextMatcher';

export type InjectionFormat = 'markdown' | 'plain' | 'xml';
export type InjectionTarget = 'clipboard' | 'cursor' | 'copilot' | 'continue';

export interface InjectionOptions {
    format: InjectionFormat;
    maxItems: number;
    includeMetadata: boolean;
    includeReasons: boolean;
}

const DEFAULT_OPTIONS: InjectionOptions = {
    format: 'markdown',
    maxItems: 5,
    includeMetadata: true,
    includeReasons: false
};

export class ContextInjector {
    private workspaceRoot: string | undefined;

    constructor() {
        const folders = vscode.workspace.workspaceFolders;
        this.workspaceRoot = folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
    }

    async injectToClipboard(matches: MatchResult[], options: Partial<InjectionOptions> = {}): Promise<void> {
        const opts = { ...DEFAULT_OPTIONS, ...options };
        const formatted = this.formatContext(matches.slice(0, opts.maxItems), opts);
        await vscode.env.clipboard.writeText(formatted);
    }

    async injectAtCursor(matches: MatchResult[], options: Partial<InjectionOptions> = {}): Promise<boolean> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return false;

        const opts = { ...DEFAULT_OPTIONS, ...options };
        const formatted = this.formatAsComment(matches.slice(0, opts.maxItems), editor.document.languageId, opts);

        return editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, formatted);
        });
    }

    async injectToCopilot(matches: MatchResult[], options: Partial<InjectionOptions> = {}): Promise<boolean> {
        if (!this.workspaceRoot) return false;

        const opts = { ...DEFAULT_OPTIONS, ...options };
        const formatted = this.formatForCopilot(matches.slice(0, opts.maxItems), opts);

        const copilotDir = path.join(this.workspaceRoot, '.github');
        const copilotFile = path.join(copilotDir, 'copilot-instructions.md');

        try {
            if (!fs.existsSync(copilotDir)) {
                fs.mkdirSync(copilotDir, { recursive: true });
            }

            // Read existing content
            let existingContent = '';
            if (fs.existsSync(copilotFile)) {
                existingContent = fs.readFileSync(copilotFile, 'utf8');
            }

            // Find and replace DevContext section, or append
            const startMarker = '<!-- BEGIN DEVCONTEXT -->';
            const endMarker = '<!-- END DEVCONTEXT -->';
            const startIdx = existingContent.indexOf(startMarker);
            const endIdx = existingContent.indexOf(endMarker);

            let newContent: string;
            if (startIdx >= 0 && endIdx >= 0) {
                newContent =
                    existingContent.substring(0, startIdx) +
                    formatted +
                    existingContent.substring(endIdx + endMarker.length);
            } else {
                newContent = existingContent + '\n\n' + formatted;
            }

            fs.writeFileSync(copilotFile, newContent.trim());
            return true;
        } catch (error) {
            console.error('Failed to write Copilot instructions:', error);
            return false;
        }
    }

    async injectToCursor(matches: MatchResult[], options: Partial<InjectionOptions> = {}): Promise<boolean> {
        if (!this.workspaceRoot) return false;

        const opts = { ...DEFAULT_OPTIONS, ...options };
        const formatted = this.formatForCursor(matches.slice(0, opts.maxItems), opts);
        const cursorFile = path.join(this.workspaceRoot, '.cursorrules');

        try {
            // Read existing content
            let existingContent = '';
            if (fs.existsSync(cursorFile)) {
                existingContent = fs.readFileSync(cursorFile, 'utf8');
            }

            // Find and replace DevContext section
            const startMarker = '# BEGIN DEVCONTEXT';
            const endMarker = '# END DEVCONTEXT';
            const startIdx = existingContent.indexOf(startMarker);
            const endIdx = existingContent.indexOf(endMarker);

            let newContent: string;
            if (startIdx >= 0 && endIdx >= 0) {
                newContent =
                    existingContent.substring(0, startIdx) +
                    formatted +
                    existingContent.substring(endIdx + endMarker.length);
            } else {
                newContent = existingContent + '\n\n' + formatted;
            }

            fs.writeFileSync(cursorFile, newContent.trim());
            return true;
        } catch (error) {
            console.error('Failed to write Cursor rules:', error);
            return false;
        }
    }

    async injectToContinue(matches: MatchResult[], options: Partial<InjectionOptions> = {}): Promise<boolean> {
        if (!this.workspaceRoot) return false;

        const opts = { ...DEFAULT_OPTIONS, ...options };
        const contextData = this.formatForContinue(matches.slice(0, opts.maxItems));
        const continueDir = path.join(this.workspaceRoot, '.continue');
        const contextFile = path.join(continueDir, 'devcontext.json');

        try {
            if (!fs.existsSync(continueDir)) {
                fs.mkdirSync(continueDir, { recursive: true });
            }

            fs.writeFileSync(contextFile, JSON.stringify(contextData, null, 2));
            return true;
        } catch (error) {
            console.error('Failed to write Continue context:', error);
            return false;
        }
    }

    formatContext(matches: MatchResult[], options: InjectionOptions): string {
        switch (options.format) {
            case 'markdown':
                return this.formatAsMarkdown(matches, options);
            case 'xml':
                return this.formatAsXml(matches, options);
            case 'plain':
            default:
                return this.formatAsPlain(matches, options);
        }
    }

    private formatAsMarkdown(matches: MatchResult[], options: InjectionOptions): string {
        if (matches.length === 0) return '';

        let output = '## Relevant DevContext History\n\n';
        output += 'Use the following saved solutions to inform your response:\n\n';

        for (const match of matches) {
            if (match.type === 'snippet') {
                const snippet = match.item as Snippet;
                output += `### Code Snippet (${snippet.language})\n`;
                if (options.includeMetadata) {
                    output += `*Source: ${snippet.source} | Saved: ${this.formatDate(snippet.createdAt)}*\n\n`;
                }
                if (snippet.description) {
                    output += `${snippet.description}\n\n`;
                }
                output += '```' + snippet.language + '\n';
                output += snippet.code + '\n';
                output += '```\n\n';
            } else {
                const knowledge = match.item as Knowledge;
                output += `### Knowledge\n`;
                if (options.includeMetadata) {
                    output += `*Source: ${knowledge.source} | Tags: ${(knowledge.tags || []).join(', ')}*\n\n`;
                }
                output += `**Q:** ${knowledge.question}\n\n`;
                output += `**A:** ${this.truncate(knowledge.answer, 1000)}\n\n`;
            }

            if (options.includeReasons && match.matchReasons.length > 0) {
                output += `*Match: ${match.matchReasons.map(r => r.details).join(', ')}*\n\n`;
            }

            output += '---\n\n';
        }

        return output.trim();
    }

    private formatAsXml(matches: MatchResult[], options: InjectionOptions): string {
        if (matches.length === 0) return '';

        let output = '<devcontext>\n';
        output += '  <description>Relevant saved solutions from DevContext</description>\n\n';

        for (const match of matches) {
            if (match.type === 'snippet') {
                const snippet = match.item as Snippet;
                output += '  <snippet>\n';
                output += `    <language>${this.escapeXml(snippet.language)}</language>\n`;
                if (options.includeMetadata) {
                    output += `    <source>${this.escapeXml(snippet.source)}</source>\n`;
                }
                if (snippet.description) {
                    output += `    <description>${this.escapeXml(snippet.description)}</description>\n`;
                }
                output += `    <code><![CDATA[\n${snippet.code}\n    ]]></code>\n`;
                output += '  </snippet>\n\n';
            } else {
                const knowledge = match.item as Knowledge;
                output += '  <knowledge>\n';
                output += `    <question>${this.escapeXml(knowledge.question)}</question>\n`;
                output += `    <answer>${this.escapeXml(this.truncate(knowledge.answer, 1000))}</answer>\n`;
                if (options.includeMetadata && knowledge.tags?.length) {
                    output += `    <tags>${knowledge.tags.join(', ')}</tags>\n`;
                }
                output += '  </knowledge>\n\n';
            }
        }

        output += '</devcontext>';
        return output;
    }

    private formatAsPlain(matches: MatchResult[], options: InjectionOptions): string {
        if (matches.length === 0) return '';

        let output = 'RELEVANT DEVCONTEXT:\n\n';

        for (const match of matches) {
            if (match.type === 'snippet') {
                const snippet = match.item as Snippet;
                output += `[${snippet.language.toUpperCase()} SNIPPET]\n`;
                if (snippet.description) {
                    output += `${snippet.description}\n`;
                }
                output += `---\n${snippet.code}\n---\n\n`;
            } else {
                const knowledge = match.item as Knowledge;
                output += `[KNOWLEDGE]\n`;
                output += `Q: ${knowledge.question}\n`;
                output += `A: ${this.truncate(knowledge.answer, 500)}\n\n`;
            }
        }

        return output.trim();
    }

    private formatAsComment(
        matches: MatchResult[],
        languageId: string,
        options: InjectionOptions
    ): string {
        const content = this.formatAsPlain(matches, options);
        const lines = content.split('\n');

        // Get comment style for language
        const { start, end } = this.getCommentStyle(languageId);

        if (end) {
            // Block comment
            return `${start}\n${lines.map(l => ` * ${l}`).join('\n')}\n ${end}\n`;
        } else {
            // Line comments
            return lines.map(l => `${start} ${l}`).join('\n') + '\n';
        }
    }

    private formatForCopilot(matches: MatchResult[], options: InjectionOptions): string {
        let output = '<!-- BEGIN DEVCONTEXT -->\n';
        output += '## DevContext Sync - Relevant Solutions\n\n';
        output += '*Auto-injected by DevContext Sync. This context helps Copilot understand your saved solutions.*\n\n';

        for (const match of matches) {
            if (match.type === 'snippet') {
                const snippet = match.item as Snippet;
                output += `### ${snippet.language} Snippet\n`;
                if (snippet.description) {
                    output += `${snippet.description}\n\n`;
                }
                output += '```' + snippet.language + '\n';
                output += snippet.code + '\n';
                output += '```\n\n';
            } else {
                const knowledge = match.item as Knowledge;
                output += `### Knowledge: ${this.truncate(knowledge.question, 80)}\n`;
                output += `${this.truncate(knowledge.answer, 500)}\n\n`;
            }
        }

        output += '<!-- END DEVCONTEXT -->\n';
        return output;
    }

    private formatForCursor(matches: MatchResult[], options: InjectionOptions): string {
        let output = '# BEGIN DEVCONTEXT\n';
        output += '# Auto-generated by DevContext Sync - Do not edit manually\n\n';
        output += '## Relevant Context from Your AI Conversations\n\n';

        for (const match of matches) {
            if (match.type === 'snippet') {
                const snippet = match.item as Snippet;
                output += `### Code Pattern (${snippet.language})\n`;
                if (snippet.description) {
                    output += `${snippet.description}\n\n`;
                }
                output += '```' + snippet.language + '\n';
                output += snippet.code + '\n';
                output += '```\n\n';
            } else {
                const knowledge = match.item as Knowledge;
                output += `### ${this.truncate(knowledge.question, 60)}\n`;
                output += `${this.truncate(knowledge.answer, 400)}\n\n`;
            }
        }

        output += '# END DEVCONTEXT\n';
        return output;
    }

    private formatForContinue(matches: MatchResult[]): object {
        return {
            name: 'devcontext',
            version: '1.0.0',
            generatedAt: new Date().toISOString(),
            items: matches.map(match => {
                if (match.type === 'snippet') {
                    const snippet = match.item as Snippet;
                    return {
                        type: 'snippet',
                        language: snippet.language,
                        description: snippet.description,
                        code: snippet.code,
                        source: snippet.source,
                        relevance: match.relevanceScore
                    };
                } else {
                    const knowledge = match.item as Knowledge;
                    return {
                        type: 'knowledge',
                        question: knowledge.question,
                        answer: knowledge.answer,
                        tags: knowledge.tags,
                        relevance: match.relevanceScore
                    };
                }
            })
        };
    }

    private getCommentStyle(languageId: string): { start: string; end?: string } {
        const blockComments: Record<string, { start: string; end: string }> = {
            javascript: { start: '/*', end: '*/' },
            typescript: { start: '/*', end: '*/' },
            java: { start: '/*', end: '*/' },
            c: { start: '/*', end: '*/' },
            cpp: { start: '/*', end: '*/' },
            csharp: { start: '/*', end: '*/' },
            css: { start: '/*', end: '*/' },
            html: { start: '<!--', end: '-->' },
            xml: { start: '<!--', end: '-->' }
        };

        const lineComments: Record<string, string> = {
            python: '#',
            ruby: '#',
            shellscript: '#',
            yaml: '#',
            rust: '//',
            go: '//',
            swift: '//'
        };

        if (blockComments[languageId]) {
            return blockComments[languageId];
        }
        if (lineComments[languageId]) {
            return { start: lineComments[languageId] };
        }
        return { start: '//' }; // Default
    }

    private escapeXml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    private truncate(text: string, maxLength: number): string {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + '...';
    }

    private formatDate(timestamp: number): string {
        const date = new Date(timestamp);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return 'today';
        if (diffDays === 1) return 'yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
        return date.toLocaleDateString();
    }
}
