import * as fs from 'fs';
import { glob } from 'glob';
import * as path from 'path';
import { Config, File } from './types';

export class FileScanner {
  private config: Config;
  private projectRoot: string;

  constructor(config: Config, projectRoot: string) {
    this.config = config;
    this.projectRoot = projectRoot;
  }

  async scanAllFiles(): Promise<File[]> {
    const scanPath = path.resolve(this.projectRoot, this.config.scanFolder || 'src');
    
    if (!fs.existsSync(scanPath)) {
      throw new Error(`Scan folder does not exist: ${scanPath}`);
    }

    const extensions = this.config.extensions || ['.js', '.ts', '.jsx', '.tsx'];
    const globPattern = `**/*{${extensions.join(',')}}`;
    
    const ignorePatterns = this.config.ignorePaths?.map(ignorePath => 
      `**/${ignorePath}/**`
    ) || [];

    try {
      const files = await glob(globPattern, {
        cwd: scanPath,
        ignore: ignorePatterns,
        absolute: true
      });

      return files.map(filePath => ({
        path: filePath,
        alreadyScanned: false,
        isUsedByAbsoluteFilePath: []
      }));
    } catch (error) {
      throw new Error(`Error scanning files: ${error}`);
    }
  }

  fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  readFileContent(filePath: string): string {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      throw new Error(`Error reading file ${filePath}: ${error}`);
    }
  }

  resolveImportPath(importPath: string, fromFile: string): string | null {
    const fromDir = path.dirname(fromFile);
    
    const possiblePaths = [
      path.resolve(fromDir, importPath),
      ...this.config.extensions?.map(ext => 
        path.resolve(fromDir, importPath + ext)
      ) || [],
      ...this.config.extensions?.map(ext => 
        path.resolve(fromDir, importPath, 'index' + ext)
      ) || [],
      path.resolve(this.projectRoot, 'node_modules', importPath)
    ];

    for (const possiblePath of possiblePaths) {
      if (this.fileExists(possiblePath)) {
        return possiblePath;
      }
    }

    return null;
  }
}
