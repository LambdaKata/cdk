/*
 * MIT License
 *
 * Copyright (c) 2024 Lambda Kata Team
 *
 * Global test teardown for native licensing validator
 */

/**
 * @fileoverview Global Jest teardown
 *
 * This file runs once after all tests and handles global
 * cleanup for the native addon testing environment.
 */

export default async function globalTeardown(): Promise<void> {
  // Clean up any global test resources
  console.log('🧹 Global test teardown complete');
}
