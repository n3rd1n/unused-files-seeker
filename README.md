# Unused Files Seeker

An npm package for finding unused files in JavaScript/TypeScript projects.

## Installation

```bash
npm install -g unused-files-seeker
```

## Usage

### CLI Commands

#### Scan project
```bash
unused-files-seeker scan
```

#### With custom options
```bash
unused-files-seeker scan --config ./my-config.json --project ./my-project
```

#### Create configuration file
```bash
unused-files-seeker init
```

### Configuration

Create an `unused-files-seeker.config.json` file in your project:

```json
{
  "entryPoint": "index.js",
  "scanFolder": "src",
  "ignorePaths": [
    "node_modules",
    "dist",
    "build",
    ".git",
    "coverage"
  ],
  "extensions": [
    ".js",
    ".ts",
    ".jsx",
    ".tsx"
  ]
}
```

#### Configuration Options

- `entryPoint` (optional): The entry point of your project. Default: `index.js`
- `scanFolder` (optional): The folder to be scanned. Default: `src`
- `ignorePaths` (optional): Array of paths to be ignored
- `extensions` (optional): Array of file extensions to be scanned

### Programming

```typescript
import { UnusedFilesSeeker, loadConfig } from 'unused-files-seeker';

const config = loadConfig('./my-config.json');
const seeker = new UnusedFilesSeeker(config, './my-project');

const result = await seeker.findUnusedFiles();
console.log(result.unusedFiles); // Array of unused files
```

## How it works

1. **File Collection**: The tool collects all files in the specified scan folder
2. **Entry Point**: Starts at the configured entry point (or `index.js`/`index.ts`)
3. **Import Analysis**: Analyzes all import statements in the files
4. **Dependency Graph**: Builds a graph of file dependencies
5. **Unused Files**: Identifies files that are not imported by other files

## Supported Import Formats

- ES6 Imports: `import ... from '...'`
- CommonJS: `require('...')`
- Dynamic Imports: `import('...')`
- TypeScript Triple-Slash Directives: `/// <reference path="..." />`

## Exit Codes

- `0`: No unused files found
- `1`: Unused files found or error occurred

## License

MIT
