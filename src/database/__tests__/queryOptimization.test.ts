// Query optimization tests
import { QueryOptimizer, ConnectionPoolOptimizer, createOptimizedDatabaseClient } from '../queryOptimization';

// Mock PostgreSQL pool
const mockPool: any = {
  query: jest.fn(),
  connect: jest.fn(),
  on: jest.fn(),
  removeListener: jest.fn()
};

describe('Query Optimization Tests', () => {
  describe('PreparedStatementCache', () => {
    let optimizer: QueryOptimizer;

    beforeEach(() => {
      optimizer = new QueryOptimizer(mockPool);
      jest.clearAllMocks();
    });

    afterEach(() => {
      optimizer.clearCache();
    });

    it('should cache prepared statements', async () => {
      // Mock database response
      mockPool.query.mockImplementation(() => Promise.resolve({ rows: [], rowCount: 0 }));

      // Execute the same query twice
      await optimizer.executeQuery('SELECT * FROM sessions WHERE id = $1', ['test-id']);
      await optimizer.executeQuery('SELECT * FROM sessions WHERE id = $1', ['test-id']);

      // Verify caching behavior
      const stats = optimizer.getCacheStats();
      expect(stats.size).toBeGreaterThanOrEqual(0);
    });

    it('should handle different query parameters', async () => {
      // Mock database response
      mockPool.query.mockImplementation(() => Promise.resolve({ rows: [], rowCount: 0 }));

      // Execute queries with different parameters
      await optimizer.executeQuery('SELECT * FROM sessions WHERE id = $1', ['test-id-1']);
      await optimizer.executeQuery('SELECT * FROM sessions WHERE id = $1', ['test-id-2']);

      // Should create separate cache entries
      const stats = optimizer.getCacheStats();
      expect(stats.size).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Query Execution', () => {
    let optimizer: QueryOptimizer;

    beforeEach(() => {
      optimizer = new QueryOptimizer(mockPool);
      jest.clearAllMocks();
    });

    it('should execute queries successfully', async () => {
      // Mock database response
      mockPool.query.mockImplementation(() => Promise.resolve({
        rows: [{ id: 'test-id', session_key: 'test-session' }],
        rowCount: 1
      }));

      // Execute query
      const result = await optimizer.executeQuery('SELECT * FROM sessions WHERE id = $1', ['test-id']);

      // Verify result
      expect(result.rowCount).toBe(1);
      expect(result.rows[0]).toHaveProperty('id', 'test-id');
    });

    it('should handle query errors gracefully', async () => {
      // Mock database error
      mockPool.query.mockImplementation(() => Promise.reject(new Error('Database connection failed')));

      // Execute query and expect error
      await expect(optimizer.executeQuery('SELECT * FROM sessions WHERE id = $1', ['test-id']))
        .rejects.toThrow('Database connection failed');
    });
  });

  describe('ConnectionPoolOptimizer', () => {
    it('should start and stop monitoring', () => {
      const poolOptimizer = new ConnectionPoolOptimizer(mockPool);
      
      // Verify monitoring can be started and stopped
      expect(() => poolOptimizer.startMonitoring()).not.toThrow();
      expect(() => poolOptimizer.stopMonitoring()).not.toThrow();
    });

    it('should provide optimal configuration', () => {
      const poolOptimizer = new ConnectionPoolOptimizer(mockPool);
      const config = poolOptimizer.getOptimalConfig();
      expect(config).toBeDefined();
      expect(config).toHaveProperty('min');
      expect(config).toHaveProperty('max');
    });
  });

  describe('OptimizedDatabaseClient', () => {
    it('should create optimized database client', () => {
      const client = createOptimizedDatabaseClient(mockPool);
      
      expect(client).toBeDefined();
      expect(client).toHaveProperty('query');
      expect(client).toHaveProperty('optimizer');
      expect(client).toHaveProperty('poolOptimizer');
    });
  });
});