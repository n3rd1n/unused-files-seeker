# @n3rd1n/unused-files-seeker

🔍 Find unused files in your TypeScript/JavaScript project.

## Installation

```bash
npx @n3rd1n/unused-files-seeker <entry-file>
```

Or install globally:

```bash
npm install -g @n3rd1n/unused-files-seeker
```

## Usage

```bash
# Scan from an entry file
npx @n3rd1n/unused-files-seeker src/App.tsx

# Delete unused files directly
npx @n3rd1n/unused-files-seeker src/App.tsx --delete
```

## Example Output

```
🔍 Scanning from: src/App.tsx

📊 Statistics:
   All files:      42
   Used files:     38
   Unused:         4

📋 Unused files:
   - src/components/OldButton.tsx
   - src/utils/deprecated.ts
   - src/hooks/useUnused.ts
   - src/types/legacy.ts

💡 Tip: Use --delete to remove these files.
```

## Features

- ✅ Recursive scanning from the entry file
- ✅ Respects `baseUrl` from `tsconfig.json`
- ✅ Supports `.ts`, `.tsx`, `.js`, `.jsx` files
- ✅ Ignores `node_modules` and hidden folders
- ✅ `--delete` flag for direct removal

## How It Works

1. Starts at the specified entry file (e.g. `src/App.tsx`)
2. Analyzes all imports recursively using tree-sitter
3. Collects all files in the directory
4. Compares: Which files are not imported?
5. Outputs unused files (or deletes them with `--delete`)

## tsconfig.json Support

The tool respects the `baseUrl` from your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "baseUrl": "src"
  }
}
```

This way, absolute imports like `import { Button } from 'components/Button'` are resolved correctly.

## License

MIT
