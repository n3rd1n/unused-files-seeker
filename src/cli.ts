#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import readline from 'readline/promises'
import { deleteFiles, scanUnusedFiles } from './index'

// ============ CLI ============

type ParsedArgs = {
	entryFile: string | null
	shouldDelete: boolean
	assumeYes: boolean
	json: boolean
	failOnFound: boolean
	showHelp: boolean
	showVersion: boolean
	ignorePaths: string[]
	unknownFlags: string[]
}

function parseArgs(args: string[]): ParsedArgs {
	const ignorePaths: string[] = []
	const positional: string[] = []
	const unknownFlags: string[] = []
	let shouldDelete = false
	let assumeYes = false
	let json = false
	let failOnFound = false
	let showHelp = false
	let showVersion = false

	for (let index = 0; index < args.length; index++) {
		const arg = args[index]

		if (arg === '--ignore') {
			const value = args[index + 1]
			if (value && !value.startsWith('-')) {
				ignorePaths.push(value)
				index++
			}
			continue
		}

		if (arg.startsWith('--ignore=')) {
			ignorePaths.push(arg.slice('--ignore='.length))
			continue
		}

		if (arg === '--delete') {
			shouldDelete = true
		} else if (arg === '--yes' || arg === '-y') {
			assumeYes = true
		} else if (arg === '--json') {
			json = true
		} else if (arg === '--fail-on-found') {
			failOnFound = true
		} else if (arg === '--help' || arg === '-h') {
			showHelp = true
		} else if (arg === '--version' || arg === '-v') {
			showVersion = true
		} else if (arg.startsWith('-')) {
			unknownFlags.push(arg)
		} else {
			positional.push(arg)
		}
	}

	return {
		entryFile: positional[0] ?? null,
		shouldDelete,
		assumeYes,
		json,
		failOnFound,
		showHelp,
		showVersion,
		ignorePaths,
		unknownFlags,
	}
}

function toRelativePath(absolutePath: string): string {
	return path.relative(process.cwd(), absolutePath)
}

function readVersion(): string {
	try {
		const packageJson = path.join(__dirname, '..', 'package.json')
		return JSON.parse(fs.readFileSync(packageJson, 'utf8')).version
	} catch {
		return 'unknown'
	}
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
  npx @n3rd1n/unused-files-seeker src/App.tsx --json > report.json
  npx @n3rd1n/unused-files-seeker src/App.tsx --fail-on-found   # for CI

Options:
  --delete              Delete unused files (asks for confirmation)
  -y, --yes             Skip the confirmation prompt for --delete
  --json                Print the result as JSON (absolute paths) on stdout
  --fail-on-found       Exit with code 1 when unused files remain
  --ignore <path>       Ignore file or folder (can be used multiple times)
  -h, --help            Show this help
  -v, --version         Show the version

Exit codes:
  0  Success
  1  Error, or unused files remain while --fail-on-found is set
`)
}

async function confirmDeletion(count: number): Promise<boolean> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stderr,
	})

	try {
		const answer = await rl.question(
			`⚠️  Delete ${count} file(s)? This cannot be undone. [y/N] `
		)
		return /^y(es)?$/i.test(answer.trim())
	} finally {
		rl.close()
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2)
	const options = parseArgs(args)

	if (options.showVersion) {
		console.info(readVersion())
		return
	}

	if (options.showHelp) {
		printUsage()
		return
	}

	if (options.unknownFlags.length > 0) {
		console.error(`❌ Unknown option: ${options.unknownFlags.join(', ')}`)
		console.error('   Run with --help to see the available options.\n')
		process.exit(1)
	}

	if (!options.entryFile) {
		printUsage()
		process.exit(1)
	}

	// In JSON mode stdout carries the report only; progress goes to stderr.
	const log = (message: string) => {
		if (!options.json) console.info(message)
	}

	log(`\n🔍 Scanning from: ${options.entryFile}`)
	if (options.ignorePaths.length > 0) {
		log(`🚫 Ignoring: ${options.ignorePaths.join(', ')}`)
	}
	log('')

	let result
	try {
		result = scanUnusedFiles(options.entryFile, {
			ignore: options.ignorePaths,
		})
	} catch (error) {
		console.error(`❌ ${(error as Error).message}\n`)
		process.exit(1)
	}

	const { allFiles, unusedFiles, ignoredFiles, extraEntryFiles } = result

	log(`📊 Statistics:`)
	log(`   All files:      ${allFiles.length}`)
	log(`   Used files:     ${allFiles.length - unusedFiles.length}`)
	log(`   Unused:         ${unusedFiles.length}`)
	if (extraEntryFiles.length > 0) {
		log(`   Extra entries:  ${extraEntryFiles.length} (tests, .d.ts)`)
	}
	if (ignoredFiles.length > 0) {
		log(`   Ignored:        ${ignoredFiles.length}`)
	}
	log('')

	if (unusedFiles.length > 0) {
		log('📋 Unused files:')
		unusedFiles.forEach((file) => log(`   - ${toRelativePath(file)}`))
		log('')
	} else if (!options.json) {
		log('✅ No unused files found!\n')
	}

	let deleted: string[] = []
	let failed: string[] = []
	let aborted = false

	if (options.shouldDelete && unusedFiles.length > 0) {
		const confirmed =
			options.assumeYes ||
			(process.stdin.isTTY
				? await confirmDeletion(unusedFiles.length)
				: false)

		if (!confirmed) {
			if (!options.assumeYes && !process.stdin.isTTY) {
				console.error(
					'❌ Refusing to delete without confirmation in a non-interactive shell.'
				)
				console.error('   Re-run with --yes to confirm.\n')
				process.exit(1)
			}
			aborted = true
			log('🚫 Aborted, nothing was deleted.\n')
		} else {
			log('🗑️  Deleting unused files...\n')
			const deletion = deleteFiles(unusedFiles, toRelativePath, {
				silent: options.json,
			})
			deleted = deletion.deleted
			failed = deletion.failed
			if (failed.length === 0) log('\n✅ Done!\n')
		}
	} else if (unusedFiles.length > 0 && !options.shouldDelete) {
		log('💡 Tip: Use --delete to remove these files.\n')
	}

	if (options.json) {
		console.log(
			JSON.stringify(
				{
					entryFile: path.resolve(options.entryFile),
					allFiles,
					usedFiles: [...result.usedFiles],
					unusedFiles,
					ignoredFiles,
					extraEntryFiles,
					deleted,
					failed,
				},
				null,
				2
			)
		)
	}

	if (failed.length > 0) {
		console.error(`❌ Failed to delete ${failed.length} file(s).\n`)
		process.exit(1)
	}

	// Files still on disk after this run.
	const remaining = aborted || !options.shouldDelete ? unusedFiles.length : 0
	if (options.failOnFound && remaining > 0) {
		process.exit(1)
	}
}

main().catch((error) => {
	console.error(`❌ ${(error as Error).message}\n`)
	process.exit(1)
})
