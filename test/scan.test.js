const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const { scanUnusedFiles, deleteFiles } = require('../dist/index.js')

const FIXTURES = path.join(__dirname, 'fixtures')

function fixture(name, ...rest) {
	return path.join(FIXTURES, name, ...rest)
}

/** Scan a fixture and return unused files relative to the fixture root, sorted. */
function unusedIn(name, options, subDir = '') {
	const root = path.join(fixture(name), subDir)
	const result = scanUnusedFiles(path.join(root, 'App.ts'), options)
	return result.unusedFiles.map((f) => path.relative(root, f)).sort()
}

function relative(root, files) {
	return [...files].map((f) => path.relative(root, f)).sort()
}

test('re-exports (barrel files) count as usage', () => {
	assert.deepStrictEqual(unusedIn('barrel'), ['orphan.ts'])
})

test('dynamic import() and require() count as usage', () => {
	// member-only.ts is referenced solely via foo.require(...), which is not a
	// module load, so it stays unused on purpose.
	assert.deepStrictEqual(unusedIn('dynamic'), [
		'member-only.ts',
		'orphan.ts',
	])
})

test('circular imports terminate and resolve', () => {
	assert.deepStrictEqual(unusedIn('cycle'), ['orphan.ts'])
})

test('files imported only by tests are not reported as unused', () => {
	const root = fixture('tests-traversal')
	const result = scanUnusedFiles(path.join(root, 'App.ts'))

	assert.deepStrictEqual(
		result.unusedFiles.map((f) => path.relative(root, f)),
		['orphan.ts']
	)
	// The test file itself is an extra entry point, never a deletion candidate.
	assert.deepStrictEqual(relative(root, result.extraEntryFiles), [
		'App.test.ts',
	])
	assert.ok(!relative(root, result.allFiles).includes('App.test.ts'))
})

test('declaration files are traversed but never reported as unused', () => {
	const root = fixture('declarations')
	const result = scanUnusedFiles(path.join(root, 'App.ts'))

	assert.deepStrictEqual(
		result.unusedFiles.map((f) => path.relative(root, f)),
		['orphan.ts']
	)
	assert.ok(relative(root, result.extraEntryFiles).includes('global.d.ts'))
})

test('tsconfig baseUrl resolves absolute imports', () => {
	assert.deepStrictEqual(unusedIn('baseurl'), ['orphan.ts'])
})

test('without baseUrl, bare specifiers are not resolved against the scan dir', () => {
	// 'shadow/y' is a package specifier here, not a local path.
	assert.deepStrictEqual(unusedIn('no-baseurl'), [
		path.join('shadow', 'y.ts'),
	])
})

test('tsconfig paths map bare specifiers to local files', () => {
	// Also covers precedence: '@/components/*' must win over '@/*' for
	// '@/components/Button', and the exact pattern '~utils' over any wildcard.
	assert.deepStrictEqual(unusedIn('paths', {}, 'src'), ['orphan.ts'])
})

test('paths work without a baseUrl, relative to the tsconfig', () => {
	assert.deepStrictEqual(unusedIn('paths-no-baseurl', {}, 'src'), [
		'orphan.ts',
	])
})

test('tsconfig extends inherits baseUrl and paths', () => {
	assert.deepStrictEqual(unusedIn('extends', {}, 'src'), ['orphan.ts'])
})

test('extends accepts an array, where the last entry wins', () => {
	assert.deepStrictEqual(unusedIn('extends-array', {}, 'src'), ['orphan.ts'])
})

test('extends resolves a package name from node_modules', () => {
	// The base config lives in node_modules and its baseUrl is resolved
	// relative to that file, not to the inheriting tsconfig.
	assert.deepStrictEqual(unusedIn('extends-package', {}, 'src'), [
		'orphan.ts',
	])
})

test('circular extends terminates', () => {
	assert.deepStrictEqual(unusedIn('extends-cycle', {}, 'src'), ['orphan.ts'])
})

test('tsconfig with comments, trailing commas and // inside a string', () => {
	// The old regex-based comment stripping broke on the $schema URL.
	assert.deepStrictEqual(unusedIn('jsonc', {}, 'src'), ['orphan.ts'])
})

test('--ignore excludes paths and reports them separately', () => {
	const root = fixture('ignore')
	const result = scanUnusedFiles(path.join(root, 'App.ts'), {
		ignore: [path.join(root, 'legacy')],
	})

	assert.deepStrictEqual(
		result.unusedFiles.map((f) => path.relative(root, f)),
		['orphan.ts']
	)
	assert.deepStrictEqual(relative(root, result.ignoredFiles), [
		path.join('legacy', 'old.ts'),
	])
	assert.ok(!relative(root, result.allFiles).includes(path.join('legacy', 'old.ts')))
})

test('resolves and collects .mts/.cjs/.mjs files', () => {
	assert.deepStrictEqual(unusedIn('extensions'), ['orphan.mjs'])
})

test('without --root only the entry file directory is scanned', () => {
	const root = fixture('root-option')
	const result = scanUnusedFiles(path.join(root, 'src', 'app', 'App.ts'))

	// src/lib and src/components are invisible from src/app.
	assert.deepStrictEqual(
		result.unusedFiles.map((f) => path.relative(root, f)).sort(),
		[path.join('src', 'app', 'local-orphan.ts')]
	)
})

test('--root widens the scan to the whole source tree', () => {
	const root = fixture('root-option')
	const result = scanUnusedFiles(path.join(root, 'src', 'app', 'App.ts'), {
		root: path.join(root, 'src'),
	})

	assert.deepStrictEqual(
		result.unusedFiles.map((f) => path.relative(root, f)).sort(),
		[
			path.join('src', 'app', 'local-orphan.ts'),
			path.join('src', 'lib', 'orphan.ts'),
		]
	)
	// Alias-imported files across the wider tree still count as used.
	const used = result.usedFiles
	assert.ok(used.has(path.join(root, 'src', 'lib', 'used.ts')))
	assert.ok(used.has(path.join(root, 'src', 'components', 'Button.ts')))

	// Every path must be in its platform-native form. A path built by
	// substituting into a `paths` target keeps the specifier's forward
	// slashes, which on Windows yields a second spelling of the same file
	// and makes it look unused. No-op on POSIX, a real guard on Windows.
	for (const file of [...used, ...result.allFiles]) {
		assert.strictEqual(file, path.normalize(file))
	}
})

test('a missing root directory throws', () => {
	assert.throws(
		() =>
			scanUnusedFiles(fixture('root-option', 'src', 'app', 'App.ts'), {
				root: fixture('root-option', 'does-not-exist'),
			}),
		/Root directory not found/
	)
})

test('a file passed as root throws', () => {
	assert.throws(
		() =>
			scanUnusedFiles(fixture('root-option', 'src', 'app', 'App.ts'), {
				root: fixture('root-option', 'tsconfig.json'),
			}),
		/not a directory/
	)
})

test('a missing entry file throws instead of reporting everything as unused', () => {
	assert.throws(
		() => scanUnusedFiles(fixture('barrel', 'does-not-exist.ts')),
		/Entry file not found/
	)
})

test('a directory as entry file throws', () => {
	assert.throws(() => scanUnusedFiles(fixture('barrel')), /not a file/)
})

test('deleteFiles removes files and reports failures without throwing', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ufs-delete-'))
	const target = path.join(dir, 'gone.ts')
	fs.writeFileSync(target, 'export const gone = 1')

	const missing = path.join(dir, 'never-existed.ts')
	const result = deleteFiles([target, missing])

	assert.strictEqual(fs.existsSync(target), false)
	assert.deepStrictEqual(result.deleted, [target])
	assert.deepStrictEqual(result.failed, [missing])

	fs.rmSync(dir, { recursive: true, force: true })
})
