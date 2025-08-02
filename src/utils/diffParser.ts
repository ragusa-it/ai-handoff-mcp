import { logger } from '../services/structuredLogger.js';
import { detectLanguage, calculateFileComplexity } from './gitUtils.js';

/**
 * Diff parsing utilities for analyzing git changes
 */

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
  context: string;
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface ParsedDiff {
  oldPath: string;
  newPath: string;
  changeType: 'A' | 'M' | 'D' | 'R' | 'C' | 'T';
  isBinary: boolean;
  hunks: DiffHunk[];
  stats: {
    addedLines: number;
    removedLines: number;
    contextLines: number;
    totalLines: number;
  };
  metadata: {
    oldMode?: string;
    newMode?: string;
    similarity?: number; // For renames/copies
    language?: string;
    complexity: number;
  };
}

export interface DiffSummary {
  totalFiles: number;
  addedFiles: number;
  modifiedFiles: number;
  deletedFiles: number;
  renamedFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  languages: Record<string, number>;
  complexityScore: number;
}

/**
 * Parse unified diff format into structured data
 */
export function parseUnifiedDiff(diffText: string): ParsedDiff[] {
  const diffs: ParsedDiff[] = [];
  const files = diffText.split(/^diff --git /m).slice(1); // Remove empty first element

  for (const fileContent of files) {
    try {
      const parsedDiff = parseFileDiff(fileContent);
      if (parsedDiff) {
        diffs.push(parsedDiff);
      }
    } catch (error) {
      logger.warn('Failed to parse file diff', { error });
    }
  }

  return diffs;
}

/**
 * Parse a single file's diff
 */
function parseFileDiff(diffContent: string): ParsedDiff | null {
  const lines = diffContent.split('\n');
  
  // Extract file paths from the first line
  const firstLine = `diff --git ${lines[0]}`;
  const pathMatch = firstLine.match(/^diff --git a\/(.+) b\/(.+)$/);
  
  if (!pathMatch) {
    logger.warn('Could not parse file paths from diff', { firstLine });
    return null;
  }

  const [, oldPath, newPath] = pathMatch;
  
  let changeType: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' = 'M'; // Default to modified
  let isBinary = false;
  let oldMode: string | undefined;
  let newMode: string | undefined;
  let similarity: number | undefined;
  
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLineNumber = 0;
  let newLineNumber = 0;
  
  // Stats
  let addedLines = 0;
  let removedLines = 0;
  let contextLines = 0;
  
  let i = 1; // Skip the first line (already processed)
  
  // Parse header information
  while (i < lines.length && !lines[i].startsWith('@@')) {
    const line = lines[i];
    
    if (line.startsWith('new file mode')) {
      changeType = 'A';
      newMode = line.split(' ')[3];
    } else if (line.startsWith('deleted file mode')) {
      changeType = 'D';
      oldMode = line.split(' ')[3];
    } else if (line.startsWith('old mode')) {
      oldMode = line.split(' ')[2];
    } else if (line.startsWith('new mode')) {
      newMode = line.split(' ')[2];
    } else if (line.startsWith('similarity index')) {
      similarity = parseInt(line.split(' ')[2].replace('%', ''));
      changeType = similarity === 100 ? 'R' : similarity > 50 ? 'C' : 'M';
    } else if (line.startsWith('rename from')) {
      changeType = 'R';
    } else if (line.startsWith('copy from')) {
      changeType = 'C';
    } else if (line.includes('Binary files')) {
      isBinary = true;
    }
    
    i++;
  }
  
  // Parse hunks
  while (i < lines.length) {
    const line = lines[i];
    
    if (line.startsWith('@@')) {
      // Start of new hunk
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      
      const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      if (hunkMatch) {
        const [, oldStartStr, oldLinesStr, newStartStr, newLinesStr, context] = hunkMatch;
        
        oldLineNumber = parseInt(oldStartStr);
        newLineNumber = parseInt(newStartStr);
        
        currentHunk = {
          oldStart: oldLineNumber,
          oldLines: parseInt(oldLinesStr) || 1,
          newStart: newLineNumber,
          newLines: parseInt(newLinesStr) || 1,
          lines: [],
          context: context.trim(),
        };
      }
    } else if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
      // Diff line
      const type = line[0] === '+' ? 'add' : line[0] === '-' ? 'remove' : 'context';
      const content = line.substring(1);
      
      const diffLine: DiffLine = {
        type,
        content,
      };
      
      if (type === 'remove' || type === 'context') {
        diffLine.oldLineNumber = oldLineNumber++;
      }
      
      if (type === 'add' || type === 'context') {
        diffLine.newLineNumber = newLineNumber++;
      }
      
      currentHunk.lines.push(diffLine);
      
      // Update stats
      if (type === 'add') {
        addedLines++;
      } else if (type === 'remove') {
        removedLines++;
      } else {
        contextLines++;
      }
    }
    
    i++;
  }
  
  // Add the last hunk
  if (currentHunk) {
    hunks.push(currentHunk);
  }
  
  const language = detectLanguage(newPath || oldPath);
  const complexity = calculateFileComplexity(
    newPath || oldPath,
    addedLines,
    removedLines
  );
  
  return {
    oldPath,
    newPath,
    changeType,
    isBinary,
    hunks,
    stats: {
      addedLines,
      removedLines,
      contextLines,
      totalLines: addedLines + removedLines + contextLines,
    },
    metadata: {
      oldMode,
      newMode,
      similarity,
      language,
      complexity,
    },
  };
}

/**
 * Generate a summary of all diffs
 */
export function generateDiffSummary(diffs: ParsedDiff[]): DiffSummary {
  const summary: DiffSummary = {
    totalFiles: diffs.length,
    addedFiles: 0,
    modifiedFiles: 0,
    deletedFiles: 0,
    renamedFiles: 0,
    totalAdditions: 0,
    totalDeletions: 0,
    languages: {},
    complexityScore: 0,
  };

  for (const diff of diffs) {
    // Count by change type
    switch (diff.changeType) {
      case 'A':
        summary.addedFiles++;
        break;
      case 'M':
        summary.modifiedFiles++;
        break;
      case 'D':
        summary.deletedFiles++;
        break;
      case 'R':
        summary.renamedFiles++;
        break;
      case 'C':
        summary.modifiedFiles++; // Treat copies as modifications
        break;
    }
    
    // Aggregate stats
    summary.totalAdditions += diff.stats.addedLines;
    summary.totalDeletions += diff.stats.removedLines;
    summary.complexityScore += diff.metadata.complexity;
    
    // Count languages
    if (diff.metadata.language) {
      summary.languages[diff.metadata.language] = 
        (summary.languages[diff.metadata.language] || 0) + 1;
    }
  }
  
  return summary;
}

/**
 * Extract code snippets from diffs for context
 */
export function extractCodeSnippets(
  diffs: ParsedDiff[],
  maxSnippets = 5,
  maxLinesPerSnippet = 10
): Array<{
  filePath: string;
  language?: string;
  changeType: string;
  snippet: string;
  addedLines: number;
  removedLines: number;
}> {
  const snippets: Array<{
    filePath: string;
    language?: string;
    changeType: string;
    snippet: string;
    addedLines: number;
    removedLines: number;
  }> = [];

  // Sort diffs by complexity to get most significant changes first
  const sortedDiffs = [...diffs].sort((a, b) => b.metadata.complexity - a.metadata.complexity);

  for (const diff of sortedDiffs.slice(0, maxSnippets)) {
    if (diff.isBinary || diff.hunks.length === 0) {
      continue;
    }

    // Get the most significant hunk (with most changes)
    const significantHunk = diff.hunks.reduce((max, hunk) => 
      (hunk.lines.length > max.lines.length) ? hunk : max
    );

    // Extract snippet from hunk
    const snippetLines = significantHunk.lines
      .filter(line => line.type !== 'context' || Math.random() < 0.3) // Include some context
      .slice(0, maxLinesPerSnippet)
      .map(line => {
        const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
        return `${prefix}${line.content}`;
      });

    if (snippetLines.length > 0) {
      snippets.push({
        filePath: diff.newPath || diff.oldPath,
        language: diff.metadata.language,
        changeType: diff.changeType,
        snippet: snippetLines.join('\n'),
        addedLines: diff.stats.addedLines,
        removedLines: diff.stats.removedLines,
      });
    }
  }

  return snippets;
}

/**
 * Detect potential code patterns in diffs
 */
export function analyzeCodePatterns(diffs: ParsedDiff[]): {
  patterns: string[];
  hotspots: string[];
  risks: string[];
  suggestions: string[];
} {
  const patterns: Set<string> = new Set();
  const hotspots: Set<string> = new Set();
  const risks: Set<string> = new Set();
  const suggestions: Set<string> = new Set();

  for (const diff of diffs) {
    const path = diff.newPath || diff.oldPath;
    
    // Analyze file patterns
    if (path.includes('test') || path.includes('spec')) {
      patterns.add('test-changes');
    }
    
    if (path.includes('config') || path.includes('setting')) {
      patterns.add('configuration-changes');
    }
    
    if (diff.changeType === 'D' && !path.includes('test')) {
      risks.add('file-deletion');
    }
    
    if (diff.stats.addedLines > 500) {
      hotspots.add(path);
      risks.add('large-addition');
    }
    
    if (diff.stats.removedLines > 200) {
      risks.add('large-deletion');
    }
    
    // Analyze code content
    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'add') {
          const content = line.content.toLowerCase();
          
          // Detect patterns
          if (content.includes('todo') || content.includes('fixme')) {
            patterns.add('todo-comments');
          }
          
          if (content.includes('console.log') || content.includes('print(')) {
            patterns.add('debug-statements');
            suggestions.add('remove-debug-statements');
          }
          
          if (content.includes('password') || content.includes('secret') || content.includes('api_key')) {
            risks.add('potential-credentials');
          }
          
          if (content.includes('async') || content.includes('await') || content.includes('promise')) {
            patterns.add('async-changes');
          }
          
          if (content.includes('class ') || content.includes('interface ')) {
            patterns.add('structural-changes');
          }
          
          if (content.includes('import ') || content.includes('require(')) {
            patterns.add('dependency-changes');
          }
        }
      }
    }
  }

  return {
    patterns: Array.from(patterns),
    hotspots: Array.from(hotspots),
    risks: Array.from(risks),
    suggestions: Array.from(suggestions),
  };
}

/**
 * Generate hunk preview for display
 */
export function generateHunkPreview(
  hunk: DiffHunk,
  maxLines = 5,
  includeContext = true
): string {
  const lines = includeContext 
    ? hunk.lines 
    : hunk.lines.filter(line => line.type !== 'context');
  
  const previewLines = lines.slice(0, maxLines);
  
  return previewLines.map(line => {
    const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
    return `${prefix}${line.content}`;
  }).join('\n');
}

/**
 * Calculate diff complexity score
 */
export function calculateDiffComplexity(diffs: ParsedDiff[]): {
  score: number;
  level: 'low' | 'medium' | 'high' | 'critical';
  factors: string[];
} {
  let score = 0;
  const factors: Set<string> = new Set();
  
  const totalFiles = diffs.length;
  const totalLines = diffs.reduce((sum, d) => sum + d.stats.addedLines + d.stats.removedLines, 0);
  
  // Base score from volume
  score += Math.sqrt(totalFiles) * 2;
  score += Math.sqrt(totalLines) * 0.5;
  
  if (totalFiles > 20) factors.add('many-files');
  if (totalLines > 1000) factors.add('large-change');
  
  // Analyze individual files
  for (const diff of diffs) {
    score += diff.metadata.complexity;
    
    if (diff.changeType === 'D') {
      score += 5;
      factors.add('file-deletions');
    }
    
    if (diff.stats.addedLines > 200) {
      score += 3;
      factors.add('large-additions');
    }
    
    if (diff.stats.removedLines > 100) {
      score += 2;
      factors.add('large-deletions');
    }
    
    // Language complexity
    if (['cpp', 'rust', 'assembly'].includes(diff.metadata.language || '')) {
      score += 2;
      factors.add('complex-language');
    }
  }
  
  // Determine level
  let level: 'low' | 'medium' | 'high' | 'critical';
  if (score < 10) level = 'low';
  else if (score < 25) level = 'medium';
  else if (score < 50) level = 'high';
  else level = 'critical';
  
  return {
    score: Math.round(score * 10) / 10,
    level,
    factors: Array.from(factors),
  };
}

/**
 * Parse git patch format
 */
export function parsePatch(patchText: string): ParsedDiff[] {
  // Handle both unified diff and git patch formats
  if (patchText.includes('diff --git')) {
    return parseUnifiedDiff(patchText);
  }
  
  // Handle plain patch format
  const diffs: ParsedDiff[] = [];
  const sections = patchText.split(/^--- /m);
  
  for (let i = 1; i < sections.length; i++) {
    try {
      const section = `--- ${sections[i]}`;
      const parsedDiff = parsePlainPatch(section);
      if (parsedDiff) {
        diffs.push(parsedDiff);
      }
    } catch (error) {
      logger.warn('Failed to parse patch section', { error });
    }
  }
  
  return diffs;
}

/**
 * Parse plain patch format (context diff or unified diff)
 */
function parsePlainPatch(patchSection: string): ParsedDiff | null {
  const lines = patchSection.split('\n');
  
  if (lines.length < 2) return null;
  
  // Extract file paths
  const oldPathLine = lines[0]; // --- path
  const newPathLine = lines[1]; // +++ path
  
  const oldPathMatch = oldPathLine.match(/^--- (.+?)(?:\t|$)/);
  const newPathMatch = newPathLine.match(/^\+\+\+ (.+?)(?:\t|$)/);
  
  if (!oldPathMatch || !newPathMatch) return null;
  
  const oldPath = oldPathMatch[1];
  const newPath = newPathMatch[1];
  
  // Determine change type
  let changeType: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' = 'M';
  if (oldPath === '/dev/null') changeType = 'A';
  else if (newPath === '/dev/null') changeType = 'D';
  
  // Parse hunks (simplified - assumes unified diff format)
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let addedLines = 0;
  let removedLines = 0;
  let contextLines = 0;
  
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.startsWith('@@')) {
      if (currentHunk) hunks.push(currentHunk);
      
      const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      if (hunkMatch) {
        currentHunk = {
          oldStart: parseInt(hunkMatch[1]),
          oldLines: parseInt(hunkMatch[2]) || 1,
          newStart: parseInt(hunkMatch[3]),
          newLines: parseInt(hunkMatch[4]) || 1,
          lines: [],
          context: hunkMatch[5].trim(),
        };
      }
    } else if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
      const type = line[0] === '+' ? 'add' : line[0] === '-' ? 'remove' : 'context';
      currentHunk.lines.push({
        type,
        content: line.substring(1),
      });
      
      if (type === 'add') addedLines++;
      else if (type === 'remove') removedLines++;
      else contextLines++;
    }
  }
  
  if (currentHunk) hunks.push(currentHunk);
  
  const language = detectLanguage(newPath || oldPath);
  const complexity = calculateFileComplexity(newPath || oldPath, addedLines, removedLines);
  
  return {
    oldPath,
    newPath,
    changeType,
    isBinary: false,
    hunks,
    stats: {
      addedLines,
      removedLines,
      contextLines,
      totalLines: addedLines + removedLines + contextLines,
    },
    metadata: {
      language,
      complexity,
    },
  };
}
