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

type ScanOptions = {
	ignore?: string[]
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

function resolveImportPath(
	importPath: string,
	currentFileDir: string,
	basePath: string | null
): string | null {
	if (!isRelativeImport(importPath) && !basePath) return null

	const resolvedBase = isRelativeImport(importPath)
		? path.resolve(currentFileDir, importPath)
		: path.resolve(basePath as string, importPath)

	// Direct match with extension
	if (fs.existsSync(resolvedBase) && fs.statSync(resolvedBase).isFile()) {
		return resolvedBase
	}

	// Try extensions
	for (const ext of getFileExtensions()) {
		const withExt = resolvedBase + ext
		if (fs.existsSync(withExt)) {
			return withExt
		}
	}

	// Try index files
	for (const ext of getFileExtensions()) {
		const indexFile = path.join(resolvedBase, `index${ext}`)
		if (fs.existsSync(indexFile)) {
			return indexFile
		}
	}

	return null
}

function extractImports(
	sourceCode: string,
	currentFilePath: string,
	basePath: string | null
): Import[] {
	const currentFileDir = path.dirname(currentFilePath)

	return getImportSpecifiers(sourceCode, currentFilePath)
		.map((importPath) => {
			// Bare specifiers only resolve locally when a baseUrl is configured;
			// otherwise they refer to packages and are not our concern.
			const absolutePath = resolveImportPath(
				importPath,
				currentFileDir,
				basePath
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

/** Returns the absolute baseUrl from the nearest tsconfig.json, or null. */
function readTsConfigBaseUrl(entryFile: string): string | null {
	const tsConfigPath = findTsConfig(entryFile)

	if (!tsConfigPath) return null

	try {
		const content = fs.readFileSync(tsConfigPath, 'utf8')
		// Simple parsing without JSON5
		const cleaned = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
		const config = JSON.parse(cleaned)
		const baseUrl = config?.compilerOptions?.baseUrl
		const tsConfigDir = path.dirname(tsConfigPath)

		if (baseUrl) {
			return path.resolve(tsConfigDir, baseUrl)
		}
	} catch {
		// Ignore parsing errors
	}

	return null
}

function collectUsedFiles(
	entryFiles: string[],
	basePath: string | null
): Set<string> {
	const visited = new Set<string>()
	const queue = entryFiles.map((file) => path.resolve(file))

	while (queue.length > 0) {
		const current = queue.pop() as string

		if (visited.has(current) || !fs.existsSync(current)) continue
		visited.add(current)

		const sourceCode = fs.readFileSync(current, 'utf8')
		for (const imp of extractImports(sourceCode, current, basePath)) {
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

	const scanDir = path.dirname(absoluteEntry)
	// Absolute imports are only resolved when tsconfig.json defines a baseUrl.
	const basePath = readTsConfigBaseUrl(absoluteEntry)
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
		basePath
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
