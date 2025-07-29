import { readFile } from 'fs/promises';
import { extname, basename } from 'path';
import { createHash } from 'crypto';
import { db } from '../database/index.js';

export interface CodeAnalysisResult {
  filePath: string;
  contentHash: string;
  analysis: {
    type: 'syntax' | 'dependencies' | 'structure' | 'full';
    language?: string;
    fileSize: number;
    lineCount: number;
    imports?: string[];
    exports?: string[];
    functions?: string[];
    classes?: string[];
    dependencies?: string[];
    complexity?: number;
    structure?: any;
  };
  summary: string;
  timestamp: Date;
}

export interface CodebaseAnalysisReport {
  sessionKey: string;
  totalFiles: number;
  results: CodeAnalysisResult[];
  summary: string;
  timestamp: Date;
}

class CodebaseAnalyzerService {
  async analyzeFiles(
    sessionKey: string,
    filePaths: string[],
    analysisType: 'syntax' | 'dependencies' | 'structure' | 'full' = 'structure'
  ): Promise<any> {
    try {
      const session = await db.getSession(sessionKey);
      if (!session) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'Session not found',
                sessionKey
              }, null, 2)
            }
          ]
        };
      }

      const results: CodeAnalysisResult[] = [];
      const errors: string[] = [];

      for (const filePath of filePaths) {
        try {
          const analysisResult = await this.analyzeFile(filePath, analysisType);
          results.push(analysisResult);

          // Store in database
          await this.storeAnalysisResult(session.id, analysisResult);
        } catch (error) {
          const errorMsg = `Failed to analyze ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          errors.push(errorMsg);
          console.error(errorMsg);
        }
      }

      const report: CodebaseAnalysisReport = {
        sessionKey,
        totalFiles: filePaths.length,
        results,
        summary: this.generateAnalysisSummary(results),
        timestamp: new Date()
      };

      // Add context entry for the analysis
      await db.addContextEntry(
        session.id,
        'tool_call',
        `Codebase analysis completed: ${results.length} files analyzed`,
        {
          action: 'codebase_analysis',
          analysisType,
          totalFiles: filePaths.length,
          successfulFiles: results.length,
          errors: errors.length,
          summary: report.summary
        }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              report,
              errors: errors.length > 0 ? errors : undefined
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      console.error('Error in codebase analysis:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Failed to analyze codebase',
              details: error instanceof Error ? error.message : 'Unknown error'
            }, null, 2)
          }
        ]
      };
    }
  }

  private async analyzeFile(filePath: string, analysisType: string): Promise<CodeAnalysisResult> {
    const content = await readFile(filePath, 'utf-8');
    const contentHash = createHash('sha256').update(content).digest('hex');
    const extension = extname(filePath);
    const language = this.detectLanguage(extension);
    const lines = content.split('\n');
    
    const analysis: CodeAnalysisResult['analysis'] = {
      type: analysisType as any,
      language,
      fileSize: content.length,
      lineCount: lines.length
    };

    // Perform analysis based on type
    switch (analysisType) {
      case 'syntax':
        Object.assign(analysis, await this.analyzeSyntax(content));
        break;
      case 'dependencies':
        Object.assign(analysis, await this.analyzeDependencies(content, language));
        break;
      case 'structure':
        Object.assign(analysis, await this.analyzeStructure(content));
        break;
      case 'full':
        Object.assign(analysis, 
          await this.analyzeSyntax(content),
          await this.analyzeDependencies(content, language),
          await this.analyzeStructure(content)
        );
        break;
    }

    return {
      filePath,
      contentHash,
      analysis,
      summary: this.generateFileSummary(filePath, analysis),
      timestamp: new Date()
    };
  }

  private detectLanguage(extension: string): string {
    const langMap: Record<string, string> = {
      '.ts': 'typescript',
      '.js': 'javascript',
      '.tsx': 'typescript-react',
      '.jsx': 'javascript-react',
      '.py': 'python',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
      '.cs': 'csharp',
      '.go': 'go',
      '.rs': 'rust',
      '.php': 'php',
      '.rb': 'ruby',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
      '.json': 'json',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.xml': 'xml',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.md': 'markdown'
    };
    
    return langMap[extension.toLowerCase()] || 'unknown';
  }

  private async analyzeSyntax(content: string): Promise<Partial<CodeAnalysisResult['analysis']>> {
    // Basic syntax analysis - in a real implementation, you'd use language-specific parsers
    const result: Partial<CodeAnalysisResult['analysis']> = {};

    // Count basic constructs
    const functionMatches = content.match(/function\s+\w+|const\s+\w+\s*=\s*\(|def\s+\w+/g);
    const classMatches = content.match(/class\s+\w+|interface\s+\w+/g);

    result.functions = (functionMatches || []).map(match => {
        const nameMatch = match.match(/(?:function|const|def)\s+(\w+)/);
        return nameMatch ? nameMatch[1] : null;
    }).filter(Boolean);
    result.classes = classMatches || [];

    return result;
  }

  private async analyzeDependencies(content: string, language: string): Promise<Partial<CodeAnalysisResult['analysis']>> {
    const result: Partial<CodeAnalysisResult['analysis']> = {
      imports: [],
      dependencies: []
    };

    // Extract imports based on language
    if (language === 'typescript' || language === 'javascript') {
      const importMatches = content.match(/import\s+.*?from\s+['"][^'"]+['"]/g);
      const requireMatches = content.match(/require\(['"][^'"]+['"]\)/g);
      
      if (importMatches) {
        result.imports = importMatches;
        result.dependencies = importMatches.map(imp => {
          const match = imp.match(/from\s+['"]([^'"]+)['"]/);
          return match ? match[1] : '';
        }).filter(Boolean);
      }
      
      if (requireMatches) {
        const reqDeps = requireMatches.map(req => {
          const match = req.match(/require\(['"]([^'"]+)['"]\)/);
          return match ? match[1] : '';
        }).filter(Boolean);
        result.dependencies = [...(result.dependencies || []), ...reqDeps];
      }
    } else if (language === 'python') {
      const importMatches = content.match(/^import\s+\w+|^from\s+\w+\s+import/gm);
      result.imports = importMatches || [];
      result.dependencies = (importMatches || []).map(imp => {
        const match = imp.match(/(?:import|from)\s+(\w+)/);
        return match ? match[1] : '';
      }).filter(Boolean);
    }

    return result;
  }

  private async analyzeStructure(content: string): Promise<Partial<CodeAnalysisResult['analysis']>> {
    const lines = content.split('\n');
    const nonEmptyLines = lines.filter(line => line.trim().length > 0);
    const commentLines = lines.filter(line => {
      const trimmed = line.trim();
      return trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*');
    });

    // Calculate basic complexity (simplified)
    const complexity = this.calculateComplexity(content);

    const structure = {
      totalLines: lines.length,
      codeLines: nonEmptyLines.length,
      commentLines: commentLines.length,
      blankLines: lines.length - nonEmptyLines.length,
      commentRatio: commentLines.length / nonEmptyLines.length
    };

    return {
      complexity,
      structure
    };
  }

  private calculateComplexity(content: string): number {
    // Simplified cyclomatic complexity calculation
    let complexity = 1; // Base complexity

    // Count decision points
    const patterns = [
      /\bif\b/g,
      /\belse\b/g,
      /\bwhile\b/g,
      /\bfor\b/g,
      /\bswitch\b/g,
      /\bcase\b/g,
      /\bcatch\b/g,
      /\btry\b/g,
      /\?\s*:/g, // ternary operator
      /&&/g,
      /\|\|/g
    ];

    patterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    });

    return complexity;
  }

  private generateFileSummary(filePath: string, analysis: CodeAnalysisResult['analysis']): string {
    const fileName = basename(filePath);
    let summary = `${fileName} (${analysis.language || 'unknown'})`;
    
    summary += ` - ${analysis.lineCount} lines, ${analysis.fileSize} bytes`;
    
    if (analysis.functions && analysis.functions.length > 0) {
      summary += `, ${analysis.functions.length} functions`;
    }
    
    if (analysis.classes && analysis.classes.length > 0) {
      summary += `, ${analysis.classes.length} classes`;
    }
    
    if (analysis.dependencies && analysis.dependencies.length > 0) {
      summary += `, ${analysis.dependencies.length} dependencies`;
    }
    
    if (analysis.complexity) {
      summary += `, complexity: ${analysis.complexity}`;
    }

    return summary;
  }

  private generateAnalysisSummary(results: CodeAnalysisResult[]): string {
    if (results.length === 0) {
      return 'No files analyzed';
    }

    const totalLines = results.reduce((sum, r) => sum + r.analysis.lineCount, 0);
    const totalSize = results.reduce((sum, r) => sum + r.analysis.fileSize, 0);
    const languages = [...new Set(results.map(r => r.analysis.language).filter(Boolean))];
    const totalFunctions = results.reduce((sum, r) => sum + (r.analysis.functions?.length || 0), 0);
    const totalClasses = results.reduce((sum, r) => sum + (r.analysis.classes?.length || 0), 0);
    const avgComplexity = results.reduce((sum, r) => sum + (r.analysis.complexity || 0), 0) / results.length;

    let summary = `Analyzed ${results.length} files`;
    summary += ` (${totalLines} total lines, ${Math.round(totalSize / 1024)}KB)`;
    summary += `. Languages: ${languages.join(', ')}`;
    
    if (totalFunctions > 0) summary += `. ${totalFunctions} functions`;
    if (totalClasses > 0) summary += `, ${totalClasses} classes`;
    if (avgComplexity > 0) summary += `. Average complexity: ${avgComplexity.toFixed(1)}`;

    return summary;
  }

  private async storeAnalysisResult(sessionId: string, result: CodeAnalysisResult): Promise<void> {
    // Store the analysis result in the codebase_snapshots table
    await db.query(
      `INSERT INTO codebase_snapshots (session_id, file_path, content_hash, analysis, summary, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        result.filePath,
        result.contentHash,
        JSON.stringify(result.analysis),
        result.summary,
        result.timestamp.toISOString()
      ]
    );

    // Add a context entry for additional tracking
    await db.addContextEntry(
      sessionId,
      'file',
      `Analysis of ${result.filePath}: ${result.summary}`,
      {
        action: 'file_analysis',
        filePath: result.filePath,
        contentHash: result.contentHash,
        analysisResult: result.analysis,
        language: result.analysis.language,
        lineCount: result.analysis.lineCount,
        fileSize: result.analysis.fileSize
      }
    );
  }
}

export const codebaseAnalyzerService = new CodebaseAnalyzerService();