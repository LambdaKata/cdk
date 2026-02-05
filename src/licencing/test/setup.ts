/*
 * MIT License
 *
 * Copyright (c) 2024 Lambda Kata Team
 *
 * Jest setup file for native licensing validator tests
 */

/**
 * @fileoverview Test setup and configuration
 *
 * This file is executed before each test file and provides
 * common setup, mocks, and utilities for testing the native
 * licensing validator.
 */

// Set test environment
process.env.NODE_ENV = 'test';

// Set shorter timeout to prevent hanging tests
jest.setTimeout(5000);

// Mock the native addon loading to prevent actual native code execution
jest.mock('../build/Release/native_licensing_validator.node', () => {
  throw new Error('Native addon not available in test environment');
}, { virtual: true });

// Mock console methods in test environment to reduce noise
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;
const originalConsoleLog = console.log;

// Store original timers
const originalSetTimeout = global.setTimeout;
const originalSetInterval = global.setInterval;
const originalClearTimeout = global.clearTimeout;
const originalClearInterval = global.clearInterval;

// Track active timers to prevent hanging
const activeTimers = new Set<NodeJS.Timeout>();

beforeEach(() => {
  // Reset console mocks before each test
  console.warn = jest.fn();
  console.error = jest.fn();
  console.log = jest.fn();

  // Clear any active timers
  activeTimers.forEach(timer => {
    originalClearTimeout(timer);
    originalClearInterval(timer);
  });
  activeTimers.clear();

  // Don't mock timers globally as it causes TypeScript issues
  // Individual tests can mock timers if needed
});

afterEach(() => {
  // Restore console methods after each test
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
  console.log = originalConsoleLog;

  // Clear any remaining timers
  activeTimers.forEach(timer => {
    originalClearTimeout(timer);
    originalClearInterval(timer);
  });
  activeTimers.clear();

  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
});

// Ensure no actual network calls are made during testing
beforeAll(() => {
  // Mock any potential HTTP libraries
  jest.mock('https', () => ({
    request: jest.fn().mockImplementation(() => {
      throw new Error('Network calls not allowed in tests');
    }),
    get: jest.fn().mockImplementation(() => {
      throw new Error('Network calls not allowed in tests');
    }),
  }));

  jest.mock('http', () => ({
    request: jest.fn().mockImplementation(() => {
      throw new Error('Network calls not allowed in tests');
    }),
    get: jest.fn().mockImplementation(() => {
      throw new Error('Network calls not allowed in tests');
    }),
  }));

  // Mock fetch if available
  if (global.fetch) {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network calls not allowed in tests'));
  }
});

afterAll(() => {
  // Final cleanup
  activeTimers.forEach(timer => {
    originalClearTimeout(timer);
    originalClearInterval(timer);
  });
  activeTimers.clear();
});

// Global test utilities
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidAccountId(): R;

      toBeFailClosedResponse(): R;
    }
  }
}

// Custom Jest matchers
expect.extend({
  /**
   * Check if a string is a valid AWS account ID
   */
  toBeValidAccountId(received: string) {
    const pass = typeof received === 'string' &&
      received.length === 12 &&
      /^\d{12}$/.test(received);

    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid account ID`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid 12-digit account ID`,
        pass: false,
      };
    }
  },

  /**
   * Check if a response follows fail-closed pattern
   */
  toBeFailClosedResponse(received: any) {
    const pass = typeof received === 'object' &&
      received !== null &&
      received.entitled === false &&
      typeof received.message === 'string' &&
      received.message.length > 0;

    if (pass) {
      return {
        message: () => `expected response not to be fail-closed`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected response to be fail-closed with entitled: false and non-empty message`,
        pass: false,
      };
    }
  },
});

// Test data generators for property-based testing
export const TestData = {
  /**
   * Generate valid AWS account IDs
   */
  validAccountId(): string {
    return Math.floor(Math.random() * 900000000000 + 100000000000).toString();
  },

  /**
   * Generate invalid account IDs
   */
  invalidAccountIds(): string[] {
    return [
      '', // Empty string
      '123', // Too short
      '1234567890123', // Too long
      '12345678901a', // Contains letter
      '123456789012.0', // Contains decimal
      'abcdefghijkl', // All letters
      '123-456-789-012', // Contains dashes
      ' 123456789012', // Leading space
      '123456789012 ', // Trailing space
    ];
  },

  /**
   * Generate test licensing responses
   */
  licensingResponse(entitled: boolean = true) {
    if (entitled) {
      return {
        entitled: true,
        layerArn: `arn:aws:lambda:us-east-1:${this.validAccountId()}:layer:lambda-kata:1`,
        message: 'Account entitled until 2025-12-31',
        expiresAt: '2025-12-31T23:59:59Z',
      };
    } else {
      return {
        entitled: false,
        message: 'Account not entitled',
      };
    }
  },
};

// Export for use in tests
export default TestData;
