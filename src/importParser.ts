export class ImportParser {
	extractImports(fileContent: string): string[] {
		const imports: string[] = []

		const patterns = [
			// ES6 imports: import ... from '...'
			/import\s+.*?\s+from\s+['"`]([^'"`]+)['"`]/g,
			// ES6 imports: import '...'
			/import\s+['"`]([^'"`]+)['"`]/g,
			// CommonJS require: require('...')
			/require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
			// Dynamic imports: import('...')
			/import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
			// TypeScript triple-slash directives: /// <reference path="..." />
			/\/\/\/\s*<reference\s+path\s*=\s*['"`]([^'"`]+)['"`]\s*\/>/g,
		]

		for (const pattern of patterns) {
			let match
			while ((match = pattern.exec(fileContent)) !== null) {
				const importPath = match[1]
				if (!this.isBuiltInModule(importPath)) {
					imports.push(importPath)
				}
			}
		}

		return [...new Set(imports)]
	}

	private isBuiltInModule(moduleName: string): boolean {
		const builtInModules = [
			'fs',
			'path',
			'os',
			'util',
			'crypto',
			'stream',
			'events',
			'buffer',
			'url',
			'querystring',
			'http',
			'https',
			'net',
			'tls',
			'dns',
			'child_process',
			'cluster',
			'worker_threads',
			'readline',
			'repl',
			'vm',
			'v8',
			'perf_hooks',
			'async_hooks',
			'timers',
			'tty',
			'string_decoder',
			'assert',
			'console',
			'process',
			'globals',
			'module',
			'punycode',
			'zlib',
			'http2',
			'inspector',
			'trace_events',
			'wasi',
			'worker_threads',
		]

		return builtInModules.includes(moduleName)
	}

	normalizeImportPath(importPath: string): string {
		let normalized = importPath.replace(/\.(js|ts|jsx|tsx)$/, '')

		normalized = normalized.replace(/\/index$/, '/')

		return normalized
	}
}
