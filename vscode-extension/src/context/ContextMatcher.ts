import { EditorContext, DiagnosticContext } from './ContextDetector';

// Match weights for relevance scoring
const MATCH_WEIGHTS = {
    error_exact: 100,
    error_fuzzy: 80,
    language_exact: 30,
    tag_match: 25,
    import_match: 20,
    framework_match: 15,
    text_similarity: 10,
    recency_bonus: 5
};

export interface Snippet {
    id: string;
    projectId: string;
    code: string;
    language: string;
    description: string;
    source: string;
    createdAt: number;
}

export interface Knowledge {
    id: string;
    projectId: string;
    question: string;
    answer: string;
    source: string;
    tags: string[];
    createdAt: number;
}

export interface MatchReason {
    type: 'error_match' | 'language_match' | 'tag_match' | 'import_match' | 'framework_match' | 'text_similarity';
    confidence: number;
    details: string;
}

export interface MatchResult {
    item: Snippet | Knowledge;
    type: 'snippet' | 'knowledge';
    relevanceScore: number;
    matchReasons: MatchReason[];
}

export class ContextMatcher {
    private readonly SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    async findRelevantContext(
        editorContext: EditorContext,
        snippets: Snippet[],
        knowledge: Knowledge[],
        options: { maxResults?: number; minScore?: number } = {}
    ): Promise<MatchResult[]> {
        const { maxResults = 10, minScore = 15 } = options;
        const results: MatchResult[] = [];

        // Priority 1: Error message matching
        if (editorContext.diagnostics.length > 0) {
            for (const diagnostic of editorContext.diagnostics) {
                const errorMatches = this.matchAgainstError(diagnostic, snippets, knowledge);
                results.push(...errorMatches);
            }
        }

        // Priority 2: Language matching
        const languageMatches = this.matchByLanguage(
            editorContext.language,
            editorContext.languageAliases,
            snippets,
            knowledge
        );
        results.push(...languageMatches);

        // Priority 3: Import/framework matching
        const importMatches = this.matchByImports(editorContext.imports, snippets, knowledge);
        results.push(...importMatches);

        const frameworkMatches = this.matchByFrameworks(editorContext.frameworks, snippets, knowledge);
        results.push(...frameworkMatches);

        // Priority 4: Text similarity (if we have selection or line content)
        if (editorContext.selection || editorContext.lineContent) {
            const textQuery = editorContext.selection || editorContext.lineContent;
            const textMatches = this.matchByTextSimilarity(textQuery, snippets, knowledge);
            results.push(...textMatches);
        }

        // Deduplicate, sort by score, and filter
        const deduped = this.deduplicateAndSort(results);
        return deduped
            .filter(r => r.relevanceScore >= minScore)
            .slice(0, maxResults);
    }

    private matchAgainstError(
        diagnostic: DiagnosticContext,
        snippets: Snippet[],
        knowledge: Knowledge[]
    ): MatchResult[] {
        const results: MatchResult[] = [];
        const errorText = diagnostic.message.toLowerCase();
        const errorWords = this.tokenize(errorText);

        // Match against knowledge (Q&A format is ideal for error solutions)
        for (const item of knowledge) {
            const questionSimilarity = this.calculateJaccardSimilarity(
                errorWords,
                this.tokenize(item.question.toLowerCase())
            );

            const answerContainsError = item.answer.toLowerCase().includes(
                errorText.substring(0, Math.min(50, errorText.length))
            );

            // Check if tags indicate error-related content
            const hasErrorTag = item.tags?.some(t =>
                ['error', 'fix', 'bug', 'solution', 'debug'].includes(t.toLowerCase())
            );

            if (questionSimilarity > 0.2 || answerContainsError || (hasErrorTag && questionSimilarity > 0.1)) {
                const score =
                    (questionSimilarity * MATCH_WEIGHTS.error_fuzzy) +
                    (answerContainsError ? MATCH_WEIGHTS.error_exact : 0) +
                    (hasErrorTag ? 10 : 0);

                if (score > 10) {
                    results.push({
                        item,
                        type: 'knowledge',
                        relevanceScore: score,
                        matchReasons: [{
                            type: 'error_match',
                            confidence: questionSimilarity,
                            details: `Matches error: "${diagnostic.message.substring(0, 50)}..."`
                        }]
                    });
                }
            }
        }

        // Match against snippets (check description and code comments)
        for (const item of snippets) {
            const descSimilarity = this.calculateJaccardSimilarity(
                errorWords,
                this.tokenize((item.description || '').toLowerCase())
            );

            // Check for error-related keywords in description
            const hasErrorKeyword = /fix|error|bug|issue|solve|resolve/i.test(item.description || '');

            if (descSimilarity > 0.2 || (hasErrorKeyword && descSimilarity > 0.1)) {
                const score =
                    (descSimilarity * MATCH_WEIGHTS.error_fuzzy) +
                    (hasErrorKeyword ? 15 : 0);

                if (score > 10) {
                    results.push({
                        item,
                        type: 'snippet',
                        relevanceScore: score,
                        matchReasons: [{
                            type: 'error_match',
                            confidence: descSimilarity,
                            details: `May fix: "${diagnostic.message.substring(0, 50)}..."`
                        }]
                    });
                }
            }
        }

        return results;
    }

    private matchByLanguage(
        language: string,
        aliases: string[],
        snippets: Snippet[],
        knowledge: Knowledge[]
    ): MatchResult[] {
        const results: MatchResult[] = [];
        const langSet = new Set(aliases.map(a => a.toLowerCase()));

        for (const snippet of snippets) {
            if (langSet.has(snippet.language.toLowerCase())) {
                results.push({
                    item: snippet,
                    type: 'snippet',
                    relevanceScore: MATCH_WEIGHTS.language_exact + this.getRecencyBonus(snippet.createdAt),
                    matchReasons: [{
                        type: 'language_match',
                        confidence: 1.0,
                        details: `Same language: ${snippet.language}`
                    }]
                });
            }
        }

        // Check knowledge tags for language matches
        for (const item of knowledge) {
            const matchingTags = (item.tags || []).filter(t => langSet.has(t.toLowerCase()));
            if (matchingTags.length > 0) {
                results.push({
                    item,
                    type: 'knowledge',
                    relevanceScore: MATCH_WEIGHTS.tag_match + this.getRecencyBonus(item.createdAt),
                    matchReasons: [{
                        type: 'language_match',
                        confidence: 0.8,
                        details: `Tagged with: ${matchingTags.join(', ')}`
                    }]
                });
            }
        }

        return results;
    }

    private matchByImports(
        imports: string[],
        snippets: Snippet[],
        knowledge: Knowledge[]
    ): MatchResult[] {
        if (imports.length === 0) return [];

        const results: MatchResult[] = [];
        const importSet = new Set(imports.map(i => this.normalizeImport(i)));

        for (const snippet of snippets) {
            // Check if snippet code contains any of the imports
            const codeImports = this.extractCodeImports(snippet.code);
            const matches = codeImports.filter(i => importSet.has(this.normalizeImport(i)));

            if (matches.length > 0) {
                results.push({
                    item: snippet,
                    type: 'snippet',
                    relevanceScore: MATCH_WEIGHTS.import_match * matches.length,
                    matchReasons: [{
                        type: 'import_match',
                        confidence: matches.length / imports.length,
                        details: `Uses: ${matches.slice(0, 3).join(', ')}`
                    }]
                });
            }
        }

        // Check knowledge for import mentions in Q/A
        for (const item of knowledge) {
            const text = `${item.question} ${item.answer}`.toLowerCase();
            const matches = imports.filter(i => text.includes(this.normalizeImport(i)));

            if (matches.length > 0) {
                results.push({
                    item,
                    type: 'knowledge',
                    relevanceScore: MATCH_WEIGHTS.import_match * matches.length,
                    matchReasons: [{
                        type: 'import_match',
                        confidence: matches.length / imports.length,
                        details: `Discusses: ${matches.slice(0, 3).join(', ')}`
                    }]
                });
            }
        }

        return results;
    }

    private matchByFrameworks(
        frameworks: string[],
        snippets: Snippet[],
        knowledge: Knowledge[]
    ): MatchResult[] {
        if (frameworks.length === 0) return [];

        const results: MatchResult[] = [];
        const frameworkSet = new Set(frameworks.map(f => f.toLowerCase()));

        for (const item of knowledge) {
            const matchingTags = (item.tags || []).filter(t => frameworkSet.has(t.toLowerCase()));
            if (matchingTags.length > 0) {
                results.push({
                    item,
                    type: 'knowledge',
                    relevanceScore: MATCH_WEIGHTS.framework_match * matchingTags.length,
                    matchReasons: [{
                        type: 'framework_match',
                        confidence: matchingTags.length / frameworks.length,
                        details: `Framework: ${matchingTags.join(', ')}`
                    }]
                });
            }
        }

        return results;
    }

    private matchByTextSimilarity(
        query: string,
        snippets: Snippet[],
        knowledge: Knowledge[]
    ): MatchResult[] {
        const results: MatchResult[] = [];
        const queryWords = this.tokenize(query.toLowerCase());

        if (queryWords.length < 2) return results;

        for (const snippet of snippets) {
            const textToMatch = `${snippet.description || ''} ${snippet.code}`.toLowerCase();
            const targetWords = this.tokenize(textToMatch);
            const similarity = this.calculateJaccardSimilarity(queryWords, targetWords);

            if (similarity > 0.1) {
                results.push({
                    item: snippet,
                    type: 'snippet',
                    relevanceScore: similarity * MATCH_WEIGHTS.text_similarity * 10,
                    matchReasons: [{
                        type: 'text_similarity',
                        confidence: similarity,
                        details: `${Math.round(similarity * 100)}% text match`
                    }]
                });
            }
        }

        for (const item of knowledge) {
            const textToMatch = `${item.question} ${item.answer}`.toLowerCase();
            const targetWords = this.tokenize(textToMatch);
            const similarity = this.calculateJaccardSimilarity(queryWords, targetWords);

            if (similarity > 0.1) {
                results.push({
                    item,
                    type: 'knowledge',
                    relevanceScore: similarity * MATCH_WEIGHTS.text_similarity * 10,
                    matchReasons: [{
                        type: 'text_similarity',
                        confidence: similarity,
                        details: `${Math.round(similarity * 100)}% text match`
                    }]
                });
            }
        }

        return results;
    }

    private tokenize(text: string): string[] {
        return text
            .split(/\W+/)
            .filter(word => word.length > 2)
            .map(word => word.toLowerCase());
    }

    private calculateJaccardSimilarity(set1: string[], set2: string[]): number {
        const a = new Set(set1);
        const b = new Set(set2);

        const intersection = [...a].filter(x => b.has(x)).length;
        const union = new Set([...a, ...b]).size;

        return union === 0 ? 0 : intersection / union;
    }

    private normalizeImport(importPath: string): string {
        // Extract package name from import path
        // e.g., "react-dom/client" -> "react-dom"
        // e.g., "@testing-library/react" -> "@testing-library/react"
        return importPath.split('/')[0].toLowerCase();
    }

    private extractCodeImports(code: string): string[] {
        const imports: string[] = [];

        // JS/TS imports
        const jsMatch = code.matchAll(/(?:import|from)\s+['"]([^'"]+)['"]/g);
        for (const match of jsMatch) {
            imports.push(match[1]);
        }

        // Requires
        const reqMatch = code.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
        for (const match of reqMatch) {
            imports.push(match[1]);
        }

        return imports;
    }

    private getRecencyBonus(createdAt: number): number {
        const age = Date.now() - createdAt;
        if (age < this.SEVEN_DAYS_MS) {
            return MATCH_WEIGHTS.recency_bonus;
        }
        return 0;
    }

    private deduplicateAndSort(results: MatchResult[]): MatchResult[] {
        const seen = new Map<string, MatchResult>();

        for (const result of results) {
            const key = `${result.type}:${result.item.id}`;
            const existing = seen.get(key);

            if (!existing || result.relevanceScore > existing.relevanceScore) {
                // Merge reasons if we're updating
                if (existing) {
                    result.matchReasons = [...existing.matchReasons, ...result.matchReasons];
                    result.relevanceScore = Math.max(result.relevanceScore, existing.relevanceScore);
                }
                seen.set(key, result);
            }
        }

        return Array.from(seen.values())
            .sort((a, b) => b.relevanceScore - a.relevanceScore);
    }
}
