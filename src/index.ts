import fs from 'fs'
import path from 'path'
import Parser from 'tree-sitter'
import TypeScript from 'tree-sitter-typescript'

// ============ Types ============

type Import = {
	path: string
	absolutePath: string
}

type ScanResult = {
	allFiles: string[]
	usedFiles: Set<string>
	unusedFiles: string[]
	ignoredFiles: string[]
}

type ScanOptions = {
	ignore?: string[]
}

// ============ Parser Setup ============

const tsParser = new Parser()
tsParser.setLanguage(TypeScript.tsx)

// ============ Pure Functions ============

function getImportPath(node: Parser.SyntaxNode): string | null {
	const sourceNode = node.childForFieldName('source')
	return sourceNode ? sourceNode.text.slice(1, -1) : null
}

function getImportNodes(rootNode: Parser.SyntaxNode): Parser.SyntaxNode[] {
	return rootNode.descendantsOfType('import_statement')
}

function isRelativeImport(importPath: string): boolean {
	return importPath.startsWith('./') || importPath.startsWith('../')
}

function getFileExtensions(): string[] {
	return ['.ts', '.tsx', '.js', '.jsx']
}

function resolveImportPath(
	importPath: string,
	currentFileDir: string,
	basePath: string | null
): string | null {
	const baseDir = isRelativeImport(importPath)
		? currentFileDir
		: basePath || currentFileDir

	const resolvedBase = isRelativeImport(importPath)
		? path.resolve(currentFileDir, importPath)
		: path.resolve(baseDir, importPath)

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
	const tree = tsParser.parse(sourceCode)
	const importNodes = getImportNodes(tree.rootNode)
	const currentFileDir = path.dirname(currentFilePath)

	return importNodes
		.map((node) => {
			const importPath = getImportPath(node)
			if (!importPath || (!isRelativeImport(importPath) && !basePath))
				return null

			// Ignore external packages
			if (!isRelativeImport(importPath) && !basePath) return null

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

function shouldIgnore(filePath: string, ignorePaths: string[]): boolean {
	return ignorePaths.some((ignorePath) => {
		const absoluteIgnore = path.resolve(ignorePath)
		return (
			filePath === absoluteIgnore ||
			filePath.startsWith(absoluteIgnore + path.sep)
		)
	})
}

function getAllFilesRecursive(
	dir: string,
	ignorePaths: string[] = []
): string[] {
	if (!fs.existsSync(dir)) return []

	const entries = fs.readdirSync(dir, { withFileTypes: true })
	const extensions = getFileExtensions()

	return entries.flatMap((entry) => {
		const fullPath = path.join(dir, entry.name)

		// Check ignore list
		if (shouldIgnore(fullPath, ignorePaths)) {
			return []
		}

		if (entry.isDirectory()) {
			// Ignore node_modules and hidden folders
			if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
				return []
			}
			return getAllFilesRecursive(fullPath, ignorePaths)
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

function readTsConfig(entryFile: string): string | null {
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
	entryFile: string,
	basePath: string | null,
	visited: Set<string> = new Set()
): Set<string> {
	const absoluteEntry = path.resolve(entryFile)

	if (visited.has(absoluteEntry) || !fs.existsSync(absoluteEntry)) {
		return visited
	}

	visited.add(absoluteEntry)

	const sourceCode = fs.readFileSync(absoluteEntry, 'utf8')
	const imports = extractImports(sourceCode, absoluteEntry, basePath)

	imports.forEach((imp) => {
		collectUsedFiles(imp.absolutePath, basePath, visited)
	})

	return visited
}

// ============ Main Export ============

export function scanUnusedFiles(
	entryFile: string,
	options: ScanOptions = {}
): ScanResult {
	const absoluteEntry = path.resolve(entryFile)
	const scanDir = path.dirname(absoluteEntry)
	// Use tsconfig baseUrl if available, otherwise fallback to entry file directory
	const basePath = readTsConfig(absoluteEntry) || scanDir
	// Resolve ignore paths relative to current working directory
	const ignorePaths = (options.ignore || []).map((p) => path.resolve(p))

	const allFilesWithoutIgnore = getAllFilesRecursive(scanDir, [])
	const allFiles = getAllFilesRecursive(scanDir, ignorePaths)
	const ignoredFiles = allFilesWithoutIgnore.filter(
		(file) => !allFiles.includes(file)
	)
	const usedFiles = collectUsedFiles(absoluteEntry, basePath)
	const unusedFiles = allFiles.filter((file) => !usedFiles.has(file))

	return { allFiles, usedFiles, unusedFiles, ignoredFiles }
}

export function deleteFiles(
	files: string[],
	formatPath: (p: string) => string = (p) => p
): void {
	files.forEach((file) => {
		try {
			fs.unlinkSync(file)
			console.info(`🗑️  Deleted: ${formatPath(file)}`)
		} catch (error) {
			console.error(`❌ Error deleting: ${formatPath(file)}`)
		}
	})
}
