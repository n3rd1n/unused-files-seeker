export type File = {
	path: string
	alreadyScanned: boolean
	isUsedByAbsoluteFilePath: string[]
}

export type Config = {
	entryPoint?: string
	scanFolder?: string
	ignorePaths?: string[]
	extensions?: string[]
}

export type ScanResult = {
	allFiles: File[]
	unusedFiles: File[]
	usedFiles: File[]
}
