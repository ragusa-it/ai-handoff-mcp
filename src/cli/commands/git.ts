import { Command } from 'commander';
import chalk from 'chalk';
import { z } from 'zod';
import { Database } from '../../config/database.js';
import { RedisManager } from '../../config/redis.js';
import { CommitModel } from '../../models/Commit.js';
import { ProjectModel } from '../../models/Project.js';
import { GitService } from '../../services/GitService.js';
import { GitScanJob } from '../../jobs/GitScanJob.js';
import { logger } from '../../services/structuredLogger.js';
import { 
  parseConventionalCommit, 
  shortenCommitHash, 
  generateCommitSummary 
} from '../../utils/gitUtils.js';

/**
 * CLI commands for git repository management and analysis
 */

export class GitCLI {
  private db: Database;
  private redis: RedisManager;
  private commitModel: CommitModel;
  private projectModel: ProjectModel;
  private gitService: GitService;
  private gitScanJob: GitScanJob;

  constructor(db: Database, redis: RedisManager) {
    this.db = db;
    this.redis = redis;
    this.commitModel = new CommitModel(db);
    this.projectModel = new ProjectModel(db);
    this.gitService = new GitService(db);
    this.gitScanJob = new GitScanJob(db, redis);
  }

  /**
   * Create git command group
   */
  createCommand(): Command {
    const gitCmd = new Command('git')
      .description('Git repository management and analysis commands');

    // Scan command
    gitCmd
      .command('scan')
      .description('Scan a git repository to extract commits and changes')
      .option('-p, --project <project-id>', 'Project ID or name')
      .option('-b, --branch <branch>', 'Branch to scan (default: main/master)')
      .option('-s, --since <date>', 'Scan commits since this date (YYYY-MM-DD)')
      .option('-m, --max-commits <number>', 'Maximum commits to scan', '1000')
      .option('--no-files', 'Skip file change analysis')
      .option('--no-diffs', 'Skip diff content analysis')
      .option('-f, --force', 'Force rescan even if in progress')
      .action(async (options) => {
        await this.scanRepository(options);
      });

    // Status command
    gitCmd
      .command('status')
      .description('Check git scan status')
      .argument('[scan-id]', 'Scan ID to check (optional)')
      .action(async (scanId) => {
        await this.getScanStatus(scanId);
      });

    // Commits command
    gitCmd
      .command('commits')
      .description('List commits for a project')
      .option('-p, --project <project-id>', 'Project ID or name')
      .option('-l, --limit <number>', 'Number of commits to show', '20')
      .option('-a, --author <author>', 'Filter by author name')
      .option('--details', 'Show detailed commit information')
      .action(async (options) => {
        await this.listCommits(options);
      });

    // Show command
    gitCmd
      .command('show')
      .description('Show detailed commit information')
      .argument('<commit-id>', 'Commit hash or short hash')
      .option('--stats', 'Show commit statistics only')
      .action(async (commitId, options) => {
        await this.showCommit(commitId, options);
      });

    return gitCmd;
  }

  /**
   * Scan repository command
   */
  private async scanRepository(options: any): Promise<void> {
    try {
      const project = await this.getProjectFromOption(options.project);
      if (!project) return;

      if (!project.git_repo_path) {
        console.log(chalk.red('❌ Project does not have a git repository configured'));
        return;
      }

      console.log(chalk.blue('🔍 Starting git repository scan...'));
      console.log(chalk.gray(`Project: ${project.name} (${project.id})`));

      const scanOptions = {
        projectId: project.id,
        repositoryPath: project.git_repo_path,
        branch: options.branch,
        since: options.since ? new Date(options.since) : undefined,
        maxCommits: parseInt(options.maxCommits),
        includeFiles: options.files !== false,
        includeDiffs: options.diffs !== false,
      };

      const scanId = `cli_scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      await this.gitScanJob.queueScan({
        scanId,
        projectId: project.id,
        options: scanOptions,
        priority: 'normal',
      });

      console.log(chalk.green('✅ Git scan queued successfully'));
      console.log(chalk.cyan(`📋 Scan ID: ${scanId}`));

    } catch (error) {
      console.log(chalk.red('❌ Failed to start git scan'));
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
    }
  }

  /**
   * Get scan status command
   */
  private async getScanStatus(scanId?: string): Promise<void> {
    try {
      if (scanId) {
        const statusKey = `git_scan_status:${scanId}`;
        const statusStr = await this.redis.get(statusKey);
        
        if (!statusStr) {
          console.log(chalk.red('❌ Scan not found or expired'));
          return;
        }

        const status = JSON.parse(statusStr);
        
        console.log(chalk.blue('📊 Git Scan Status'));
        console.log(`Status: ${this.formatStatus(status.status)}`);
        console.log(`Project: ${status.project_name || status.project_id}`);
        
        if (status.results) {
          console.log(`Scanned: ${status.results.scanned} commits`);
          console.log(`Created: ${status.results.created} new commits`);
        }
      }
    } catch (error) {
      console.log(chalk.red('❌ Failed to get scan status'));
    }
  }

  /**
   * List commits command
   */
  private async listCommits(options: any): Promise<void> {
    try {
      const project = await this.getProjectFromOption(options.project);
      if (!project) return;

      const query = {
        project_id: project.id,
        limit: parseInt(options.limit),
        author: options.author,
      };

      const result = await this.commitModel.findByProject(query);
      
      if (result.commits.length === 0) {
        console.log(chalk.yellow('📭 No commits found'));
        return;
      }

      console.log(chalk.blue(`📝 Commits for ${project.name}`));
      
      result.commits.forEach(commit => {
        const shortHash = shortenCommitHash(commit.commit_id);
        const message = commit.message.split('\n')[0];
        
        console.log(`${chalk.yellow(shortHash)} ${chalk.cyan(commit.author_name)} ${message}`);
        
        if (options.details) {
          console.log(chalk.gray(`  Files: ${commit.file_count}, +${commit.added_lines}/-${commit.removed_lines}`));
        }
      });

    } catch (error) {
      console.log(chalk.red('❌ Failed to list commits'));
    }
  }

  /**
   * Show commit details command
   */
  private async showCommit(commitId: string, options: any): Promise<void> {
    try {
      const commit = await this.commitModel.findById(commitId, true);
      
      if (!commit) {
        console.log(chalk.red('❌ Commit not found'));
        return;
      }

      console.log(chalk.blue('📝 Commit Details'));
      console.log(`Hash: ${commit.id}`);
      console.log(`Author: ${commit.author_name} <${commit.author_email}>`);
      console.log(`Date: ${commit.committed_at.toLocaleString()}`);
      console.log(`Message: ${commit.message}`);
      
      if (!options.stats && commit.files.length > 0) {
        console.log(chalk.blue('📁 Changed Files'));
        commit.files.forEach(file => {
          const symbol = this.getChangeTypeSymbol(file.change_type);
          console.log(`${symbol} ${file.path}`);
        });
      }

    } catch (error) {
      console.log(chalk.red('❌ Failed to show commit'));
    }
  }

  /**
   * Helper methods
   */
  private async getProjectFromOption(projectOption?: string): Promise<any> {
    if (!projectOption) {
      console.log(chalk.red('❌ Project ID or name is required'));
      return null;
    }

    const project = await this.projectModel.findById(projectOption) ||
                   await this.projectModel.findByName(projectOption);
    
    if (!project) {
      console.log(chalk.red('❌ Project not found'));
      return null;
    }

    return project;
  }

  private formatStatus(status: string): string {
    switch (status) {
      case 'running': return chalk.yellow('🔄 Running');
      case 'completed': return chalk.green('✅ Completed');
      case 'failed': return chalk.red('❌ Failed');
      case 'queued': return chalk.blue('⏳ Queued');
      default: return status;
    }
  }

  private getChangeTypeSymbol(changeType: string): string {
    switch (changeType) {
      case 'A': return chalk.green('+ ');
      case 'M': return chalk.yellow('~ ');
      case 'D': return chalk.red('- ');
      case 'R': return chalk.blue('→ ');
      default: return '  ';
    }
  }

  private getTypeColor(type: string) {
    const colors: Record<string, typeof chalk.green> = {
      feat: chalk.green,
      fix: chalk.red,
      docs: chalk.blue,
      style: chalk.magenta,
      refactor: chalk.yellow,
      perf: chalk.orange,
      test: chalk.cyan,
      chore: chalk.gray,
    };
    return colors[type] || chalk.white;
  }
}
