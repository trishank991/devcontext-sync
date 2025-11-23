# Changelog

All notable changes to DevContext Sync will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-11-23

### Added

#### Core Features
- Project-based context management with isolated workspaces
- Code snippet library with one-click save from AI conversations
- Full-text search across all saved contexts and snippets
- Tag-based organization system for contexts and snippets

#### Browser Extension
- ChatGPT (chat.openai.com) integration
- Claude (claude.ai) integration
- Floating save button on AI conversation pages
- Extension popup with quick access to recent snippets
- Project switcher in popup interface
- Keyboard shortcuts for common actions

#### IDE Integration
- Visual Studio Code extension
- Cursor editor extension
- Sidebar panel showing project contexts
- Snippet insertion via command palette
- Automatic sync with browser extension
- Offline access to local snippet cache

#### Sync and Storage
- Real-time sync between browser and IDE
- Local caching for offline access
- Automatic conflict resolution
- Background sync with retry logic

#### Export and Import
- Export contexts to Markdown format
- Export snippets to JSON format
- Bulk export of entire projects
- Import from JSON backup files

#### Account and Billing
- Free tier with 2 projects and 50 snippets
- Pro tier with unlimited projects and snippets
- Team tier with shared contexts and knowledge base
- Secure authentication with email verification
- Stripe integration for subscription management

#### Security
- End-to-end encryption for all stored data
- TLS 1.3 for all data in transit
- AES-256 encryption for data at rest
- No collection of browsing history
- Minimal permission requests

### Technical Details

- Chrome extension Manifest V3 compliant
- VS Code extension API v1.60+ compatible
- Cursor extension support via VS Code compatibility layer
- IndexedDB for local storage
- WebSocket connection for real-time sync

### Known Limitations

- Gemini and Perplexity support not yet available
- JetBrains IDE support in development
- Maximum snippet size of 100KB
- Search limited to text content (no semantic search yet)

---

## Roadmap

### Planned for v1.1.0
- Gemini (gemini.google.com) support
- Perplexity (perplexity.ai) support
- Improved search with filters
- Snippet syntax highlighting by language

### Planned for v1.2.0
- JetBrains IDE plugin (IntelliJ, WebStorm, PyCharm)
- Semantic search powered by embeddings
- Context templates for common project types
- API access for Pro and Team tiers

### Under Consideration
- Self-hosted deployment option
- GitHub integration for context from repositories
- Slack integration for team notifications
- Mobile companion app for viewing snippets

---

For feature requests and bug reports, please contact support@devcontextsync.com or open an issue on our GitHub repository.
