import { z } from 'zod';
import { Database } from '../config/database.js';
import { MemoryModel, CreateMemoryData, MemoryType, MemorySource } from '../models/Memory.js';
import { CommitModel, Commit, CommitFile } from '../models/Commit.js';
import { EmbeddingService } from './EmbeddingService.js';
import { logger } from './structuredLogger.js';
import { 
  generateCommitSummary,
  detectLanguage,
  calculateFileComplexity 
} from '../utils/gitUtils.js';

/**
 * Extraction Service
 * 
 * Purpose: Generate Memory records from commits by extracting decisions and change 
 * summaries from commit messages and diffs. Optionally use LLM for richer summaries.
 * 
 * Adopts Python plan's approach with TypeScript implementation.
 * 
 * Public API:
 * - async extractCommitMemories(project_id: string, commit_hash: string) -> string[]
 * 
 * Internal:
 * - parseConventionalCommit(message: string) -> ParsedMsg
 * - buildMemoriesFromMessage(commit, parsed) -> MemoryDraft[]
 * - buildMemoriesFromDiff(commit, files) -> MemoryDraft[]
 * - maybeEnrichWithLLM(draft) -> MemoryDraft (optional)
 */

// Configuration
const ExtractionConfigSchema = z.object({
  // Thresholds
  diff_threshold: z.number().default(30), // Min lines changed for diff extraction
  max_memories_per_commit: z.number().default(5),
  critical_paths: z.array(z.string()).default([
    'src/auth/**',
    'src/api/**', 
    'migrations/**',
    'config/**',
    'schema/**'
  ]),
  
  // LLM settings
  llm_enabled: z.boolean().default(false),
  llm_provider: z.enum(['ollama', 'openai']).default('ollama'),
  llm_model: z.string().default('phi3:mini'),
  llm_base_url: z.string().default('http://localhost:11434'),
  
  // Content processing
  max_content_length: z.number().default(500),
  redaction_enabled: z.boolean().default(true),
  confidence_threshold: z.number().default(0.5),
});

type ExtractionConfig = z.infer<typeof ExtractionConfigSchema>;

// Internal types
interface ParsedConventionalCommit {
  type: string;
  scope?: string;
  description: string;
  breaking: boolean;
  issues: number[];
  isValid: boolean;
}

interface MemoryDraft {
  type: MemoryType;
  content: string;
  metadata: Record<string, any>;
  source: MemorySource;
  repo_paths: string[];
  commit_hashes: string[];
  extracted_from: 'message' | 'diff';
  confidence: number;
}

export interface ExtractionResult {
  memory_ids: string[];
  extraction_stats: {
    commit_hash: string;
    message_memories: number;
    diff_memories: number;
    total_memories: number;
    llm_enriched: number;
    processing_time_ms: number;
  };
}

export class ExtractionService {
  private db: Database;
  private memoryModel: MemoryModel;
  private commitModel: CommitModel;
  private embeddingService: EmbeddingService;
  private config: ExtractionConfig;

  constructor(
    db: Database, 
    embeddingService: EmbeddingService,
    config: Partial<ExtractionConfig> = {}
  ) {
    this.db = db;
    this.memoryModel = new MemoryModel(db);
    this.commitModel = new CommitModel(db);
    this.embeddingService = embeddingService;
    this.config = ExtractionConfigSchema.parse({
      ...this.getConfigFromEnv(),
      ...config,
    });

    logger.info('ExtractionService initialized', {
      diff_threshold: this.config.diff_threshold,
      llm_enabled: this.config.llm_enabled,
      llm_model: this.config.llm_model,
    });
  }

  /**
   * Extract memory records from a commit
   * 
   * Acceptance Criteria:
   * - For commit "feat(auth)!: add PKCE to OAuth flow" with auth file changes:
   *   - Creates a factual memory with breaking=true, component=auth
   *   - Creates an episodic memory summarizing the diff if threshold met
   * - Memory rows have correct project_id, commit_hashes[0]=commit, repo_paths set
   */
  async extractCommitMemories(projectId: string, commitHash: string): Promise<ExtractionResult> {
    const startTime = Date.now();
    
    logger.info('Starting commit memory extraction', {
      projectId,
      commitHash,
    });

    try {
      // Load commit and related files from DB
      const commit = await this.commitModel.findById(commitHash, true);
      if (!commit) {
        throw new Error(`Commit not found: ${commitHash}`);
      }

      if (commit.project_id !== projectId) {
        throw new Error(`Commit belongs to different project`);
      }

      const drafts: MemoryDraft[] = [];
      
      // Extract from commit message
      const messageDrafts = await this.buildMemoriesFromMessage(commit);
      drafts.push(...messageDrafts);

      // Extract from diff (if significant)
      const diffDrafts = await this.buildMemoriesFromDiff(commit, commit.files);
      drafts.push(...diffDrafts);

      // Apply LLM enrichment if enabled
      let enrichedCount = 0;
      if (this.config.llm_enabled) {
        for (const draft of drafts) {
          try {
            await this.enrichWithLLM(draft);
            enrichedCount++;
          } catch (error) {
            logger.warn('LLM enrichment failed', { 
              error: error instanceof Error ? error.message : String(error),
              commitHash 
            });
          }
        }
      }

      // Limit number of memories per commit
      const finalDrafts = drafts.slice(0, this.config.max_memories_per_commit);

      // Generate embeddings and create memories
      const memoryIds: string[] = [];
      
      for (const draft of finalDrafts) {
        try {
          // Get embedding for content
          const embeddingResult = await this.embeddingService.getEmbedding(draft.content);
          
          // Create memory
          const memoryData: CreateMemoryData = {
            project_id: projectId,
            type: draft.type,
            content: draft.content,
            embedding: embeddingResult.embedding,
            metadata: draft.metadata,
            source: draft.source,
            repo_paths: draft.repo_paths,
            commit_hashes: draft.commit_hashes,
            extracted_from: draft.extracted_from,
            confidence: draft.confidence,
            line_ranges: [], // Add missing required property
          };

          const memory = await this.memoryModel.create(memoryData);
          memoryIds.push(memory.id);

        } catch (error) {
          logger.error('Failed to create memory from draft', {
            error: error instanceof Error ? error.message : String(error),
            draft: { ...draft, content: draft.content.substring(0, 100) + '...' },
          });
        }
      }

      const result: ExtractionResult = {
        memory_ids: memoryIds,
        extraction_stats: {
          commit_hash: commitHash,
          message_memories: messageDrafts.length,
          diff_memories: diffDrafts.length,
          total_memories: memoryIds.length,
          llm_enriched: enrichedCount,
          processing_time_ms: Date.now() - startTime,
        },
      };

      logger.info('Commit memory extraction completed', result.extraction_stats);
      return result;

    } catch (error) {
      logger.error('Failed to extract commit memories', {
        error: error instanceof Error ? error.message : String(error),
        projectId,
        commitHash,
      });
      throw error;
    }
  }

  /**
   * Build memories from commit message
   * 
   * Heuristics:
   * - If type in {feat, fix, refactor, perf, docs, test, chore}
   * - Set memory.type = "factual"; content = normalized description
   * - If breaking or "!": metadata.breaking=true
   * - Scope -> metadata.component
   * - Issue refs: #123 into metadata.issues=[123]
   */
  private async buildMemoriesFromMessage(commit: Commit): Promise<MemoryDraft[]> {
    const drafts: MemoryDraft[] = [];
    
    const parsed = this.parseConventionalCommit(commit.message);
    
    if (!parsed.isValid) {
      // For non-conventional commits, create a simple factual memory
      const content = this.normalizeCommitMessage(commit.message);
      if (content.length > 10) {
        drafts.push({
          type: 'factual',
          content,
          metadata: {
            author: commit.author_name,
            is_conventional: false,
          },
          source: 'git',
          repo_paths: [],
          commit_hashes: [commit.id],
          extracted_from: 'message',
          confidence: 0.6,
        });
      }
      return drafts;
    }

    // Create factual memory from conventional commit
    const content = this.buildFactualContent(parsed, commit);
    
    const metadata: Record<string, any> = {
      conventional_type: parsed.type,
      scope: parsed.scope,
      component: parsed.scope,
      breaking: parsed.breaking,
      issues: parsed.issues,
      author: commit.author_name,
      is_conventional: true,
    };

    if (parsed.breaking) {
      metadata.breaking = true;
    }

    drafts.push({
      type: 'factual',
      content,
      metadata,
      source: 'git',
      repo_paths: [],
      commit_hashes: [commit.id],
      extracted_from: 'message',
      confidence: 0.8,
    });

    return drafts;
  }

  /**
   * Build memories from diff (only if significant)
   * 
   * Heuristics:
   * - If sum(added+removed) >= DIFF_THRESHOLD OR file path matches critical globs
   * - Create episodic memory summarizing intent
   * - repo_paths = unique changed paths (cap at 10)
   * - confidence lower (e.g., 0.7)
   */
  private async buildMemoriesFromDiff(commit: Commit, files: CommitFile[]): Promise<MemoryDraft[]> {
    const drafts: MemoryDraft[] = [];
    
    if (!files || files.length === 0) {
      return drafts;
    }

    // Calculate total changes
    const totalAdded = files.reduce((sum, f) => sum + f.added_lines, 0);
    const totalRemoved = files.reduce((sum, f) => sum + f.removed_lines, 0);
    const totalChanges = totalAdded + totalRemoved;

    // Check if any file matches critical paths
    const criticalFiles = files.filter(file => 
      this.config.critical_paths.some(pattern => 
        this.matchesPattern(file.path, pattern)
      )
    );

    const isSignificant = totalChanges >= this.config.diff_threshold || criticalFiles.length > 0;
    
    if (!isSignificant) {
      return drafts;
    }

    // Generate summary content
    const summary = this.generateDiffSummary(commit, files);
    
    // Collect unique changed paths (up to 10)
    const repoPaths = [...new Set(files.map(f => f.path))].slice(0, 10);
    
    // Detect primary languages
    const languages = new Set(files.map(f => f.language).filter(Boolean));
    
    // Calculate complexity score
    const complexity = files.reduce((sum, f) => 
      sum + calculateFileComplexity(f.path, f.added_lines, f.removed_lines), 0
    );

    const metadata: Record<string, any> = {
      total_files: files.length,
      added_lines: totalAdded,
      removed_lines: totalRemoved,
      languages: Array.from(languages),
      complexity_score: Math.round(complexity * 10) / 10,
      critical_files: criticalFiles.length,
      change_types: [...new Set(files.map(f => f.change_type))],
    };

    // Add file-specific metadata for critical changes
    if (criticalFiles.length > 0) {
      metadata.critical_changes = criticalFiles.map(f => ({
        path: f.path,
        change_type: f.change_type,
        lines: f.added_lines + f.removed_lines,
      }));
    }

    drafts.push({
      type: 'episodic',
      content: summary.summary,
      metadata,
      source: 'git',
      repo_paths: repoPaths,
      commit_hashes: [commit.id],
      extracted_from: 'diff',
      confidence: 0.7,
    });

    return drafts;
  }

  /**
   * Optional LLM enrichment for better content
   */
  private async enrichWithLLM(draft: MemoryDraft): Promise<void> {
    if (!this.config.llm_enabled) {
      return;
    }

    try {
      const prompt = this.buildEnrichmentPrompt(draft);
      const enrichedContent = await this.callLLM(prompt);
      
      if (enrichedContent && enrichedContent.length > 10) {
        draft.content = enrichedContent;
        draft.confidence = Math.min(draft.confidence + 0.1, 0.95);
        draft.metadata.llm_enriched = true;
        draft.metadata.llm_model = this.config.llm_model;
      }
    } catch (error) {
      logger.warn('LLM enrichment failed', { 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Helper methods
   */
  private parseConventionalCommit(message: string): ParsedConventionalCommit {
    const lines = message.trim().split('\n');
    const firstLine = lines[0];
    
    // Enhanced regex for conventional commit format
    const conventionalRegex = /^(feat|fix|docs|style|refactor|perf|test|chore|build|ci|revert)(\([^)]+\))?(!?):\s*(.+)$/;
    const match = firstLine.match(conventionalRegex);
    
    if (!match) {
      return {
        type: 'other',
        description: firstLine,
        breaking: message.includes('BREAKING CHANGE') || message.includes('!:'),
        issues: this.extractIssueRefs(message),
        isValid: false,
      };
    }

    const [, type, scopeMatch, breaking, description] = match;
    const scope = scopeMatch ? scopeMatch.slice(1, -1) : undefined;
    
    const body = lines.length > 1 ? lines.slice(1).join('\n').trim() : '';
    const hasBreaking = breaking === '!' || 
                       (body && body.includes('BREAKING CHANGE')) ||
                       message.includes('BREAKING CHANGE');

    const result: ParsedConventionalCommit = {
      type,
      description: description.trim(),
      breaking: hasBreaking,
      issues: this.extractIssueRefs(message),
      isValid: true,
    };
    
    // Only add scope if it's not undefined to satisfy exactOptionalPropertyTypes
    if (scope !== undefined) {
      result.scope = scope;
    }
    
    return result;
  }

  private extractIssueRefs(message: string): number[] {
    const patterns = [
      /#(\d+)/g,           // GitHub issues: #123
      /fixes?\s+#(\d+)/gi, // Fixes #123
      /closes?\s+#(\d+)/gi, // Closes #123
    ];
    
    const issues = new Set<number>();
    
    patterns.forEach(pattern => {
      const matches = message.matchAll(pattern);
      for (const match of matches) {
        const issueNum = parseInt(match[1]);
        if (!isNaN(issueNum)) {
          issues.add(issueNum);
        }
      }
    });
    
    return Array.from(issues);
  }

  private normalizeCommitMessage(message: string): string {
    const firstLine = message.split('\n')[0].trim();
    
    // Remove common prefixes
    const cleanedMessage = firstLine
      .replace(/^(WIP|wip|fix|Fix|update|Update|add|Add|remove|Remove):\s*/i, '')
      .replace(/^\s*[-*]\s*/, '') // Remove bullet points
      .trim();

    // Ensure it starts with capital and ends properly
    let normalized = cleanedMessage.charAt(0).toUpperCase() + cleanedMessage.slice(1);
    
    if (!/[.!?]$/.test(normalized)) {
      normalized += '.';
    }

    return normalized.substring(0, this.config.max_content_length);
  }

  private buildFactualContent(parsed: ParsedConventionalCommit, _commit: Commit): string {
    let content = `${parsed.type}: ${parsed.description}`;
    
    if (parsed.scope) {
      content = `${parsed.type}(${parsed.scope}): ${parsed.description}`;
    }

    if (parsed.breaking) {
      content += ' [BREAKING CHANGE]';
    }

    // Ensure proper sentence format
    if (!content.endsWith('.') && !content.endsWith('!')) {
      content += '.';
    }

    return content.substring(0, this.config.max_content_length);
  }

  private generateDiffSummary(commit: Commit, files: CommitFile[]): { summary: string; impact: string } {
    const filesByType = files.reduce((acc, file) => {
      acc[file.change_type] = (acc[file.change_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const totalLines = files.reduce((sum, f) => sum + f.added_lines + f.removed_lines, 0);
    const languages = [...new Set(files.map(f => f.language).filter(Boolean))];

    let summary = `Modified ${files.length} file${files.length > 1 ? 's' : ''}`;
    
    if (filesByType.A) summary += `, added ${filesByType.A}`;
    if (filesByType.D) summary += `, removed ${filesByType.D}`;
    if (filesByType.M) summary += `, modified ${filesByType.M}`;
    if (filesByType.R) summary += `, renamed ${filesByType.R}`;

    summary += ` (${totalLines} lines changed)`;

    if (languages.length > 0) {
      summary += ` in ${languages.slice(0, 3).join(', ')}`;
    }

    // Add context from commit message
    const parsed = this.parseConventionalCommit(commit.message);
    if (parsed.isValid && parsed.description) {
      summary += `: ${parsed.description}`;
    }

    const impact = totalLines > 200 ? 'high' : totalLines > 50 ? 'medium' : 'low';
    
    return { 
      summary: summary.substring(0, this.config.max_content_length),
      impact 
    };
  }

  private matchesPattern(path: string, pattern: string): boolean {
    // Simple glob pattern matching
    const regexPattern = pattern
      .replace(/\*\*/g, '.*')  // ** matches any number of directories
      .replace(/\*/g, '[^/]*') // * matches any characters except /
      .replace(/\?/g, '.');    // ? matches any single character
    
    return new RegExp(`^${regexPattern}$`).test(path);
  }

  private buildEnrichmentPrompt(draft: MemoryDraft): string {
    return `Improve this ${draft.type} memory about a code change:

Original: "${draft.content}"

Context:
- Source: ${draft.extracted_from}
- Files: ${draft.repo_paths.slice(0, 3).join(', ')}
- Confidence: ${draft.confidence}

Rewrite as a clear, concise statement (1-2 sentences max) that captures the key decision or change. Focus on WHAT was done and WHY, not implementation details.

Improved:`;
  }

  private async callLLM(prompt: string): Promise<string | null> {
    try {
      if (this.config.llm_provider === 'ollama') {
        return await this.callOllama(prompt);
      } else if (this.config.llm_provider === 'openai') {
        return await this.callOpenAI(prompt);
      }
      return null;
    } catch (error) {
      logger.error('LLM call failed', { 
        error: error instanceof Error ? error.message : String(error),
        provider: this.config.llm_provider 
      });
      return null;
    }
  }

  private async callOllama(prompt: string): Promise<string | null> {
    const response = await fetch(`${this.config.llm_base_url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.llm_model,
        prompt,
        stream: false,
        options: {
          temperature: 0.3,
          top_p: 0.9,
          max_tokens: 150,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json();
    return (data as { response?: string }).response?.trim() || null;
  }

  private async callOpenAI(prompt: string): Promise<string | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    return (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content?.trim() || null;
  }

  private getConfigFromEnv(): Partial<ExtractionConfig> {
    const config: Partial<ExtractionConfig> = {};
    
    if (process.env.EXTRACTION_DIFF_THRESHOLD) {
      config.diff_threshold = parseInt(process.env.EXTRACTION_DIFF_THRESHOLD);
    }
    
    if (process.env.LLM_EXTRACTION_ENABLED !== undefined) {
      config.llm_enabled = process.env.LLM_EXTRACTION_ENABLED === 'true';
    }
    
    if (process.env.LLM_PROVIDER) {
      config.llm_provider = process.env.LLM_PROVIDER as 'ollama' | 'openai';
    }
    
    if (process.env.LLM_MODEL) {
      config.llm_model = process.env.LLM_MODEL;
    }
    
    if (process.env.OLLAMA_BASE_URL) {
      config.llm_base_url = process.env.OLLAMA_BASE_URL;
    }
    
    return config;
  }

  /**
   * Health check for extraction service
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    llm_available: boolean;
    embedding_service: any;
  }> {
    let llmAvailable = false;
    
    if (this.config.llm_enabled) {
      try {
        await this.callLLM('test');
        llmAvailable = true;
      } catch {
        llmAvailable = false;
      }
    }

    const embeddingHealth = await this.embeddingService.healthCheck();
    
    const status = embeddingHealth.status === 'healthy' && 
                  (!this.config.llm_enabled || llmAvailable) ? 
                  'healthy' : 'degraded';

    return {
      status,
      llm_available: llmAvailable,
      embedding_service: embeddingHealth,
    };
  }
}
