# @n3rd1n/unused-files-seeker

🔍 Find unused files in your TypeScript/JavaScript project.

## Requirements

Node.js `^20.19.0 || >=22.12.0`.

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

# Delete unused files (asks for confirmation)
npx @n3rd1n/unused-files-seeker src/App.tsx --delete

# Delete without the prompt (for scripts)
npx @n3rd1n/unused-files-seeker src/App.tsx --delete --yes

# Machine-readable report
npx @n3rd1n/unused-files-seeker src/App.tsx --json > report.json

# Fail the build when unused files remain
npx @n3rd1n/unused-files-seeker src/App.tsx --fail-on-found
```

## Options

| Option | Description |
| --- | --- |
| `--delete` | Delete unused files. Asks for confirmation. |
| `-y`, `--yes` | Skip the confirmation prompt for `--delete`. |
| `--json` | Print the result as JSON (absolute paths) on stdout. |
| `--fail-on-found` | Exit with code 1 when unused files remain. |
| `--ignore <path>` | Ignore a file or folder. Can be used multiple times. |
| `-h`, `--help` | Show help. |
| `-v`, `--version` | Show the version. |

`--delete` never removes anything unconfirmed: in an interactive shell it
prompts, and in a non-interactive one it refuses unless `--yes` is passed.

## Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Error, or unused files remain while `--fail-on-found` is set |

## CI Example

```yaml
- run: npx @n3rd1n/unused-files-seeker src/index.ts --fail-on-found
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
- ✅ Follows `import`, `export ... from`, dynamic `import()` and `require()`
- ✅ Respects `baseUrl` from `tsconfig.json`
- ✅ Supports `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`
- ✅ Ignores `node_modules` and hidden folders
- ✅ Test files and `.d.ts` files are never deletion candidates
- ✅ `--delete` flag with a confirmation guard
- ✅ `--json` output and CI-friendly exit codes

## How It Works

1. Starts at the specified entry file (e.g. `src/App.tsx`)
2. Analyzes all imports recursively using [oxc](https://oxc.rs) — including re-exports
   (`export { x } from './x'`), dynamic `import()` and `require()`
3. Collects all files in the directory
4. Compares: Which files are not imported?
5. Outputs unused files (or deletes them with `--delete`)

### Extra entry points

Test files (`*.test.*`, `*.spec.*`) and declaration files (`*.d.ts`) are traversed
as additional entry points, but are never reported as unused. This way a helper
that is only imported by a test is correctly recognised as used, and an ambient
`global.d.ts` is never proposed for deletion.

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

Without a `baseUrl`, bare specifiers are treated as package imports and are not
resolved against your source directory.

## License

MIT
