/*
 * MIT License
 *
 * Copyright (c) 2024 Lambda Kata Team
 *
 * Global test setup for native licensing validator
 */

/**
 * @fileoverview Global Jest setup
 *
 * This file runs once before all tests and handles global
 * initialization for the native addon testing environment.
 */

export default async function globalSetup(): Promise<void> {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error'; // Reduce log noise in tests

  // Check if native addon is available for testing
  try {
    // Try to load the native addon
    require('../build/Release/native_licensing_validator.node');
    console.log('✓ Native addon available for testing');
  } catch (error) {
    console.warn('⚠ Native addon not available - tests will use fallback behavior');
    console.warn('  Run "yarn build:native" to build the addon for testing');
  }

  // Initialize any global test resources
  console.log('🧪 Global test setup complete');
}
