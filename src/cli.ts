#!/usr/bin/env node

import path from 'path'
import { deleteFiles, scanUnusedFiles } from './index'

// ============ CLI ============

type ParsedArgs = {
	entryFile: string | null
	shouldDelete: boolean
	ignorePaths: string[]
}

function parseArgs(args: string[]): ParsedArgs {
	const ignorePaths: string[] = []

	args.forEach((arg, index) => {
		if (
			arg === '--ignore' &&
			args[index + 1] &&
			!args[index + 1].startsWith('-')
		) {
			ignorePaths.push(args[index + 1])
		} else if (arg.startsWith('--ignore=')) {
			ignorePaths.push(arg.slice('--ignore='.length))
		}
	})

	// Entry file is the first arg that's not a flag and not a value after --ignore
	const entryFile =
		args.find((arg, index) => {
			if (arg.startsWith('-')) return false
			const prevArg = args[index - 1]
			if (prevArg === '--ignore') return false
			return true
		}) || null

	return {
		entryFile,
		shouldDelete: args.includes('--delete'),
		ignorePaths,
	}
}

function toRelativePath(absolutePath: string): string {
	return path.relative(process.cwd(), absolutePath)
}

function printUsage(): void {
	console.info(`
📁 unused-files-seeker - Find unused files in your project

Usage:
  npx @n3rd1n/unused-files-seeker <entry-file> [options]

Examples:
  npx @n3rd1n/unused-files-seeker src/App.tsx
  npx @n3rd1n/unused-files-seeker src/index.ts --delete
  npx @n3rd1n/unused-files-seeker src/App.tsx --ignore src/utils --ignore src/types
  npx @n3rd1n/unused-files-seeker src/App.tsx --ignore=src/legacy

Options:
  --delete              Delete unused files directly
  --ignore <path>       Ignore file or folder (can be used multiple times)
`)
}

function main(): void {
	const args = process.argv.slice(2)
	const { entryFile, shouldDelete, ignorePaths } = parseArgs(args)

	if (!entryFile) {
		printUsage()
		process.exit(1)
	}

	console.info(`\n🔍 Scanning from: ${entryFile}`)
	if (ignorePaths.length > 0) {
		console.info(`🚫 Ignoring: ${ignorePaths.join(', ')}`)
	}
	console.info('')

	const { allFiles, usedFiles, unusedFiles, ignoredFiles } = scanUnusedFiles(
		entryFile,
		{ ignore: ignorePaths }
	)

	console.info(`📊 Statistics:`)
	console.info(`   All files:      ${allFiles.length}`)
	console.info(`   Used files:     ${usedFiles.size}`)
	console.info(`   Unused:         ${unusedFiles.length}`)
	if (ignoredFiles.length > 0) {
		console.info(`   Ignored:        ${ignoredFiles.length}`)
	}
	console.info('')

	if (unusedFiles.length === 0) {
		console.info('✅ No unused files found!\n')
		return
	}

	console.info('📋 Unused files:')
	unusedFiles.forEach((file) => console.info(`   - ${toRelativePath(file)}`))
	console.info('')

	if (shouldDelete) {
		console.info('🗑️  Deleting unused files...\n')
		deleteFiles(unusedFiles, toRelativePath)
		console.info('\n✅ Done!')
	} else {
		console.info('💡 Tip: Use --delete to remove these files.\n')
	}
}

main()
