# DevContext Sync - VS Code Extension

Sync AI context between your browser and IDE. This extension receives context exported from the DevContext Sync Chrome extension.

## Features

- **Import Context**: Load project context from JSON files exported by the Chrome extension
- **Show Context**: View current project context in a formatted panel
- **Clear Context**: Remove imported context from workspace
- **Status Bar**: Quick indicator showing current context status
- **Cursor/Continue.dev Compatible**: Automatically writes `.devcontext.json` and `.cursorrules` files

## Installation

### From VSIX (Development)

1. Build the extension:
   ```bash
   cd vscode-extension
   npm install
   npm run compile
   ```

2. Package:
   ```bash
   npx vsce package
   ```

3. Install the generated `.vsix` file:
   - Open VS Code
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
   - Run "Extensions: Install from VSIX..."
   - Select the `.vsix` file

### From Marketplace (Coming Soon)

Search for "DevContext Sync" in the VS Code Extensions marketplace.

## Usage

### With Chrome Extension

1. Use the DevContext Sync Chrome extension to gather context from documentation, GitHub, or other sources
2. Export the context as JSON from the Chrome extension
3. In VS Code, run "DevContext: Import Context" (`Ctrl+Shift+P`)
4. Select the exported JSON file
5. Context is now available in your workspace

### Commands

| Command | Description |
|---------|-------------|
| `DevContext: Import Context` | Import context from a JSON file |
| `DevContext: Show Context` | Display current context in a panel |
| `DevContext: Clear Context` | Remove current context |

### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `devcontextSync.contextFilePath` | Path to context JSON file | `""` |
| `devcontextSync.autoImport` | Auto-import when file changes | `false` |

## Context File Format

The extension expects JSON files with this structure:

```json
{
  "projectName": "My Project",
  "summary": "Brief description of the project",
  "files": ["src/index.ts", "src/utils.ts"],
  "dependencies": ["react", "typescript"],
  "notes": "Additional context or instructions"
}
```

## Integration with AI Tools

### Cursor

The extension writes a `.cursorrules` file in your workspace root containing the imported context summary and notes. Cursor automatically reads this file.

### Continue.dev

The extension writes a `.devcontext.json` file that can be referenced in your Continue configuration.

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes
npm run watch

# Lint
npm run lint
```

## License

MIT
