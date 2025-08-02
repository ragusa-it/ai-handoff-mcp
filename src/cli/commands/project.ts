import { Command } from 'commander';
import { ProjectModel, CreateProjectData, ProjectConfig } from '../../models/Project.js';
import { Database, createDatabaseFromEnv } from '../../config/database.js';
import { logger } from '../../services/structuredLogger.js';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';

interface CliConfig {
  defaultProject?: string;
  agent?: string;
  apiBaseUrl?: string;
}

export class ProjectCLI {
  private db: Database;
  private projectModel: ProjectModel;
  private config: CliConfig;

  constructor() {
    this.db = createDatabaseFromEnv();
    this.projectModel = new ProjectModel(this.db);
    this.config = this.loadCliConfig();
  }

  private loadCliConfig(): CliConfig {
    try {
      const configPath = resolve(process.env.HOME || '~', '.handoff', 'config.json');
      if (existsSync(configPath)) {
        return JSON.parse(require('fs').readFileSync(configPath, 'utf8'));
      }
    } catch (error) {
      logger.debug('No CLI config found, using defaults');
    }
    return {};
  }

  private saveCliConfig(): void {
    try {
      const configDir = resolve(process.env.HOME || '~', '.handoff');
      const configPath = resolve(configDir, 'config.json');
      
      if (!existsSync(configDir)) {
        require('fs').mkdirSync(configDir, { recursive: true });
      }
      
      require('fs').writeFileSync(configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      logger.error('Failed to save CLI config', { error });
    }
  }

  async createProject(options: {
    name: string;
    repo?: string;
    description?: string;
    interactive?: boolean;
  }): Promise<void> {
    try {
      let projectData: CreateProjectData;

      if (options.interactive) {
        projectData = await this.interactiveProjectCreation();
      } else {
        // Validate required fields
        if (!options.name) {
          console.error(chalk.red('Error: Project name is required'));
          process.exit(1);
        }

        const repoPath = options.repo || process.cwd();
        
        // Validate repository path
        const validation = this.validateRepoPath(repoPath);
        if (!validation.valid) {
          console.error(chalk.red(`Error: ${validation.error}`));
          process.exit(1);
        }

        projectData = {
          name: options.name,
          description: options.description,
          repo_path: resolve(repoPath),
          config: this.getDefaultConfig(),
        };
      }

      console.log(chalk.blue('Creating project...'));
      
      const project = await this.projectModel.create(projectData);
      
      console.log(chalk.green('✅ Project created successfully!'));
      console.log(chalk.gray('Project ID:'), project.id);
      console.log(chalk.gray('Name:'), project.name);
      console.log(chalk.gray('Repository:'), project.repo_path);
      
      // Set as default project if none is set
      if (!this.config.defaultProject) {
        this.config.defaultProject = project.id;
        this.saveCliConfig();
        console.log(chalk.blue('📌 Set as default project'));
      }

    } catch (error: any) {
      logger.error('Failed to create project', { error });
      
      if (error.code === '23505') { // Unique constraint violation
        console.error(chalk.red('Error: Repository path already in use by another project'));
      } else if (error.name === 'ZodError') {
        console.error(chalk.red('Error: Invalid project data'));
        error.errors.forEach((err: any) => {
          console.error(chalk.red(`  - ${err.path.join('.')}: ${err.message}`));
        });
      } else {
        console.error(chalk.red(`Error: ${error.message}`));
      }
      process.exit(1);
    }
  }

  async listProjects(options: {
    limit?: number;
    search?: string;
    verbose?: boolean;
  }): Promise<void> {
    try {
      const result = await this.projectModel.findAll({
        limit: options.limit || 20,
        search: options.search,
        sort_by: 'updated_at',
        sort_order: 'desc',
      });

      if (result.projects.length === 0) {
        console.log(chalk.yellow('No projects found'));
        console.log(chalk.gray('Create your first project with: handoff project create <name>'));
        return;
      }

      console.log(chalk.bold(`\nFound ${result.total} project(s):\n`));

      for (const project of result.projects) {
        const isDefault = project.id === this.config.defaultProject;
        const prefix = isDefault ? chalk.blue('📌') : '  ';
        
        console.log(`${prefix} ${chalk.bold(project.name)} ${chalk.gray(`(${project.id.substring(0, 8)}...)`)}`);
        
        if (options.verbose) {
          console.log(chalk.gray(`     Repository: ${project.repo_path}`));
          if (project.description) {
            console.log(chalk.gray(`     Description: ${project.description}`));
          }
          console.log(chalk.gray(`     Created: ${project.created_at.toLocaleDateString()}`));
          console.log(chalk.gray(`     Updated: ${project.updated_at.toLocaleDateString()}`));
        } else {
          console.log(chalk.gray(`     ${project.repo_path}`));
        }
        
        console.log(); // Empty line
      }

      if (result.total > result.projects.length) {
        console.log(chalk.gray(`Showing ${result.projects.length} of ${result.total} projects`));
        console.log(chalk.gray('Use --limit to see more results'));
      }

    } catch (error) {
      logger.error('Failed to list projects', { error });
      console.error(chalk.red('Error: Failed to list projects'));
      process.exit(1);
    }
  }

  async showProject(projectId: string, options: { stats?: boolean }): Promise<void> {
    try {
      let project;
      
      if (options.stats) {
        project = await this.projectModel.getWithStats(projectId);
      } else {
        project = await this.projectModel.findById(projectId);
      }

      if (!project) {
        console.error(chalk.red(`Error: Project not found: ${projectId}`));
        process.exit(1);
      }

      const isDefault = project.id === this.config.defaultProject;
      
      console.log(chalk.bold(`\n${project.name}`) + (isDefault ? chalk.blue(' (default)') : ''));
      console.log(chalk.gray('─'.repeat(project.name.length + (isDefault ? 10 : 0))));
      
      console.log(chalk.gray('ID:'), project.id);
      console.log(chalk.gray('Repository:'), project.repo_path);
      
      if (project.description) {
        console.log(chalk.gray('Description:'), project.description);
      }
      
      console.log(chalk.gray('Created:'), project.created_at.toLocaleString());
      console.log(chalk.gray('Updated:'), project.updated_at.toLocaleString());

      // Show statistics if available
      if ('stats' in project) {
        console.log(chalk.bold('\nStatistics:'));
        console.log(chalk.gray('Commits:'), project.stats.total_commits);
        console.log(chalk.gray('Memories:'), project.stats.total_memories);
        console.log(chalk.gray('Tasks:'), project.stats.total_tasks);
        console.log(chalk.gray('Active Sessions:'), project.stats.active_sessions);
        
        if (project.stats.last_activity_at) {
          console.log(chalk.gray('Last Activity:'), project.stats.last_activity_at.toLocaleString());
        }
      }

      // Show configuration
      if (Object.keys(project.config).length > 0) {
        console.log(chalk.bold('\nConfiguration:'));
        console.log(JSON.stringify(project.config, null, 2));
      }

    } catch (error) {
      logger.error('Failed to show project', { projectId, error });
      console.error(chalk.red('Error: Failed to retrieve project'));
      process.exit(1);
    }
  }

  async setDefaultProject(projectId: string): Promise<void> {
    try {
      // Verify project exists
      const project = await this.projectModel.findById(projectId);
      if (!project) {
        console.error(chalk.red(`Error: Project not found: ${projectId}`));
        process.exit(1);
      }

      this.config.defaultProject = projectId;
      this.saveCliConfig();

      console.log(chalk.green('✅ Default project updated'));
      console.log(chalk.gray('Project:'), project.name);
      console.log(chalk.gray('ID:'), projectId);

    } catch (error) {
      logger.error('Failed to set default project', { projectId, error });
      console.error(chalk.red('Error: Failed to set default project'));
      process.exit(1);
    }
  }

  async setRepoPath(projectId: string, repoPath: string): Promise<void> {
    try {
      const resolvedPath = resolve(repoPath);
      
      // Validate repository path
      const validation = this.validateRepoPath(resolvedPath);
      if (!validation.valid) {
        console.error(chalk.red(`Error: ${validation.error}`));
        process.exit(1);
      }

      const project = await this.projectModel.update(projectId, {
        repo_path: resolvedPath,
      });

      if (!project) {
        console.error(chalk.red(`Error: Project not found: ${projectId}`));
        process.exit(1);
      }

      console.log(chalk.green('✅ Repository path updated'));
      console.log(chalk.gray('Project:'), project.name);
      console.log(chalk.gray('New Path:'), project.repo_path);

    } catch (error: any) {
      logger.error('Failed to set repo path', { projectId, repoPath, error });
      
      if (error.code === '23505') {
        console.error(chalk.red('Error: Repository path already in use by another project'));
      } else {
        console.error(chalk.red('Error: Failed to update repository path'));
      }
      process.exit(1);
    }
  }

  async deleteProject(projectId: string, options: { force?: boolean }): Promise<void> {
    try {
      const project = await this.projectModel.findById(projectId);
      if (!project) {
        console.error(chalk.red(`Error: Project not found: ${projectId}`));
        process.exit(1);
      }

      if (!options.force) {
        const projectWithStats = await this.projectModel.getWithStats(projectId);
        const hasData = projectWithStats && (
          projectWithStats.stats.total_commits > 0 ||
          projectWithStats.stats.total_memories > 0 ||
          projectWithStats.stats.total_tasks > 0 ||
          projectWithStats.stats.active_sessions > 0
        );

        if (hasData) {
          console.log(chalk.yellow('⚠️  Project has related data:'));
          console.log(chalk.gray('Commits:'), projectWithStats!.stats.total_commits);
          console.log(chalk.gray('Memories:'), projectWithStats!.stats.total_memories);
          console.log(chalk.gray('Tasks:'), projectWithStats!.stats.total_tasks);
          console.log(chalk.gray('Active Sessions:'), projectWithStats!.stats.active_sessions);
          console.log(chalk.yellow('Use --force to delete anyway'));
          process.exit(1);
        }

        // Confirm deletion
        const { confirmed } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmed',
            message: `Are you sure you want to delete project "${project.name}"?`,
            default: false,
          },
        ]);

        if (!confirmed) {
          console.log(chalk.gray('Deletion cancelled'));
          return;
        }
      }

      const deleted = await this.projectModel.delete(projectId);
      
      if (!deleted) {
        console.error(chalk.red('Error: Failed to delete project'));
        process.exit(1);
      }

      // Remove from default if it was the default
      if (this.config.defaultProject === projectId) {
        delete this.config.defaultProject;
        this.saveCliConfig();
      }

      console.log(chalk.green('✅ Project deleted successfully'));
      console.log(chalk.gray('Project:'), project.name);

    } catch (error) {
      logger.error('Failed to delete project', { projectId, error });
      console.error(chalk.red('Error: Failed to delete project'));
      process.exit(1);
    }
  }

  private async interactiveProjectCreation(): Promise<CreateProjectData> {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Project name:',
        validate: (input: string) => input.trim().length > 0 || 'Project name is required',
      },
      {
        type: 'input',
        name: 'description',
        message: 'Description (optional):',
      },
      {
        type: 'input',
        name: 'repo_path',
        message: 'Repository path:',
        default: process.cwd(),
        validate: (input: string) => {
          const validation = this.validateRepoPath(input);
          return validation.valid || validation.error!;
        },
      },
      {
        type: 'confirm',
        name: 'semantic_search',
        message: 'Enable semantic memory search?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'auto_scan',
        message: 'Enable automatic git scanning?',
        default: true,
      },
    ]);

    return {
      name: answers.name.trim(),
      description: answers.description.trim() || undefined,
      repo_path: resolve(answers.repo_path),
      config: {
        memory: {
          semantic_search_enabled: answers.semantic_search,
          embedding_model: 'openai' as const,
          memory_retention_days: 90,
          auto_consolidation: true,
        },
        git: {
          auto_scan_enabled: answers.auto_scan,
          scan_interval_hours: 24,
          track_branches: ['main', 'master', 'develop'],
          ignore_patterns: ['node_modules/**', '*.log', '.env*'],
        },
      },
    };
  }

  private validateRepoPath(repoPath: string): { valid: boolean; error?: string } {
    try {
      const resolvedPath = resolve(repoPath);

      if (!existsSync(resolvedPath)) {
        return { valid: false, error: 'Path does not exist' };
      }

      const stats = statSync(resolvedPath);
      if (!stats.isDirectory()) {
        return { valid: false, error: 'Path is not a directory' };
      }

      const gitPath = resolve(resolvedPath, '.git');
      if (!existsSync(gitPath)) {
        return { valid: false, error: 'Not a git repository (no .git directory found)' };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: 'Failed to validate repository path' };
    }
  }

  private getDefaultConfig(): ProjectConfig {
    return {
      memory: {
        semantic_search_enabled: true,
        embedding_model: 'openai',
        memory_retention_days: 90,
        auto_consolidation: true,
      },
      steering: {
        default_persona: 'general',
        constraint_enforcement: 'flexible',
        user_preference_learning: true,
        dynamic_prompting: true,
      },
      handoff: {
        default_workflow: 'standard',
        auto_filtering: true,
        privacy_mode: 'balanced',
        audit_required: false,
      },
      collaboration: {
        multi_user_enabled: false,
        real_time_sync: false,
        access_control: 'owner',
      },
      git: {
        auto_scan_enabled: true,
        scan_interval_hours: 24,
        track_branches: ['main', 'master', 'develop'],
        ignore_patterns: ['node_modules/**', '*.log', '.env*'],
        max_commit_history: 1000,
      },
    };
  }
}

// Create CLI commands
export function createProjectCommands(): Command {
  const projectCLI = new ProjectCLI();
  const program = new Command('project');

  program
    .description('Project management commands')
    .alias('p');

  // Create project command
  program
    .command('create <name>')
    .description('Create a new project')
    .option('-r, --repo <path>', 'Repository path (default: current directory)')
    .option('-d, --description <desc>', 'Project description')
    .option('-i, --interactive', 'Interactive project creation')
    .action(async (name: string, options: any) => {
      await projectCLI.createProject({
        name,
        repo: options.repo,
        description: options.description,
        interactive: options.interactive,
      });
    });

  // List projects command
  program
    .command('list')
    .alias('ls')
    .description('List all projects')
    .option('-l, --limit <number>', 'Maximum number of projects to show', '20')
    .option('-s, --search <term>', 'Search projects by name or description')
    .option('-v, --verbose', 'Show detailed information')
    .action(async (options: any) => {
      await projectCLI.listProjects({
        limit: parseInt(options.limit),
        search: options.search,
        verbose: options.verbose,
      });
    });

  // Show project command
  program
    .command('show <id>')
    .description('Show detailed project information')
    .option('--stats', 'Include project statistics')
    .action(async (id: string, options: any) => {
      await projectCLI.showProject(id, {
        stats: options.stats,
      });
    });

  // Set default project command
  program
    .command('default <id>')
    .description('Set default project')
    .action(async (id: string) => {
      await projectCLI.setDefaultProject(id);
    });

  // Set repository path command
  program
    .command('set-repo <id> <path>')
    .description('Update project repository path')
    .action(async (id: string, path: string) => {
      await projectCLI.setRepoPath(id, path);
    });

  // Delete project command
  program
    .command('delete <id>')
    .alias('rm')
    .description('Delete a project')
    .option('-f, --force', 'Force deletion without confirmation')
    .action(async (id: string, options: any) => {
      await projectCLI.deleteProject(id, {
        force: options.force,
      });
    });

  return program;
}
