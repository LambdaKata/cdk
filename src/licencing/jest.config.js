/*
 * MIT License
 * 
 * Copyright (c) 2024 Lambda Kata Team
 * 
 * Jest configuration for native licensing validator
 */

/** @type {import('jest').Config} */
module.exports = {
    // Use ts-jest preset for TypeScript support
    preset: 'ts-jest',

    // Test environment
    testEnvironment: 'node',

    // Test file patterns
    testMatch: [
        '<rootDir>/test/**/*.test.ts',
        '<rootDir>/test/**/*.property.test.ts'
    ],

    // Coverage configuration
    collectCoverage: true,
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.d.ts',
        '!src/**/*.test.ts',
        '!src/**/*.spec.ts'
    ],

    // Coverage thresholds
    coverageThreshold: {
        global: {
            branches: 80,
            functions: 80,
            lines: 80,
            statements: 80
        }
    },

    // Module resolution
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

    // Transform configuration
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: 'tsconfig.json'
        }]
    },

    // Setup files
    setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],

    // Test timeout (15 seconds to prevent hanging)
    testTimeout: 15000,

    // Force Jest to exit after tests complete
    forceExit: true,

    // Detect open handles that prevent Jest from exiting
    detectOpenHandles: true,

    // Verbose output for debugging
    verbose: true,

    // Clear mocks between tests
    clearMocks: true,

    // Restore mocks after each test
    restoreMocks: true,

    // Reset modules between tests to prevent state leakage
    resetModules: true,

    // Error handling
    errorOnDeprecated: true,

    // Prevent Jest from hanging on unresolved promises
    openHandlesTimeout: 5000,

    // Use single worker to prevent race conditions (runInBand handles this)
    // maxWorkers: 1, // Removed - conflicts with runInBand

    // Disable cache to prevent stale test results
    cache: false,

    // Module name mapping for native addon
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1'
    },

    // Global setup for native addon testing
    globalSetup: '<rootDir>/test/global-setup.ts',
    globalTeardown: '<rootDir>/test/global-teardown.ts',

    // Test environment options
    testEnvironmentOptions: {
        // Node.js environment variables for testing
        NODE_ENV: 'test'
    },

    // Bail on first test failure to prevent cascading issues
    bail: false,

    // Maximum number of concurrent test suites (runInBand handles this)
    // maxConcurrency: 1, // Removed - conflicts with runInBand

    // Automatically clear mock calls and instances between every test
    clearMocks: true,

    // Automatically restore mock state between every test
    restoreMocks: true,

    // The paths to modules that run some code to configure or set up the testing framework before each test
    setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],

    // Indicates whether each individual test should be reported during the run
    verbose: true
};