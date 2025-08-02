import * as path from 'path';
import { logger } from '../services/structuredLogger.js';

/**
 * Git-related utility functions
 */

export interface ConventionalCommit {
  type: string;
  scope?: string;
  description: string;
  body?: string;
  footer?: string;
  breaking: boolean;
  isValid: boolean;
}

export interface CommitStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
  netChanges: number;
}

/**
 * Parse conventional commit message format
 * Format: type(scope): description
 */
export function parseConventionalCommit(message: string): ConventionalCommit {
  const lines = message.trim().split('\n');
  const firstLine = lines[0];
  
  // Regex for conventional commit format
  const conventionalRegex = /^(feat|fix|docs|style|refactor|perf|test|chore|build|ci|revert)(\([^)]+\))?(!?):\s*(.+)$/;
  const match = firstLine.match(conventionalRegex);
  
  if (!match) {
    return {
      type: 'other',
      description: firstLine,
      body: lines.slice(1).join('\n').trim() || undefined,
      breaking: message.includes('BREAKING CHANGE') || message.includes('!:'),
      isValid: false,
    };
  }

  const [, type, scopeMatch, breaking, description] = match;
  const scope = scopeMatch ? scopeMatch.slice(1, -1) : undefined;
  
  const body = lines.length > 1 ? lines.slice(1).join('\n').trim() : undefined;
  
  // Check for breaking change indicators
  const hasBreaking = breaking === '!' || 
                     (body && body.includes('BREAKING CHANGE')) ||
                     message.includes('BREAKING CHANGE');

  return {
    type,
    scope,
    description: description.trim(),
    body,
    breaking: hasBreaking,
    isValid: true,
  };
}

/**
 * Validate if a path is likely a git repository
 */
export function isGitRepository(repoPath: string): boolean {
  try {
    const gitPath = path.join(repoPath, '.git');
    return require('fs').existsSync(gitPath);
  } catch (error) {
    return false;
  }
}

/**
 * Extract repository name from path or URL
 */
export function extractRepoName(repoPath: string): string {
  // Handle git URLs
  if (repoPath.startsWith('http') || repoPath.includes('@')) {
    const match = repoPath.match(/\/([^\/]+?)(?:\.git)?(?:\/)?$/);
    if (match) {
      return match[1];
    }
  }
  
  // Handle local paths
  return path.basename(repoPath).replace(/\.git$/, '');
}

/**
 * Normalize file path for consistent storage
 */
export function normalizeFilePath(filePath: string): string {
  // Remove leading ./
  let normalized = filePath.replace(/^\.\//, '');
  
  // Ensure forward slashes
  normalized = normalized.replace(/\\/g, '/');
  
  return normalized;
}

/**
 * Get file extension and detect binary files
 */
export function getFileInfo(filePath: string): {
  extension: string;
  language?: string;
  isBinary: boolean;
  isGenerated: boolean;
} {
  const ext = path.extname(filePath).toLowerCase();
  
  // Binary file extensions
  const binaryExtensions = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.ico',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.exe', '.dll', '.so', '.dylib',
    '.mp3', '.mp4', '.avi', '.mov', '.wav',
    '.ttf', '.otf', '.woff', '.woff2',
  ]);

  // Generated/build file patterns
  const generatedPatterns = [
    /node_modules/,
    /\.min\./,
    /dist\//,
    /build\//,
    /coverage\//,
    /\.lock$/,
    /package-lock\.json$/,
    /yarn\.lock$/,
  ];

  const language = detectLanguage(filePath);
  const isBinary = binaryExtensions.has(ext);
  const isGenerated = generatedPatterns.some(pattern => pattern.test(filePath));

  return {
    extension: ext,
    language,
    isBinary,
    isGenerated,
  };
}

/**
 * Detect programming language from file path
 */
export function detectLanguage(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();
  
  // Special files
  const specialFiles: Record<string, string> = {
    'dockerfile': 'docker',
    'makefile': 'makefile',
    'rakefile': 'ruby',
    'gemfile': 'ruby',
    'podfile': 'ruby',
    'vagrantfile': 'ruby',
    'jenkinsfile': 'groovy',
    'cmakelists.txt': 'cmake',
  };

  if (specialFiles[basename]) {
    return specialFiles[basename];
  }

  // Extension mapping
  const languageMap: Record<string, string> = {
    // JavaScript/TypeScript ecosystem
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.jsx': 'jsx',
    '.vue': 'vue',
    '.svelte': 'svelte',
    
    // Python
    '.py': 'python',
    '.pyx': 'python',
    '.pyi': 'python',
    '.pyw': 'python',
    
    // Java ecosystem
    '.java': 'java',
    '.kt': 'kotlin',
    '.kts': 'kotlin',
    '.scala': 'scala',
    '.groovy': 'groovy',
    '.gradle': 'gradle',
    
    // C/C++
    '.c': 'c',
    '.h': 'c',
    '.cpp': 'cpp',
    '.cxx': 'cpp',
    '.cc': 'cpp',
    '.hpp': 'cpp',
    '.hxx': 'cpp',
    
    // C#/.NET
    '.cs': 'csharp',
    '.vb': 'vbnet',
    '.fs': 'fsharp',
    
    // Web technologies
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'sass',
    '.less': 'less',
    '.stylus': 'stylus',
    
    // Other languages
    '.php': 'php',
    '.rb': 'ruby',
    '.go': 'go',
    '.rs': 'rust',
    '.swift': 'swift',
    '.m': 'objective-c',
    '.mm': 'objective-c',
    
    // Functional languages
    '.hs': 'haskell',
    '.lhs': 'haskell',
    '.elm': 'elm',
    '.clj': 'clojure',
    '.cljs': 'clojure',
    '.ml': 'ocaml',
    '.mli': 'ocaml',
    '.fs': 'fsharp',
    '.fsx': 'fsharp',
    
    // Data/Config formats
    '.json': 'json',
    '.xml': 'xml',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
    '.ini': 'ini',
    '.cfg': 'ini',
    '.conf': 'conf',
    
    // Markup
    '.md': 'markdown',
    '.mdx': 'mdx',
    '.rst': 'restructuredtext',
    '.tex': 'latex',
    
    // Scripts
    '.sh': 'bash',
    '.bash': 'bash',
    '.zsh': 'zsh',
    '.fish': 'fish',
    '.ps1': 'powershell',
    '.psm1': 'powershell',
    '.bat': 'batch',
    '.cmd': 'batch',
    
    // SQL
    '.sql': 'sql',
    '.psql': 'postgresql',
    '.mysql': 'mysql',
    
    // Other
    '.r': 'r',
    '.R': 'r',
    '.lua': 'lua',
    '.pl': 'perl',
    '.pm': 'perl',
    '.tcl': 'tcl',
    '.vim': 'vim',
    '.asm': 'assembly',
    '.s': 'assembly',
  };

  return languageMap[ext];
}

/**
 * Calculate complexity score for a file based on various factors
 */
export function calculateFileComplexity(
  filePath: string,
  addedLines: number,
  removedLines: number,
  content?: string
): number {
  let complexity = 0;
  
  // Base complexity from line changes
  complexity += Math.sqrt(addedLines + removedLines);
  
  // Language-specific multipliers
  const language = detectLanguage(filePath);
  const languageMultipliers: Record<string, number> = {
    'assembly': 3.0,
    'cpp': 2.5,
    'c': 2.5,
    'rust': 2.0,
    'java': 1.8,
    'csharp': 1.8,
    'typescript': 1.5,
    'javascript': 1.5,
    'python': 1.3,
    'go': 1.3,
    'php': 1.2,
    'ruby': 1.2,
    'css': 0.8,
    'html': 0.7,
    'markdown': 0.5,
    'json': 0.3,
    'yaml': 0.3,
  };
  
  if (language && languageMultipliers[language]) {
    complexity *= languageMultipliers[language];
  }
  
  // File type complexity
  if (filePath.includes('test') || filePath.includes('spec')) {
    complexity *= 0.8; // Tests are generally less complex
  }
  
  if (filePath.includes('config') || filePath.includes('setting')) {
    complexity *= 0.6; // Config files are less complex
  }
  
  // Content-based complexity (if available)
  if (content) {
    const lines = content.split('\n');
    
    // Count complex patterns
    let complexPatterns = 0;
    const complexRegexes = [
      /for\s*\(/g,        // Loops
      /while\s*\(/g,      // Loops
      /if\s*\(/g,         // Conditionals
      /switch\s*\(/g,     // Switch statements
      /try\s*\{/g,        // Exception handling
      /catch\s*\(/g,      // Exception handling
      /async\s+/g,        // Async operations
      /await\s+/g,        // Async operations
      /Promise\s*[<.]/g,  // Promises
      /function\s*\*/g,   // Generators
      /class\s+/g,        // Classes
      /interface\s+/g,    // Interfaces
    ];
    
    complexRegexes.forEach(regex => {
      const matches = content.match(regex);
      if (matches) {
        complexPatterns += matches.length;
      }
    });
    
    complexity += complexPatterns * 0.5;
  }
  
  return Math.round(complexity * 10) / 10; // Round to 1 decimal place
}

/**
 * Generate a summary of commit changes
 */
export function generateCommitSummary(
  message: string,
  files: Array<{ path: string; change_type: string; added_lines: number; removed_lines: number; language?: string }>
): {
  summary: string;
  impact: 'low' | 'medium' | 'high';
  categories: string[];
  keyFiles: string[];
} {
  const conventional = parseConventionalCommit(message);
  const totalFiles = files.length;
  const totalChanges = files.reduce((sum, f) => sum + f.added_lines + f.removed_lines, 0);
  
  // Determine impact level
  let impact: 'low' | 'medium' | 'high' = 'low';
  if (totalChanges > 500 || totalFiles > 20) {
    impact = 'high';
  } else if (totalChanges > 100 || totalFiles > 5) {
    impact = 'medium';
  }
  
  // Categorize changes
  const categories: Set<string> = new Set();
  
  if (conventional.isValid) {
    categories.add(conventional.type);
  }
  
  // Analyze file types
  const languages = new Set(files.map(f => f.language).filter(Boolean));
  languages.forEach(lang => categories.add(lang!));
  
  // Analyze change types
  const changeTypes = new Set(files.map(f => f.change_type));
  if (changeTypes.has('A')) categories.add('additions');
  if (changeTypes.has('D')) categories.add('deletions');
  if (changeTypes.has('M')) categories.add('modifications');
  if (changeTypes.has('R')) categories.add('renames');
  
  // Find key files (high impact changes)
  const keyFiles = files
    .filter(f => f.added_lines + f.removed_lines > 50)
    .map(f => f.path)
    .slice(0, 5);
  
  // Generate summary
  const fileDesc = totalFiles === 1 ? '1 file' : `${totalFiles} files`;
  const changeDesc = totalChanges === 1 ? '1 change' : `${totalChanges} changes`;
  
  let summary = `${conventional.isValid ? conventional.type : 'Change'}: ${fileDesc}, ${changeDesc}`;
  
  if (conventional.breaking) {
    summary += ' [BREAKING]';
  }
  
  if (keyFiles.length > 0) {
    summary += ` (${keyFiles[0]}${keyFiles.length > 1 ? ` +${keyFiles.length - 1}` : ''})`;
  }
  
  return {
    summary,
    impact,
    categories: Array.from(categories),
    keyFiles,
  };
}

/**
 * Validate commit hash format
 */
export function isValidCommitHash(hash: string): boolean {
  return /^[a-f0-9]{7,40}$/i.test(hash);
}

/**
 * Shorten commit hash for display
 */
export function shortenCommitHash(hash: string, length = 7): string {
  return hash.substring(0, length);
}

/**
 * Parse git author string "Name <email>"
 */
export function parseGitAuthor(authorString: string): {
  name: string;
  email: string;
} {
  const match = authorString.match(/^(.+)\s+<(.+)>$/);
  if (match) {
    return {
      name: match[1].trim(),
      email: match[2].trim(),
    };
  }
  
  return {
    name: authorString.trim(),
    email: '',
  };
}

/**
 * Check if commit is a merge commit
 */
export function isMergeCommit(parents: string[]): boolean {
  return parents.length > 1;
}

/**
 * Extract ticket/issue references from commit message
 */
export function extractTicketReferences(message: string): string[] {
  const patterns = [
    /#(\d+)/g,           // GitHub issues: #123
    /JIRA-(\d+)/gi,      // JIRA tickets: JIRA-123
    /([A-Z]+-\d+)/g,     // Generic tickets: ABC-123
    /fixes?\s+#(\d+)/gi, // Fixes #123
    /closes?\s+#(\d+)/gi, // Closes #123
  ];
  
  const references: Set<string> = new Set();
  
  patterns.forEach(pattern => {
    const matches = message.match(pattern);
    if (matches) {
      matches.forEach(match => {
        references.add(match.replace(/^(fixes?|closes?)\s+/i, ''));
      });
    }
  });
  
  return Array.from(references);
}
