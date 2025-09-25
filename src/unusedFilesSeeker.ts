import * as path from 'path'
import { FileScanner } from './fileScanner'
import { ImportParser } from './importParser'
import { Config, File, ScanResult } from './types'

export class UnusedFilesSeeker {
	private config: Config
	private projectRoot: string
	private fileScanner: FileScanner
	private importParser: ImportParser

	constructor(config: Config, projectRoot: string) {
		this.config = config
		this.projectRoot = projectRoot
		this.fileScanner = new FileScanner(config, projectRoot)
		this.importParser = new ImportParser()
	}

	async findUnusedFiles(): Promise<ScanResult> {
		console.info('🔍 Starting scan for unused files...')

		const allFiles: File[] = await this.fileScanner.scanAllFiles()
		const entryPoint: string = this.findEntryPoint()
		const allFilesWithoutEntryPoint: File[] = allFiles.filter(
			(file) => file.path !== entryPoint
		)
		console.info(
			`📁 ${allFilesWithoutEntryPoint.length} files found (without Entry Point)`
		)

		console.info(`🚀 Entry Point: ${entryPoint}`)

		await this.buildImportGraph(allFiles, entryPoint)

		const usedFiles = allFilesWithoutEntryPoint.filter(
			(file) => file.isUsedByAbsoluteFilePath.length > 0
		)
		const unusedFiles = allFilesWithoutEntryPoint.filter(
			(file) => file.isUsedByAbsoluteFilePath.length === 0
		)

		console.info(`✅ ${usedFiles.length} used files`)
		if (unusedFiles.length) {
			console.info(`❌ ${unusedFiles.length} unused files`)
		}

		return {
			allFiles: allFilesWithoutEntryPoint,
			unusedFiles,
			usedFiles,
		}
	}

	private findEntryPoint(): string {
		const possibleEntryPoints = [
			this.config.entryPoint,
			'index.js',
			'index.ts',
			'src/index.js',
			'src/index.ts',
		].filter(Boolean)

		for (const entryPoint of possibleEntryPoints) {
			const fullPath = path.resolve(this.projectRoot, entryPoint!)
			if (this.fileScanner.fileExists(fullPath)) {
				return fullPath
			}
		}

		throw new Error(`No entry point found. Tried: ${possibleEntryPoints.join(', ')}`)
	}

	private async buildImportGraph(allFiles: File[], entryPoint: string): Promise<void> {
		const filesToScan = [entryPoint]
		const scannedFiles = new Set<string>()

		while (filesToScan.length > 0) {
			const currentFile = filesToScan.shift()!

			if (scannedFiles.has(currentFile)) {
				continue
			}

			scannedFiles.add(currentFile)
			console.info(`📖 Scanning: ${path.relative(this.projectRoot, currentFile)}`)

			try {
				const content = this.fileScanner.readFileContent(currentFile)
				const imports = this.importParser.extractImports(content)

				for (const importPath of imports) {
					const resolvedPath = this.fileScanner.resolveImportPath(
						importPath,
						currentFile
					)

					if (resolvedPath) {
						const targetFile = allFiles.find(
							(file) => file.path === resolvedPath
						)

						if (targetFile) {
							if (
								!targetFile.isUsedByAbsoluteFilePath.includes(
									currentFile
								)
							) {
								targetFile.isUsedByAbsoluteFilePath.push(
									currentFile
								)
							}

							if (
								!scannedFiles.has(resolvedPath) &&
								!filesToScan.includes(resolvedPath)
							) {
								filesToScan.push(resolvedPath)
							}
						}
					}
				}
			} catch (error) {
				console.warn(`⚠️  Error scanning ${currentFile}: ${error}`)
			}
		}
	}

	formatResults(result: ScanResult): string {
		let output = '\n📊 SCAN RESULTS\n'
		output += '='.repeat(50) + '\n\n'

		output += `📁 Total: ${result.allFiles.length} files\n`
		output += `✅ Used: ${result.usedFiles.length} files\n`
		if (result.unusedFiles.length) {
			output += `❌ Unused: ${result.unusedFiles.length} files\n\n`
		}

		if (result.unusedFiles.length > 0) {
			output += '🗑️  UNUSED FILES:\n'
			output += '-'.repeat(30) + '\n'

			result.unusedFiles.forEach((file) => {
				const relativePath = path.relative(this.projectRoot, file.path)
				output += `${relativePath}\n`
			})
		}

		return output
	}
}
