import fs from 'fs'
import path from 'path'
import { parseSync } from 'oxc-parser'

// ============ Types ============

type Import = {
	path: string
	absolutePath: string
}

type ScanResult = {
	/** Deletion candidates: every source file below the scan directory. */
	allFiles: string[]
	/** Every file reachable from the entry points (may include extra entries). */
	usedFiles: Set<string>
	unusedFiles: string[]
	ignoredFiles: string[]
	/**
	 * Files traversed as additional entry points but never reported as unused:
	 * test files and declaration files. They are usually not imported by the
	 * application graph, yet deleting them would break the project.
	 */
	extraEntryFiles: string[]
}

type PathMapping = {
	pattern: string
	prefix: string
	suffix: string
	isWildcard: boolean
	/** Absolute path templates; a `*` is substituted with the matched part. */
	targets: string[]
}

/** Module resolution settings derived from tsconfig.json. */
type ModuleResolution = {
	baseUrl: string | null
	paths: PathMapping[]
}

type ScanOptions = {
	ignore?: string[]
	/**
	 * Directory searched for deletion candidates. Defaults to the directory of
	 * the entry file, which is too narrow when the entry sits in a subfolder
	 * such as src/app/page.tsx.
	 */
	root?: string
}

type DeleteOptions = {
	/** Suppress per-file console output (used by the CLI's --json mode). */
	silent?: boolean
}

type DeleteResult = {
	deleted: string[]
	failed: string[]
}

// ============ Pure Functions ============

function getFileExtensions(): string[] {
	return ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']
}

function isTestFile(filePath: string): boolean {
	return /\.(spec|test)\.[cm]?[jt]sx?$/.test(path.basename(filePath))
}

function isDeclarationFile(filePath: string): boolean {
	return /\.d\.[cm]?ts$/.test(path.basename(filePath))
}

function isRelativeImport(importPath: string): boolean {
	return importPath.startsWith('./') || importPath.startsWith('../')
}

/** Picks the parser dialect from the file extension. */
function getParserLanguage(filePath: string): 'ts' | 'tsx' | 'jsx' {
	const extension = path.extname(filePath)
	if (extension === '.tsx') return 'tsx'
	if (extension === '.ts' || extension === '.mts' || extension === '.cts') {
		return 'ts'
	}
	// jsx is a superset of js and also covers .mjs/.cjs
	return 'jsx'
}

/** Returns the value of a quoted string literal, or null for any other source. */
function getQuotedValue(raw: string): string | null {
	const quote = raw[0]
	if (raw.length < 2) return null
	if (quote !== "'" && quote !== '"') return null
	if (raw[raw.length - 1] !== quote) return null
	return raw.slice(1, -1)
}

/**
 * Walks the AST for `require('…')`. CommonJS is not part of the ES module
 * record, so this is the only construct that needs a traversal.
 */
function collectRequireCalls(node: unknown, specifiers: string[]): void {
	if (!node || typeof node !== 'object') return

	if (Array.isArray(node)) {
		for (const child of node) collectRequireCalls(child, specifiers)
		return
	}

	const record = node as Record<string, unknown>

	if (record.type === 'CallExpression') {
		const callee = record.callee as Record<string, unknown> | undefined
		const args = record.arguments as Record<string, unknown>[] | undefined
		const first = args?.[0]

		if (
			callee?.type === 'Identifier' &&
			callee.name === 'require' &&
			first?.type === 'Literal' &&
			typeof first.value === 'string'
		) {
			specifiers.push(first.value)
		}
	}

	for (const key in record) {
		if (key === 'type' || key === 'start' || key === 'end') continue
		const value = record[key]
		if (value && typeof value === 'object') {
			collectRequireCalls(value, specifiers)
		}
	}
}

/**
 * Collects every module specifier that loads another file:
 * `import ... from '…'`, `import '…'`, `export ... from '…'`,
 * `export * from '…'`, `import('…')` and `require('…')`.
 */
function getImportSpecifiers(sourceCode: string, filePath: string): string[] {
	const specifiers: string[] = []

	let parsed
	try {
		parsed = parseSync(filePath, sourceCode, {
			lang: getParserLanguage(filePath),
		})
	} catch {
		// A file we cannot parse contributes no edges to the graph.
		return specifiers
	}

	// `import ... from '…'` and bare `import '…'`
	for (const entry of parsed.module.staticImports) {
		specifiers.push(entry.moduleRequest.value)
	}

	// `export { x } from '…'`, `export * from '…'`, `export * as ns from '…'`
	for (const statement of parsed.module.staticExports) {
		for (const entry of statement.entries) {
			if (entry.moduleRequest) {
				specifiers.push(entry.moduleRequest.value)
			}
		}
	}

	// The request of `import(…)` can be any expression; only plain string
	// literals point at a file we can resolve.
	for (const entry of parsed.module.dynamicImports) {
		const { start, end } = entry.moduleRequest
		const value = getQuotedValue(sourceCode.slice(start, end))
		if (value !== null) specifiers.push(value)
	}

	// Only pay for the AST walk in files that actually mention require.
	if (sourceCode.includes('require')) {
		collectRequireCalls(parsed.program, specifiers)
	}

	return specifiers
}

/** Tries a path as a file, with extensions, then as a directory index. */
function resolveFileCandidate(candidate: string): string | null {
	if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
		return candidate
	}

	for (const ext of getFileExtensions()) {
		const withExt = candidate + ext
		if (fs.existsSync(withExt)) return withExt
	}

	for (const ext of getFileExtensions()) {
		const indexFile = path.join(candidate, `index${ext}`)
		if (fs.existsSync(indexFile)) return indexFile
	}

	return null
}

function resolveImportPath(
	importPath: string,
	currentFileDir: string,
	resolution: ModuleResolution
): string | null {
	if (isRelativeImport(importPath)) {
		return resolveFileCandidate(path.resolve(currentFileDir, importPath))
	}

	// A bare specifier: tsconfig `paths` take precedence over `baseUrl`.
	for (const target of applyPathMappings(importPath, resolution.paths)) {
		const resolved = resolveFileCandidate(target)
		if (resolved) return resolved
	}

	if (resolution.baseUrl) {
		return resolveFileCandidate(
			path.resolve(resolution.baseUrl, importPath)
		)
	}

	// Otherwise it refers to a package, which is not our concern.
	return null
}

function extractImports(
	sourceCode: string,
	currentFilePath: string,
	resolution: ModuleResolution
): Import[] {
	const currentFileDir = path.dirname(currentFilePath)

	return getImportSpecifiers(sourceCode, currentFilePath)
		.map((importPath) => {
			// Bare specifiers only resolve locally when a baseUrl is configured;
			// otherwise they refer to packages and are not our concern.
			const absolutePath = resolveImportPath(
				importPath,
				currentFileDir,
				resolution
			)
			if (!absolutePath) return null

			return { path: importPath, absolutePath }
		})
		.filter((imp): imp is Import => imp !== null)
}

function shouldIgnore(
	filePath: string,
	resolvedIgnorePaths: string[]
): boolean {
	return resolvedIgnorePaths.some(
		(ignorePath) =>
			filePath === ignorePath ||
			filePath.startsWith(ignorePath + path.sep)
	)
}

function getAllFilesRecursive(dir: string): string[] {
	if (!fs.existsSync(dir)) return []

	const entries = fs.readdirSync(dir, { withFileTypes: true })
	const extensions = getFileExtensions()

	return entries.flatMap((entry) => {
		const fullPath = path.join(dir, entry.name)

		if (entry.isDirectory()) {
			// Ignore node_modules and hidden folders
			if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
				return []
			}
			return getAllFilesRecursive(fullPath)
		}

		if (
			entry.isFile() &&
			extensions.some((ext) => entry.name.endsWith(ext))
		) {
			return [fullPath]
		}

		return []
	})
}

/**
 * Parses JSON with comments and trailing commas, the dialect tsconfig.json
 * actually uses. A plain regex cannot do this: `//` occurs inside string
 * values such as "$schema": "https://json.schemastore.org/tsconfig".
 */
function parseJsonc(text: string): unknown {
	let result = ''
	let inString = false
	let inLineComment = false
	let inBlockComment = false

	for (let index = 0; index < text.length; index++) {
		const char = text[index]
		const next = text[index + 1]

		if (inLineComment) {
			if (char === '\n') {
				inLineComment = false
				result += char
			}
			continue
		}

		if (inBlockComment) {
			if (char === '*' && next === '/') {
				inBlockComment = false
				index++
			}
			continue
		}

		if (inString) {
			result += char
			if (char === '\\') {
				result += next ?? ''
				index++
			} else if (char === '"') {
				inString = false
			}
			continue
		}

		if (char === '"') {
			inString = true
			result += char
			continue
		}

		if (char === '/' && next === '/') {
			inLineComment = true
			index++
			continue
		}

		if (char === '/' && next === '*') {
			inBlockComment = true
			index++
			continue
		}

		// Drop a trailing comma before a closing brace or bracket.
		if (char === '}' || char === ']') {
			let cut = result.length
			while (cut > 0 && /\s/.test(result[cut - 1])) cut--
			if (cut > 0 && result[cut - 1] === ',') {
				result = result.slice(0, cut - 1) + result.slice(cut)
			}
		}

		result += char
	}

	return JSON.parse(result)
}

function findTsConfig(startPath: string): string | null {
	let current = path.dirname(startPath)

	while (current !== path.dirname(current)) {
		const tsConfigPath = path.join(current, 'tsconfig.json')
		if (fs.existsSync(tsConfigPath)) {
			return tsConfigPath
		}
		current = path.dirname(current)
	}

	return null
}

/**
 * Resolves an `extends` value. It may be a relative path (with or without the
 * .json extension), an absolute path, a directory, or a package name such as
 * `@tsconfig/node20`.
 */
function resolveExtendsTarget(value: string, fromDir: string): string | null {
	const isPathLike =
		value.startsWith('./') ||
		value.startsWith('../') ||
		path.isAbsolute(value)

	if (isPathLike) {
		const resolved = path.resolve(fromDir, value)
		const candidates = [
			resolved,
			`${resolved}.json`,
			path.join(resolved, 'tsconfig.json'),
		]
		return (
			candidates.find(
				(candidate) =>
					fs.existsSync(candidate) && fs.statSync(candidate).isFile()
			) ?? null
		)
	}

	// Package name: let Node resolve it from node_modules.
	for (const specifier of [value, path.posix.join(value, 'tsconfig.json')]) {
		try {
			return require.resolve(specifier, { paths: [fromDir] })
		} catch {
			// Try the next form.
		}
	}

	return null
}

/** Turns a `paths` entry into a matcher with absolute targets. */
function toPathMappings(
	paths: Record<string, string[]>,
	resolveFrom: string
): PathMapping[] {
	return Object.entries(paths).map(([pattern, targets]) => {
		const star = pattern.indexOf('*')
		return {
			pattern,
			prefix: star === -1 ? pattern : pattern.slice(0, star),
			suffix: star === -1 ? '' : pattern.slice(star + 1),
			isWildcard: star !== -1,
			targets: (targets || []).map((target) =>
				path.resolve(resolveFrom, target)
			),
		}
	})
}

/**
 * Reads a tsconfig.json and everything it extends. `extends` may be a single
 * value or, since TypeScript 5.0, an array in which later entries win.
 * baseUrl and paths are resolved against the file that declares them.
 */
function loadTsConfig(configPath: string, seen: Set<string>): ModuleResolution {
	const empty: ModuleResolution = { baseUrl: null, paths: [] }

	if (seen.has(configPath)) return empty
	seen.add(configPath)

	let config: {
		extends?: string | string[]
		compilerOptions?: {
			baseUrl?: string
			paths?: Record<string, string[]>
		}
	}

	try {
		config = parseJsonc(
			fs.readFileSync(configPath, 'utf8')
		) as typeof config
	} catch {
		// A config we cannot read contributes nothing.
		return empty
	}

	const configDir = path.dirname(configPath)

	// Inherited first, so the local file can override it.
	let resolution = empty
	const extendsList = Array.isArray(config.extends)
		? config.extends
		: config.extends
			? [config.extends]
			: []

	for (const entry of extendsList) {
		const target = resolveExtendsTarget(entry, configDir)
		if (!target) continue
		const inherited = loadTsConfig(target, seen)
		resolution = {
			baseUrl: inherited.baseUrl ?? resolution.baseUrl,
			paths: inherited.paths.length ? inherited.paths : resolution.paths,
		}
	}

	const ownBaseUrl = config.compilerOptions?.baseUrl
	const baseUrl = ownBaseUrl
		? path.resolve(configDir, ownBaseUrl)
		: resolution.baseUrl

	const ownPaths = config.compilerOptions?.paths
	// Since TypeScript 4.1 paths work without baseUrl, relative to the config.
	const paths = ownPaths
		? toPathMappings(ownPaths, baseUrl ?? configDir)
		: resolution.paths

	return { baseUrl, paths }
}

/** Module resolution settings from the nearest tsconfig.json. */
function readModuleResolution(entryFile: string): ModuleResolution {
	const tsConfigPath = findTsConfig(entryFile)
	if (!tsConfigPath) return { baseUrl: null, paths: [] }
	return loadTsConfig(tsConfigPath, new Set())
}

/**
 * Applies the `paths` patterns to a specifier. An exact pattern wins over a
 * wildcard, and among wildcards the longest prefix wins — the same order
 * TypeScript uses.
 */
function applyPathMappings(
	specifier: string,
	mappings: PathMapping[]
): string[] {
	for (const mapping of mappings) {
		if (!mapping.isWildcard && mapping.pattern === specifier) {
			return mapping.targets
		}
	}

	let best: PathMapping | null = null
	for (const mapping of mappings) {
		if (!mapping.isWildcard) continue
		if (!specifier.startsWith(mapping.prefix)) continue
		if (!specifier.endsWith(mapping.suffix)) continue
		if (specifier.length < mapping.prefix.length + mapping.suffix.length) {
			continue
		}
		if (!best || mapping.prefix.length > best.prefix.length) {
			best = mapping
		}
	}

	if (!best) return []

	const matched = specifier.slice(
		best.prefix.length,
		specifier.length - best.suffix.length
	)
	// The matched part comes from a module specifier and always uses forward
	// slashes; normalize so the result matches the separators the directory
	// walk produces. Without this, the same file has two spellings on Windows.
	return best.targets.map((target) =>
		path.normalize(target.replace('*', matched))
	)
}

function collectUsedFiles(
	entryFiles: string[],
	resolution: ModuleResolution
): Set<string> {
	const visited = new Set<string>()
	const queue = entryFiles.map((file) => path.resolve(file))

	while (queue.length > 0) {
		const current = queue.pop() as string

		if (visited.has(current) || !fs.existsSync(current)) continue
		visited.add(current)

		const sourceCode = fs.readFileSync(current, 'utf8')
		for (const imp of extractImports(sourceCode, current, resolution)) {
			if (!visited.has(imp.absolutePath)) {
				queue.push(imp.absolutePath)
			}
		}
	}

	return visited
}

// ============ Main Export ============

export function scanUnusedFiles(
	entryFile: string,
	options: ScanOptions = {}
): ScanResult {
	const absoluteEntry = path.resolve(entryFile)

	if (!fs.existsSync(absoluteEntry)) {
		throw new Error(`Entry file not found: ${entryFile}`)
	}
	if (!fs.statSync(absoluteEntry).isFile()) {
		throw new Error(`Entry path is not a file: ${entryFile}`)
	}

	const scanDir = options.root
		? path.resolve(options.root)
		: path.dirname(absoluteEntry)

	if (options.root) {
		if (!fs.existsSync(scanDir)) {
			throw new Error(`Root directory not found: ${options.root}`)
		}
		if (!fs.statSync(scanDir).isDirectory()) {
			throw new Error(`Root path is not a directory: ${options.root}`)
		}
	}
	// Bare specifiers only resolve through tsconfig baseUrl/paths.
	const resolution = readModuleResolution(absoluteEntry)
	// Resolve ignore paths relative to current working directory
	const ignorePaths = (options.ignore || []).map((p) => path.resolve(p))

	const everyFile = getAllFilesRecursive(scanDir)
	const ignoredFiles = everyFile.filter((file) =>
		shouldIgnore(file, ignorePaths)
	)
	const ignoredSet = new Set(ignoredFiles)

	const candidates = everyFile.filter((file) => !ignoredSet.has(file))
	// Tests and declaration files seed the graph but are never deletion candidates.
	const extraEntryFiles = candidates.filter(
		(file) => isTestFile(file) || isDeclarationFile(file)
	)
	const extraEntrySet = new Set(extraEntryFiles)
	const allFiles = candidates.filter((file) => !extraEntrySet.has(file))

	const usedFiles = collectUsedFiles(
		[absoluteEntry, ...extraEntryFiles],
		resolution
	)
	const unusedFiles = allFiles.filter((file) => !usedFiles.has(file))

	return { allFiles, usedFiles, unusedFiles, ignoredFiles, extraEntryFiles }
}

export function deleteFiles(
	files: string[],
	formatPath: (p: string) => string = (p) => p,
	options: DeleteOptions = {}
): DeleteResult {
	const deleted: string[] = []
	const failed: string[] = []

	files.forEach((file) => {
		try {
			fs.unlinkSync(file)
			deleted.push(file)
			if (!options.silent) {
				console.info(`🗑️  Deleted: ${formatPath(file)}`)
			}
		} catch {
			failed.push(file)
			if (!options.silent) {
				console.error(`❌ Error deleting: ${formatPath(file)}`)
			}
		}
	})

	return { deleted, failed }
}
