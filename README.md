# @n3rd1n/unused-files-seeker

[![CI](https://github.com/n3rd1n/unused-files-seeker/actions/workflows/ci.yml/badge.svg)](https://github.com/n3rd1n/unused-files-seeker/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@n3rd1n/unused-files-seeker)](https://www.npmjs.com/package/@n3rd1n/unused-files-seeker)
[![license](https://img.shields.io/npm/l/@n3rd1n/unused-files-seeker)](./LICENSE)

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
- ✅ Respects `baseUrl`, `paths` and `extends` from `tsconfig.json`
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

The tool reads the nearest `tsconfig.json` above your entry file and follows
its module resolution.

### baseUrl

```json
{ "compilerOptions": { "baseUrl": "src" } }
```

Absolute imports like `import { Button } from 'components/Button'` are
resolved correctly.

### paths

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@ui/*": ["./src/components/ui/*"]
    }
  }
}
```

Aliases such as `@/hooks/useAuth` resolve to the file they point at, so
alias-imported files are no longer reported as unused. Pattern precedence
follows TypeScript: an exact pattern beats a wildcard, and among wildcards the
longest prefix wins. Since TypeScript 4.1, `paths` also works without a
`baseUrl`, resolved relative to the config file.

### extends

`extends` is followed, including the array form from TypeScript 5.0 (later
entries win) and package names such as `@tsconfig/node20`. `baseUrl` and
`paths` are resolved relative to the file that declares them, matching
TypeScript. Circular `extends` chains are detected.

Config files may contain comments and trailing commas.

### Without a tsconfig

Bare specifiers are treated as package imports and are not resolved against
your source directory.

## Known Limitation

The scan directory is the directory of the entry file. With an entry like
`src/app/page.tsx`, only `src/app` is scanned — point the tool at an entry
higher up (e.g. `src/index.ts`) to cover the whole tree.

## Development

```bash
npm install
npm test        # builds, then runs the node:test suite
npm run format  # prettier
```

Tests live in `test/`, with one fixture project per behaviour in
`test/fixtures/`. `test/scan.test.js` covers the scanner API and
`test/cli.test.js` drives the built CLI as a child process.

### Releasing

Releases are published from CI with npm provenance. Bump the version,
push, then push a matching tag:

```bash
npm version minor          # or patch / major
git push && git push --tags
```

The release workflow verifies that the tag matches `package.json`,
runs the build and the test suite, and publishes to npm.

## License

[MIT](./LICENSE) © Nathanael Erdin
