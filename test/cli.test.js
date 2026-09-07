const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const CLI = path.join(__dirname, '..', 'dist', 'cli.js')
const FIXTURES = path.join(__dirname, 'fixtures')

function run(args, options = {}) {
	return spawnSync(process.execPath, [CLI, ...args], {
		encoding: 'utf8',
		// Never inherit a TTY: the delete guard must see a non-interactive shell.
		stdio: ['pipe', 'pipe', 'pipe'],
		...options,
	})
}

/** Copies a fixture to a temp dir so destructive tests cannot touch the repo. */
function tempCopy(name) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ufs-cli-'))
	fs.cpSync(path.join(FIXTURES, name), dir, { recursive: true })
	// Keep the fixture hermetic: no baseUrl lookup escaping into the tmp tree.
	fs.writeFileSync(
		path.join(dir, 'tsconfig.json'),
		'{ "compilerOptions": {} }'
	)
	return dir
}

test('--json prints valid JSON on stdout and nothing else', () => {
	const result = run([path.join(FIXTURES, 'barrel', 'App.ts'), '--json'])

	assert.strictEqual(result.status, 0)
	const report = JSON.parse(result.stdout)
	assert.deepStrictEqual(
		report.unusedFiles.map((f) => path.basename(f)),
		['orphan.ts']
	)
	assert.ok(path.isAbsolute(report.unusedFiles[0]))
	assert.deepStrictEqual(report.deleted, [])
})

test('--fail-on-found exits 1 when unused files remain', () => {
	const result = run([
		path.join(FIXTURES, 'barrel', 'App.ts'),
		'--fail-on-found',
	])
	assert.strictEqual(result.status, 1)
})

test('--fail-on-found exits 0 when nothing is unused', () => {
	const result = run([
		path.join(FIXTURES, 'cycle', 'App.ts'),
		'--ignore',
		path.join(FIXTURES, 'cycle', 'orphan.ts'),
		'--fail-on-found',
	])
	assert.strictEqual(result.status, 0)
})

test('--delete refuses to run unconfirmed in a non-interactive shell', () => {
	const dir = tempCopy('barrel')
	const result = run([path.join(dir, 'App.ts'), '--delete'])

	assert.strictEqual(result.status, 1)
	assert.match(result.stderr, /Refusing to delete without confirmation/)
	assert.ok(fs.existsSync(path.join(dir, 'orphan.ts')), 'file was deleted')

	fs.rmSync(dir, { recursive: true, force: true })
})

test('--delete --yes deletes without prompting', () => {
	const dir = tempCopy('barrel')
	const result = run([path.join(dir, 'App.ts'), '--delete', '--yes'])

	assert.strictEqual(result.status, 0)
	assert.strictEqual(fs.existsSync(path.join(dir, 'orphan.ts')), false)
	// Used files behind the barrel must survive.
	assert.ok(fs.existsSync(path.join(dir, 'comp', 'Button.ts')))

	fs.rmSync(dir, { recursive: true, force: true })
})

test('--root and --root= both widen the scan', () => {
	const entry = path.join(FIXTURES, 'root-option', 'src', 'app', 'App.ts')
	const src = path.join(FIXTURES, 'root-option', 'src')

	for (const args of [['--root', src], [`--root=${src}`]]) {
		const result = run([entry, ...args, '--json'])
		assert.strictEqual(result.status, 0)
		const report = JSON.parse(result.stdout)
		assert.deepStrictEqual(
			report.unusedFiles.map((f) => path.basename(f)).sort(),
			['local-orphan.ts', 'orphan.ts']
		)
	}
})

test('a missing --root exits 1', () => {
	const result = run([
		path.join(FIXTURES, 'root-option', 'src', 'app', 'App.ts'),
		'--root',
		path.join(FIXTURES, 'root-option', 'nope'),
	])
	assert.strictEqual(result.status, 1)
	assert.match(result.stderr, /Root directory not found/)
})

test('a missing entry file exits 1', () => {
	const result = run([path.join(FIXTURES, 'barrel', 'nope.ts')])
	assert.strictEqual(result.status, 1)
	assert.match(result.stderr, /Entry file not found/)
})

test('an unknown flag exits 1 instead of being ignored', () => {
	const result = run([path.join(FIXTURES, 'barrel', 'App.ts'), '--delet'])
	assert.strictEqual(result.status, 1)
	assert.match(result.stderr, /Unknown option/)
})

test('--help and --version exit 0', () => {
	assert.strictEqual(run(['--help']).status, 0)
	const version = run(['--version'])
	assert.strictEqual(version.status, 0)
	assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+/)
})

test('no arguments prints usage and exits 1', () => {
	const result = run([])
	assert.strictEqual(result.status, 1)
	assert.match(result.stdout, /Usage:/)
})
