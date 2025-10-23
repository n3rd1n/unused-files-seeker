#!/usr/bin/env node

import { Command } from 'commander'
import * as path from 'path'
import { UnusedFilesSeeker, createDefaultConfig, loadConfig } from './index'

const program = new Command()

program
	.name('unused-files-seeker')
	.description('Find unused files in JavaScript/TypeScript projects')
	.version('1.0.0')

program
	.command('scan')
	.description('Scan project for unused files')
	.option(
		'-c, --config <path>',
		'Pfad zur Konfigurationsdatei',
		'unused-files-seeker.config.json'
	)
	.option('-p, --project <path>', 'Pfad zum Projekt-Root', process.cwd())
	.action(async (options) => {
		try {
			const projectRoot = path.resolve(options.project)
			const config = loadConfig(options.config)

			const seeker = new UnusedFilesSeeker(config, projectRoot)
			const result = await seeker.findUnusedFiles()

			console.info(seeker.formatResults(result))

			if (result.unusedFiles.length > 0) {
				process.exit(1)
			} else {
				process.exit(0)
			}
		} catch (error) {
			console.error('❌ Fehler:', error)
			process.exit(1)
		}
	})

program
	.command('init')
	.description('Create a default configuration file')
	.option(
		'-c, --config <path>',
		'Pfad zur Konfigurationsdatei',
		'unused-files-seeker.config.json'
	)
	.action((options) => {
		try {
			createDefaultConfig(options.config)
		} catch (error) {
			console.error('❌ Error creating configuration:', error)
			process.exit(1)
		}
	})

program.parse()
