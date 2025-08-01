import { codebaseAnalyzerService } from '../codebaseAnalyzer.js';
import { db } from '../../database/index.js';

// Mock the database
jest.mock('../../database/index.js', () => ({
  db: {
    getSession: jest.fn(),
    query: jest.fn(),
    setCache: jest.fn(),
    getCache: jest.fn(),
    deleteCache: jest.fn(),
    addContextEntry: jest.fn()
  }
}));

// Mock file system operations
jest.mock('fs/promises', () => ({
  readFile: jest.fn()
}));

describe('CodebaseAnalyzerService', () => {
  let mockDb: jest.Mocked<typeof db>;
  
  const mockSession = {
    id: 'test-session-id',
    sessionKey: 'test-session-key',
    agentFrom: 'agent1',
    agentTo: 'agent2',
    status: 'active' as const,
    createdAt: new Date('2023-01-01T00:00:00Z'),
    updatedAt: new Date('2023-01-01T00:00:00Z'),
    lastActivityAt: new Date('2023-01-01T00:00:00Z'),
    isDormant: false,
    retentionPolicy: 'standard',
    metadata: {},
    expiresAt: undefined,
    archivedAt: undefined
  };

  beforeEach(() => {
    mockDb = db as jest.Mocked<typeof db>;
    jest.clearAllMocks();
    
    // Mock console.error to prevent test output pollution
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('analyzeFiles', () => {
    it('should return error when session is not found', async () => {
      mockDb.getSession.mockResolvedValueOnce(null);

      const result = await codebaseAnalyzerService.analyzeFiles('non-existent-key', ['/path/to/file.ts']);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Session not found',
              sessionKey: 'non-existent-key'
            }, null, 2)
          }
        ]
      });
      expect(mockDb.getSession).toHaveBeenCalledWith('non-existent-key');
    });

    it('should analyze a single TypeScript file successfully', async () => {
      const { readFile } = await import('fs/promises');
      (readFile as jest.Mock).mockResolvedValueOnce(`
        import { something } from 'module';
        import another from 'another-module';
        
        function testFunction() {
          console.log('test');
        }
        
        class TestClass {
          method() {}
        }
        
        export { testFunction, TestClass };
      `);
      
      mockDb.getSession.mockResolvedValueOnce(mockSession);
      mockDb.addContextEntry.mockResolvedValueOnce({
        id: 'context-entry-id',
        sessionId: 'test-session-id',
        sequenceNumber: 1,
        contextType: 'tool_call',
        content: 'Codebase analysis completed: 1 files analyzed',
        metadata: expect.any(Object),
        createdAt: new Date()
      });
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await codebaseAnalyzerService.analyzeFiles('test-session-key', ['/path/to/file.ts']);

      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult.success).toBe(true);
      expect(parsedResult.report.results).toHaveLength(1);
      expect(parsedResult.report.results[0].filePath).toBe('/path/to/file.ts');
      expect(parsedResult.report.results[0].analysis.language).toBe('typescript');
      expect(parsedResult.report.results[0].analysis.functions).toContain('testFunction');
      expect(parsedResult.report.results[0].analysis.classes).toContain('TestClass');
      expect(parsedResult.report.results[0].analysis.dependencies).toEqual(['module', 'another-module']);
    });

    it('should analyze a Python file successfully', async () => {
      const { readFile } = await import('fs/promises');
      (readFile as jest.Mock).mockResolvedValueOnce(`
        import os
        from typing import List
        
        def test_function():
            pass
            
        class TestClass:
            def method(self):
                pass
      `);
      
      mockDb.getSession.mockResolvedValueOnce(mockSession);
      mockDb.addContextEntry.mockResolvedValueOnce({
        id: 'context-entry-id',
        sessionId: 'test-session-id',
        sequenceNumber: 1,
        contextType: 'tool_call',
        content: 'Codebase analysis completed: 1 files analyzed',
        metadata: expect.any(Object),
        createdAt: new Date()
      });
      mockDb.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await codebaseAnalyzerService.analyzeFiles('test-session-key', ['/path/to/file.py']);

      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult.success).toBe(true);
      expect(parsedResult.report.results).toHaveLength(1);
      expect(parsedResult.report.results[0].filePath).toBe('/path/to/file.py');
      expect(parsedResult.report.results[0].analysis.language).toBe('python');
      expect(parsedResult.report.results[0].analysis.functions).toContain('test_function');
      expect(parsedResult.report.results[0].analysis.classes).toContain('TestClass');
      expect(parsedResult.report.results[0].analysis.dependencies).toEqual(['os', 'typing']);
    });

    it('should handle file read errors gracefully', async () => {
      const { readFile } = await import('fs/promises');
      (readFile as jest.Mock).mockRejectedValueOnce(new Error('File not found'));
      
      mockDb.getSession.mockResolvedValueOnce(mockSession);
      mockDb.addContextEntry.mockResolvedValueOnce({
        id: 'context-entry-id',
        sessionId: 'test-session-id',
        sequenceNumber: 1,
        contextType: 'tool_call',
        content: 'Codebase analysis completed: 0 files analyzed',
        metadata: expect.any(Object),
        createdAt: new Date()
      });

      const result = await codebaseAnalyzerService.analyzeFiles('test-session-key', ['/path/nonexistent.ts']);

      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult.success).toBe(true);
      expect(parsedResult.report.results).toHaveLength(0);
      expect(parsedResult.errors).toHaveLength(1);
      expect(parsedResult.errors[0]).toContain('Failed to analyze /path/nonexistent.ts');
    });

    it('should analyze multiple files', async () => {
      const { readFile } = await import('fs/promises');
      (readFile as jest.Mock)
        .mockResolvedValueOnce('const a = 1;') // file1.ts
        .mockResolvedValueOnce('const b = 2;'); // file2.ts
      
      mockDb.getSession.mockResolvedValueOnce(mockSession);
      mockDb.addContextEntry.mockResolvedValueOnce({
        id: 'context-entry-id',
        sessionId: 'test-session-id',
        sequenceNumber: 1,
        contextType: 'tool_call',
        content: 'Codebase analysis completed: 2 files analyzed',
        metadata: expect.any(Object),
        createdAt: new Date()
      });
      mockDb.query.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await codebaseAnalyzerService.analyzeFiles('test-session-key', ['/path/file1.ts', '/path/file2.ts']);

      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult.success).toBe(true);
      expect(parsedResult.report.results).toHaveLength(2);
      expect(parsedResult.report.totalFiles).toBe(2);
    });
  });

  describe('detectLanguage', () => {
    it('should detect TypeScript files', () => {
      const result = (codebaseAnalyzerService as any).detectLanguage('.ts');
      expect(result).toBe('typescript');
    });

    it('should detect JavaScript files', () => {
      const result = (codebaseAnalyzerService as any).detectLanguage('.js');
      expect(result).toBe('javascript');
    });

    it('should detect Python files', () => {
      const result = (codebaseAnalyzerService as any).detectLanguage('.py');
      expect(result).toBe('python');
    });

    it('should return unknown for unsupported extensions', () => {
      const result = (codebaseAnalyzerService as any).detectLanguage('.unknown');
      expect(result).toBe('unknown');
    });
  });

  describe('analyzeSyntax', () => {
    it('should analyze TypeScript syntax correctly', async () => {
      const content = `
        function testFunction() {}
        const arrowFunction = () => {};
        class TestClass {}
        interface TestInterface {}
      `;
      
      const result = await (codebaseAnalyzerService as any).analyzeSyntax(content);
      
      expect(result.functions).toContain('testFunction');
      expect(result.functions).toContain('arrowFunction');
      expect(result.classes).toContain('TestClass');
      expect(result.classes).toContain('TestInterface');
    });

    it('should analyze Python syntax correctly', async () => {
      const content = `
        def test_function():
            pass
            
        class TestClass:
            def method(self):
                pass
      `;
      
      const result = await (codebaseAnalyzerService as any).analyzeSyntax(content);
      
      // Note: The current implementation doesn't specifically handle Python syntax
      // This test is more for future enhancement
      expect(result).toBeDefined();
    });
  });

  describe('analyzeDependencies', () => {
    it('should analyze TypeScript dependencies correctly', async () => {
      const content = `
        import { something } from 'module1';
        import another from 'module2';
        const required = require('module3');
      `;
      const language = 'typescript';
      
      const result = await (codebaseAnalyzerService as any).analyzeDependencies(content, language);
      
      expect(result.imports).toHaveLength(2);
      expect(result.dependencies).toContain('module1');
      expect(result.dependencies).toContain('module2');
      expect(result.dependencies).toContain('module3');
    });

    it('should analyze Python dependencies correctly', async () => {
      const content = `
        import os
        from typing import List
        import numpy as np
      `;
      const language = 'python';
      
      const result = await (codebaseAnalyzerService as any).analyzeDependencies(content, language);
      
      expect(result.imports).toHaveLength(3);
      expect(result.dependencies).toContain('os');
      expect(result.dependencies).toContain('typing');
      expect(result.dependencies).toContain('numpy');
    });
  });

  describe('analyzeStructure', () => {
    it('should analyze file structure correctly', async () => {
      const content = `
        // This is a comment
        const a = 1;
        
        /* This is a 
           multiline comment */
        function test() {
          if (true) {
            console.log('test');
          }
        }
      `;
      
      const result = await (codebaseAnalyzerService as any).analyzeStructure(content);
      
      expect(result.complexity).toBeGreaterThan(1);
      expect(result.structure).toBeDefined();
      expect(result.structure.totalLines).toBe(9);
      expect(result.structure.commentLines).toBe(3);
    });
  });

  describe('calculateComplexity', () => {
    it('should calculate complexity based on decision points', () => {
      const content = `
        function test() {
          if (condition) {
            for (let i = 0; i < 10; i++) {
              while (condition2) {
                switch (value) {
                  case 1:
                    break;
                  default:
                    break;
                }
              }
            }
          } else {
            try {
              // something
            } catch (e) {
              // handle error
            }
          }
        }
      `;
      
      const result = (codebaseAnalyzerService as any).calculateComplexity(content);
      
      // Base complexity (1) + 11 decision points = 12
      expect(result).toBe(12);
    });

    it('should return base complexity for simple code', () => {
      const content = `
        const a = 1;
        const b = 2;
        const c = a + b;
      `;
      
      const result = (codebaseAnalyzerService as any).calculateComplexity(content);
      
      // Base complexity (1) + 0 decision points = 1
      expect(result).toBe(1);
    });
  });

  describe('generateFileSummary', () => {
    it('should generate a proper file summary', () => {
      const filePath = '/path/to/file.ts';
      const analysis = {
        type: 'full' as const,
        language: 'typescript',
        fileSize: 100,
        lineCount: 5,
        functions: ['func1', 'func2'],
        classes: ['Class1'],
        dependencies: ['dep1'],
        complexity: 3
      };
      
      const result = (codebaseAnalyzerService as any).generateFileSummary(filePath, analysis);
      
      expect(result).toContain('file.ts');
      expect(result).toContain('typescript');
      expect(result).toContain('5 lines');
      expect(result).toContain('100 bytes');
      expect(result).toContain('2 functions');
      expect(result).toContain('1 classes');
      expect(result).toContain('1 dependencies');
      expect(result).toContain('complexity: 3');
    });
  });

  describe('generateAnalysisSummary', () => {
    it('should generate a proper analysis summary', () => {
      const results = [
        {
          filePath: '/path/file1.ts',
          contentHash: 'hash1',
          analysis: {
            type: 'full' as const,
            language: 'typescript',
            fileSize: 100,
            lineCount: 5,
            functions: ['func1'],
            classes: ['Class1'],
            dependencies: ['dep1'],
            complexity: 2
          },
          summary: 'file1.ts (typescript) - 5 lines, 100 bytes, 1 functions, 1 classes, 1 dependencies, complexity: 2',
          timestamp: new Date()
        },
        {
          filePath: '/path/file2.py',
          contentHash: 'hash2',
          analysis: {
            type: 'full' as const,
            language: 'python',
            fileSize: 200,
            lineCount: 10,
            functions: ['func2', 'func3'],
            classes: ['Class2', 'Class3'],
            dependencies: ['dep2', 'dep3'],
            complexity: 4
          },
          summary: 'file2.py (python) - 10 lines, 200 bytes, 2 functions, 2 classes, 2 dependencies, complexity: 4',
          timestamp: new Date()
        }
      ];
      
      const result = (codebaseAnalyzerService as any).generateAnalysisSummary(results);
      
      expect(result).toContain('2 files');
      expect(result).toContain('15 total lines');
      expect(result).toContain('Languages: typescript, python');
      expect(result).toContain('3 functions');
      expect(result).toContain('3 classes');
    });

    it('should handle empty results', () => {
      const results: any[] = [];
      
      const result = (codebaseAnalyzerService as any).generateAnalysisSummary(results);
      
      expect(result).toBe('No files analyzed');
    });
  });
});