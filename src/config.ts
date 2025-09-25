import * as fs from 'fs';
import * as path from 'path';
import { Config } from './types';

export function loadConfig(configPath: string = 'unused-files-seeker.config.json'): Config {
  const fullPath = path.resolve(configPath);
  
  if (!fs.existsSync(fullPath)) {
    return {
      entryPoint: 'index.js',
      scanFolder: 'src',
      ignorePaths: ['node_modules', 'dist', 'build', '.git'],
      extensions: ['.js', '.ts', '.jsx', '.tsx']
    };
  }

  try {
    const configContent = fs.readFileSync(fullPath, 'utf-8');
    const config: Config = JSON.parse(configContent);
    
    return {
      entryPoint: config.entryPoint || 'index.js',
      scanFolder: config.scanFolder || 'src',
      ignorePaths: config.ignorePaths || ['node_modules', 'dist', 'build', '.git'],
      extensions: config.extensions || ['.js', '.ts', '.jsx', '.tsx']
    };
  } catch (error) {
    throw new Error(`Error loading configuration: ${error}`);
  }
}

export function createDefaultConfig(configPath: string = 'unused-files-seeker.config.json'): void {
  const defaultConfig: Config = {
    entryPoint: 'index.js',
    scanFolder: 'src',
    ignorePaths: ['node_modules', 'dist', 'build', '.git'],
    extensions: ['.js', '.ts', '.jsx', '.tsx']
  };

  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
  console.log(`Default configuration created: ${configPath}`);
}
