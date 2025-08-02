import * as git from 'isomorphic-git';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './structuredLogger.js';
import { CommitModel, CreateCommitData, CreateCommitFileData } from '../models/Commit.js';
import { Database } from '../config/database.js';

export interface GitScanOptions {
  projectId: string;
  repositoryPath: string;
  branch?: string;
  since?: Date;
  maxCommits?: number;
  includeFiles?: boolean;
  includeDiffs?: boolean;
}

export interface GitCommitInfo {
  oid: string;
  commit: {
    author: {
      name: string;
      email: string;
      timestamp: number;
    };
    committer: {
      name: string;
      email: string;
      timestamp: number;
    };
    message: string;
    parent: string[];
    tree: string;
  };
}

export interface FileChange {
  path: string;
  changeType: 'A' | 'M' | 'D' | 'R' | 'C' | 'T';
  language?: string;
  addedLines: number;
  removedLines: number;
  hunkPreview?: string;
  oldPath?: string; // For renames
}

export interface GitDiffResult {
  commit: GitCommitInfo;
  files: FileChange[];
  stats: {
    totalFiles: number;
    addedLines: number;
    removedLines: number;
    languages: Record<string, number>;
  };
}

export class GitService {
  private db: Database;
  private commitModel: CommitModel;

  constructor(db: Database) {
    this.db = db;
    this.commitModel = new CommitModel(db);
  }

  /**
   * Scan a git repository and extract commits with file changes
   */
  async scanRepository(options: GitScanOptions): Promise<{
    scanned: number;
    created: number;
    updated: number;
    errors: string[];
  }> {
    const {
      projectId,
      repositoryPath,
      branch = 'main',
      since,
      maxCommits = 1000,
      includeFiles = true,
      includeDiffs = true,
    } = options;

    logger.info('Starting git repository scan', {
      projectId,
      repositoryPath,
      branch,
      since,
      maxCommits,
    });

    const results = {
      scanned: 0,
      created: 0,
      updated: 0,
      errors: [] as string[],
    };

    try {
      // Verify repository exists and is valid
      if (!await this.isValidRepository(repositoryPath)) {
        throw new Error(`Invalid git repository at ${repositoryPath}`);
      }

      // Get branch references
      const branches = await this.getBranches(repositoryPath, branch);
      logger.info('Found branches', { branches: branches.slice(0, 5) });

      // Get commit log
      const commits = await this.getCommitLog(repositoryPath, {
        ref: branch,
        since,
        maxCommits,
      });

      logger.info('Found commits', { count: commits.length });

      // Process commits in batches
      const batchSize = 50;
      for (let i = 0; i < commits.length; i += batchSize) {
        const batch = commits.slice(i, i + batchSize);
        
        for (const commitInfo of batch) {
          try {
            results.scanned++;

            // Get commit details with files
            const diffResult = includeFiles 
              ? await this.getCommitDiff(repositoryPath, commitInfo.oid, includeDiffs)
              : { commit: commitInfo, files: [], stats: { totalFiles: 0, addedLines: 0, removedLines: 0, languages: {} } };

            // Convert to our format
            const commitData: CreateCommitData = {
              id: commitInfo.oid,
              project_id: projectId,
              author_name: commitInfo.commit.author.name,
              author_email: commitInfo.commit.author.email,
              committed_at: new Date(commitInfo.commit.committer.timestamp * 1000),
              message: commitInfo.commit.message.trim(),
              parents: commitInfo.commit.parent,
              branches: branches.filter(b => await this.commitExistsOnBranch(repositoryPath, commitInfo.oid, b)),
              metadata: {
                tree: commitInfo.commit.tree,
                committer: {
                  name: commitInfo.commit.committer.name,
                  email: commitInfo.commit.committer.email,
                  timestamp: commitInfo.commit.committer.timestamp,
                },
              },
            };

            const fileData: CreateCommitFileData[] = diffResult.files.map(file => ({
              commit_id: commitInfo.oid,
              path: file.path,
              change_type: file.changeType,
              language: file.language,
              added_lines: file.addedLines,
              removed_lines: file.removedLines,
              hunk_preview: file.hunkPreview,
            }));

            // Create or update commit
            const existingCommit = await this.commitModel.findById(commitInfo.oid);
            if (existingCommit) {
              results.updated++;
            } else {
              results.created++;
            }

            await this.commitModel.create(commitData, fileData);

            if (results.scanned % 100 === 0) {
              logger.info('Git scan progress', {
                projectId,
                scanned: results.scanned,
                created: results.created,
                updated: results.updated,
              });
            }

          } catch (error) {
            const errorMsg = `Failed to process commit ${commitInfo.oid}: ${error}`;
            logger.error(errorMsg, { commitId: commitInfo.oid, error });
            results.errors.push(errorMsg);
          }
        }
      }

      logger.info('Git repository scan completed', {
        projectId,
        repositoryPath,
        results,
      });

      return results;

    } catch (error) {
      logger.error('Git repository scan failed', {
        projectId,
        repositoryPath,
        error,
      });
      throw error;
    }
  }

  /**
   * Get commit log with optional filtering
   */
  async getCommitLog(repositoryPath: string, options: {
    ref?: string;
    since?: Date;
    until?: Date;
    maxCommits?: number;
    author?: string;
  } = {}): Promise<GitCommitInfo[]> {
    const {
      ref = 'HEAD',
      since,
      until,
      maxCommits = 1000,
      author,
    } = options;

    try {
      const commits: GitCommitInfo[] = [];
      
      const logOptions: any = {
        fs,
        dir: repositoryPath,
        ref,
      };

      // Use git.log with filtering
      const gitCommits = await git.log(logOptions);

      for (const commitData of gitCommits) {
        // Apply filtering
        if (since && commitData.commit.committer.timestamp * 1000 < since.getTime()) {
          break; // Commits are in reverse chronological order
        }

        if (until && commitData.commit.committer.timestamp * 1000 > until.getTime()) {
          continue;
        }

        if (author && !commitData.commit.author.name.toLowerCase().includes(author.toLowerCase())) {
          continue;
        }

        commits.push(commitData);

        if (commits.length >= maxCommits) {
          break;
        }
      }

      return commits;

    } catch (error) {
      logger.error('Failed to get commit log', { repositoryPath, options, error });
      throw error;
    }
  }

  /**
   * Get diff information for a specific commit
   */
  async getCommitDiff(repositoryPath: string, commitId: string, includeDiffContent = false): Promise<GitDiffResult> {
    try {
      const commitInfo = await git.readCommit({
        fs,
        dir: repositoryPath,
        oid: commitId,
      });

      // Get commit tree
      const { tree: commitTree } = await git.readTree({
        fs,
        dir: repositoryPath,
        oid: commitInfo.commit.tree,
      });

      // Get parent tree (if exists)
      let parentTree: any[] = [];
      if (commitInfo.commit.parent.length > 0) {
        const parentCommit = await git.readCommit({
          fs,
          dir: repositoryPath,
          oid: commitInfo.commit.parent[0],
        });

        const parentTreeResult = await git.readTree({
          fs,
          dir: repositoryPath,
          oid: parentCommit.commit.tree,
        });
        parentTree = parentTreeResult.tree;
      }

      // Compare trees to find changes
      const files = await this.compareTreesForChanges(
        repositoryPath,
        parentTree,
        commitTree,
        includeDiffContent
      );

      // Calculate statistics
      const stats = {
        totalFiles: files.length,
        addedLines: files.reduce((sum, f) => sum + f.addedLines, 0),
        removedLines: files.reduce((sum, f) => sum + f.removedLines, 0),
        languages: {} as Record<string, number>,
      };

      files.forEach(file => {
        if (file.language) {
          stats.languages[file.language] = (stats.languages[file.language] || 0) + 1;
        }
      });

      return {
        commit: commitInfo,
        files,
        stats,
      };

    } catch (error) {
      logger.error('Failed to get commit diff', { repositoryPath, commitId, error });
      throw error;
    }
  }

  /**
   * Compare two trees to find file changes
   */
  private async compareTreesForChanges(
    repositoryPath: string,
    parentTree: any[],
    commitTree: any[],
    includeDiffContent: boolean
  ): Promise<FileChange[]> {
    const changes: FileChange[] = [];
    
    // Create maps for easier lookup
    const parentFiles = new Map(parentTree.map(entry => [entry.path, entry]));
    const commitFiles = new Map(commitTree.map(entry => [entry.path, entry]));

    // Find added and modified files
    for (const [path, entry] of commitFiles) {
      const parentEntry = parentFiles.get(path);
      
      if (!parentEntry) {
        // Added file
        const change: FileChange = {
          path,
          changeType: 'A',
          language: this.detectLanguage(path),
          addedLines: 0,
          removedLines: 0,
        };

        if (includeDiffContent && entry.type === 'blob') {
          try {
            const content = await this.getBlobContent(repositoryPath, entry.oid);
            change.addedLines = this.countLines(content);
            change.hunkPreview = this.generateHunkPreview(content, 'add');
          } catch (error) {
            logger.warn('Failed to get blob content for added file', { path, error });
          }
        }

        changes.push(change);
      } else if (entry.oid !== parentEntry.oid && entry.type === 'blob') {
        // Modified file
        const change: FileChange = {
          path,
          changeType: 'M',
          language: this.detectLanguage(path),
          addedLines: 0,
          removedLines: 0,
        };

        if (includeDiffContent) {
          try {
            const [oldContent, newContent] = await Promise.all([
              this.getBlobContent(repositoryPath, parentEntry.oid),
              this.getBlobContent(repositoryPath, entry.oid),
            ]);

            const diffStats = this.calculateDiffStats(oldContent, newContent);
            change.addedLines = diffStats.addedLines;
            change.removedLines = diffStats.removedLines;
            change.hunkPreview = diffStats.hunkPreview;
          } catch (error) {
            logger.warn('Failed to calculate diff for modified file', { path, error });
          }
        }

        changes.push(change);
      }
    }

    // Find deleted files
    for (const [path, entry] of parentFiles) {
      if (!commitFiles.has(path)) {
        const change: FileChange = {
          path,
          changeType: 'D',
          language: this.detectLanguage(path),
          addedLines: 0,
          removedLines: 0,
        };

        if (includeDiffContent && entry.type === 'blob') {
          try {
            const content = await this.getBlobContent(repositoryPath, entry.oid);
            change.removedLines = this.countLines(content);
            change.hunkPreview = this.generateHunkPreview(content, 'delete');
          } catch (error) {
            logger.warn('Failed to get blob content for deleted file', { path, error });
          }
        }

        changes.push(change);
      }
    }

    return changes;
  }

  /**
   * Get blob content as string
   */
  private async getBlobContent(repositoryPath: string, oid: string): Promise<string> {
    const { blob } = await git.readBlob({
      fs,
      dir: repositoryPath,
      oid,
    });

    return new TextDecoder().decode(blob);
  }

  /**
   * Calculate diff statistics between two text contents
   */
  private calculateDiffStats(oldContent: string, newContent: string): {
    addedLines: number;
    removedLines: number;
    hunkPreview: string;
  } {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    // Simple line-based diff (could be enhanced with proper diff algorithm)
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);

    const addedLines = newLines.filter(line => !oldSet.has(line)).length;
    const removedLines = oldLines.filter(line => !newSet.has(line)).length;

    // Generate hunk preview (first few changed lines)
    const changedLines = newLines.filter(line => !oldSet.has(line)).slice(0, 3);
    const hunkPreview = changedLines.length > 0 
      ? `+${changedLines.join('\n+')}` 
      : '';

    return {
      addedLines,
      removedLines,
      hunkPreview,
    };
  }

  /**
   * Generate hunk preview for added/deleted files
   */
  private generateHunkPreview(content: string, changeType: 'add' | 'delete'): string {
    const lines = content.split('\n').slice(0, 3);
    const prefix = changeType === 'add' ? '+' : '-';
    return lines.map(line => `${prefix}${line}`).join('\n');
  }

  /**
   * Count lines in content
   */
  private countLines(content: string): number {
    return content.split('\n').length;
  }

  /**
   * Detect programming language from file path
   */
  private detectLanguage(filePath: string): string | undefined {
    const ext = path.extname(filePath).toLowerCase();
    
    const languageMap: Record<string, string> = {
      '.js': 'javascript',
      '.ts': 'typescript',
      '.jsx': 'jsx',
      '.tsx': 'tsx',
      '.py': 'python',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
      '.cs': 'csharp',
      '.php': 'php',
      '.rb': 'ruby',
      '.go': 'go',
      '.rs': 'rust',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
      '.clj': 'clojure',
      '.hs': 'haskell',
      '.ml': 'ocaml',
      '.sql': 'sql',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.sass': 'sass',
      '.less': 'less',
      '.vue': 'vue',
      '.svelte': 'svelte',
      '.json': 'json',
      '.xml': 'xml',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.toml': 'toml',
      '.md': 'markdown',
      '.sh': 'bash',
      '.ps1': 'powershell',
      '.dockerfile': 'docker',
    };

    return languageMap[ext];
  }

  /**
   * Get all branches in the repository
   */
  async getBranches(repositoryPath: string, currentBranch?: string): Promise<string[]> {
    try {
      const branches = await git.listBranches({
        fs,
        dir: repositoryPath,
        remote: 'origin',
      });

      // Add current branch if specified and not in list
      if (currentBranch && !branches.includes(currentBranch)) {
        branches.unshift(currentBranch);
      }

      return branches;
    } catch (error) {
      logger.warn('Failed to get branches, using default', { repositoryPath, error });
      return currentBranch ? [currentBranch] : ['main', 'master'];
    }
  }

  /**
   * Check if a commit exists on a specific branch
   */
  async commitExistsOnBranch(repositoryPath: string, commitId: string, branch: string): Promise<boolean> {
    try {
      const commits = await git.log({
        fs,
        dir: repositoryPath,
        ref: branch,
        depth: 1000, // Reasonable depth to check
      });

      return commits.some(commit => commit.oid === commitId);
    } catch (error) {
      logger.warn('Failed to check commit existence on branch', { repositoryPath, commitId, branch, error });
      return false;
    }
  }

  /**
   * Validate if directory is a git repository
   */
  async isValidRepository(repositoryPath: string): Promise<boolean> {
    try {
      await git.findRoot({
        fs,
        filepath: repositoryPath,
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get repository status and health information
   */
  async getRepositoryInfo(repositoryPath: string): Promise<{
    isValid: boolean;
    currentBranch?: string;
    commitCount?: number;
    lastCommit?: {
      id: string;
      message: string;
      author: string;
      date: Date;
    };
    branches?: string[];
  }> {
    try {
      const isValid = await this.isValidRepository(repositoryPath);
      if (!isValid) {
        return { isValid: false };
      }

      const currentBranch = await git.currentBranch({
        fs,
        dir: repositoryPath,
        fullname: false,
      });

      const commits = await git.log({
        fs,
        dir: repositoryPath,
        depth: 1,
      });

      const branches = await this.getBranches(repositoryPath, currentBranch || undefined);

      const lastCommit = commits.length > 0 ? {
        id: commits[0].oid,
        message: commits[0].commit.message,
        author: commits[0].commit.author.name,
        date: new Date(commits[0].commit.committer.timestamp * 1000),
      } : undefined;

      const allCommits = await git.log({
        fs,
        dir: repositoryPath,
      });

      return {
        isValid: true,
        currentBranch: currentBranch || undefined,
        commitCount: allCommits.length,
        lastCommit,
        branches,
      };

    } catch (error) {
      logger.error('Failed to get repository info', { repositoryPath, error });
      return { isValid: false };
    }
  }
}
