import { Knex } from 'knex';

// Mock database connection and query builder
const mockKnex = jest.fn(() => ({
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  returning: jest.fn().mockResolvedValue([]),
  then: jest.fn(function(resolve) {
    resolve([]);
    return this;
  }),
  catch: jest.fn(function() {
    return this;
  })
}));

// Mock the database module
export const db = {
  // Mock Knex query builder
  queryBuilder: mockKnex(),
  
  // Mock Knex instance methods
  select: mockKnex,
  from: mockKnex,
  where: mockKnex,
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  
  // Mock transactions
  transaction: jest.fn(callback => {
    const trx = {
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      ...mockKnex()
    };
    return Promise.resolve(callback(trx));
  }),
  
  // Mock migrations
  migrate: {
    latest: jest.fn().mockResolvedValue([]),
    rollback: jest.fn().mockResolvedValue([]),
    currentVersion: jest.fn().mockResolvedValue('20240101000000'),
  },
  
  // Mock schema operations
  schema: {
    createTable: jest.fn().mockReturnThis(),
    dropTableIfExists: jest.fn().mockReturnThis(),
    hasTable: jest.fn().mockResolvedValue(true),
    alterTable: jest.fn().mockReturnThis(),
    raw: jest.fn().mockReturnThis(),
    then: jest.fn(function(resolve) {
      resolve(true);
      return this;
    })
  },
  
  // Mock raw queries
  raw: jest.fn().mockReturnThis(),
  
  // Mock connection handling
  destroy: jest.fn().mockResolvedValue(undefined),
  
  // Test helper methods
  _resetMocks: function() {
    this.queryBuilder = mockKnex();
    this.insert = jest.fn().mockReturnThis();
    this.update = jest.fn().mockReturnThis();
    this.delete = jest.fn().mockReturnThis();
    this.transaction = jest.fn(callback => {
      const trx = {
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        ...mockKnex()
      };
      return Promise.resolve(callback(trx));
    });
    this.migrate.latest.mockClear();
    this.migrate.rollback.mockClear();
    this.schema.createTable.mockClear();
    this.schema.dropTableIfExists.mockClear();
    this.schema.hasTable.mockClear();
    this.raw.mockClear();
    this.destroy.mockClear();
  }
};

export default db;
