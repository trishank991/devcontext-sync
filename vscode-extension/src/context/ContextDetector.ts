import * as vscode from 'vscode';

// Language alias mapping for cross-reference with saved content
const LANGUAGE_ALIASES: Record<string, string[]> = {
    javascript: ['js', 'node', 'nodejs', 'es6', 'ecmascript'],
    typescript: ['ts', 'tsx'],
    typescriptreact: ['tsx', 'react-typescript'],
    javascriptreact: ['jsx', 'react'],
    python: ['py', 'python3', 'django', 'flask'],
    rust: ['rs'],
    go: ['golang'],
    java: ['spring', 'springboot'],
    csharp: ['cs', 'dotnet', '.net'],
    ruby: ['rb', 'rails'],
    php: ['laravel', 'wordpress'],
    sql: ['mysql', 'postgres', 'postgresql', 'sqlite'],
    html: ['htm', 'markup'],
    css: ['scss', 'sass', 'less'],
    shellscript: ['bash', 'sh', 'shell', 'zsh'],
    yaml: ['yml'],
    json: ['jsonc'],
    markdown: ['md']
};

export interface DiagnosticContext {
    message: string;
    severity: vscode.DiagnosticSeverity;
    code?: string | number;
    source?: string;
    range: vscode.Range;
    relatedCode?: string;
}

export interface EditorContext {
    // File info
    language: string;
    languageAliases: string[];
    fileName: string;
    filePath: string;
    workspaceName?: string;

    // Current position
    selection?: string;
    cursorPosition: vscode.Position;
    lineContent: string;

    // Code context
    currentFunction?: string;
    currentClass?: string;
    imports: string[];

    // Error context (highest priority for matching)
    diagnostics: DiagnosticContext[];

    // Framework detection
    frameworks: string[];
}

export class ContextDetector {

    async detectContext(editor: vscode.TextEditor): Promise<EditorContext> {
        const document = editor.document;
        const diagnostics = vscode.languages.getDiagnostics(document.uri);
        const symbols = await this.getDocumentSymbols(document);

        return {
            language: document.languageId,
            languageAliases: this.getLanguageAliases(document.languageId),
            fileName: this.getFileName(document.fileName),
            filePath: document.fileName,
            workspaceName: vscode.workspace.name,
            selection: this.getSelection(editor),
            cursorPosition: editor.selection.active,
            lineContent: document.lineAt(editor.selection.active.line).text,
            currentFunction: this.getCurrentFunction(symbols, editor.selection.active),
            currentClass: this.getCurrentClass(symbols, editor.selection.active),
            imports: this.extractImports(document),
            diagnostics: this.mapDiagnostics(diagnostics, document),
            frameworks: this.detectFrameworks(document)
        };
    }

    private getLanguageAliases(languageId: string): string[] {
        const aliases = LANGUAGE_ALIASES[languageId] || [];
        return [languageId, ...aliases];
    }

    private getFileName(filePath: string): string {
        const parts = filePath.split(/[/\\]/);
        return parts[parts.length - 1] || filePath;
    }

    private getSelection(editor: vscode.TextEditor): string | undefined {
        if (editor.selection.isEmpty) {
            return undefined;
        }
        return editor.document.getText(editor.selection);
    }

    private async getDocumentSymbols(document: vscode.TextDocument): Promise<vscode.DocumentSymbol[]> {
        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                document.uri
            );
            return symbols || [];
        } catch {
            return [];
        }
    }

    private getCurrentFunction(symbols: vscode.DocumentSymbol[], position: vscode.Position): string | undefined {
        const functionSymbol = this.findSymbolAtPosition(
            symbols,
            position,
            [vscode.SymbolKind.Function, vscode.SymbolKind.Method]
        );
        return functionSymbol?.name;
    }

    private getCurrentClass(symbols: vscode.DocumentSymbol[], position: vscode.Position): string | undefined {
        const classSymbol = this.findSymbolAtPosition(
            symbols,
            position,
            [vscode.SymbolKind.Class, vscode.SymbolKind.Interface]
        );
        return classSymbol?.name;
    }

    private findSymbolAtPosition(
        symbols: vscode.DocumentSymbol[],
        position: vscode.Position,
        kinds: vscode.SymbolKind[]
    ): vscode.DocumentSymbol | undefined {
        for (const symbol of symbols) {
            if (symbol.range.contains(position)) {
                // Check children first (more specific)
                const childMatch = this.findSymbolAtPosition(symbol.children, position, kinds);
                if (childMatch) {
                    return childMatch;
                }
                // Then check this symbol
                if (kinds.includes(symbol.kind)) {
                    return symbol;
                }
            }
        }
        return undefined;
    }

    private extractImports(document: vscode.TextDocument): string[] {
        const text = document.getText();
        const imports: string[] = [];

        // JavaScript/TypeScript imports
        const jsImportRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
        let match;
        while ((match = jsImportRegex.exec(text)) !== null) {
            imports.push(match[1]);
        }

        // CommonJS requires
        const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
        while ((match = requireRegex.exec(text)) !== null) {
            imports.push(match[1]);
        }

        // Python imports
        const pythonFromImport = /^from\s+(\S+)\s+import/gm;
        while ((match = pythonFromImport.exec(text)) !== null) {
            imports.push(match[1]);
        }
        const pythonImport = /^import\s+(\S+)/gm;
        while ((match = pythonImport.exec(text)) !== null) {
            imports.push(match[1].split(',')[0].trim());
        }

        // Go imports
        const goImport = /import\s+(?:\(\s*)?["']([^"']+)["']/g;
        while ((match = goImport.exec(text)) !== null) {
            imports.push(match[1]);
        }

        // Rust use statements
        const rustUse = /use\s+([^;{]+)/g;
        while ((match = rustUse.exec(text)) !== null) {
            imports.push(match[1].split('::')[0].trim());
        }

        return [...new Set(imports)]; // Deduplicate
    }

    private mapDiagnostics(
        diagnostics: readonly vscode.Diagnostic[],
        document: vscode.TextDocument
    ): DiagnosticContext[] {
        return diagnostics
            .filter(d => d.severity === vscode.DiagnosticSeverity.Error ||
                        d.severity === vscode.DiagnosticSeverity.Warning)
            .slice(0, 10) // Limit to 10 most relevant
            .map(d => ({
                message: d.message,
                severity: d.severity,
                code: typeof d.code === 'object' ? d.code.value : d.code,
                source: d.source,
                range: d.range,
                relatedCode: this.getCodeAroundRange(document, d.range)
            }));
    }

    private getCodeAroundRange(document: vscode.TextDocument, range: vscode.Range): string {
        const startLine = Math.max(0, range.start.line - 1);
        const endLine = Math.min(document.lineCount - 1, range.end.line + 1);

        const lines: string[] = [];
        for (let i = startLine; i <= endLine; i++) {
            lines.push(document.lineAt(i).text);
        }
        return lines.join('\n');
    }

    private detectFrameworks(document: vscode.TextDocument): string[] {
        const text = document.getText();
        const frameworks: string[] = [];

        const frameworkPatterns: [RegExp, string][] = [
            [/\bReact\b|from\s+['"]react['"]|useEffect|useState|jsx/i, 'react'],
            [/from\s+['"]next['"]|getServerSideProps|getStaticProps/i, 'nextjs'],
            [/from\s+['"]vue['"]|createApp|defineComponent/i, 'vue'],
            [/from\s+['"]@angular|@Component|@Injectable/i, 'angular'],
            [/from\s+['"]express['"]|app\.get\s*\(|app\.post\s*\(/i, 'express'],
            [/from\s+['"]fastapi['"]|@app\.get|@app\.post/i, 'fastapi'],
            [/from\s+django|from\s+rest_framework/i, 'django'],
            [/from\s+flask|@app\.route/i, 'flask'],
            [/fn\s+main\s*\(\)|use\s+std::/i, 'rust'],
            [/func\s+main\s*\(\)|package\s+main/i, 'go'],
            [/import\s+pandas|import\s+numpy/i, 'data-science'],
            [/from\s+['"]@testing-library|describe\s*\(|it\s*\(|test\s*\(/i, 'testing'],
        ];

        for (const [pattern, framework] of frameworkPatterns) {
            if (pattern.test(text)) {
                frameworks.push(framework);
            }
        }

        return frameworks;
    }
}
