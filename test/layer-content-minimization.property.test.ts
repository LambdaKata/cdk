/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Work Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_kata_npm_cdk>.
 * Use of this software is governed by the Apache-2.0; see the LICENSE file
 * or https://www.apache.org/licenses/LICENSE-2.0 for details.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Property-Based Tests for Layer Content Minimization
 *
 * Feature: nodejs-layer-management, Property 9: Layer Content Minimization
 *
 * Property 9: Layer Content Minimization
 * *For any* created Node.js layer, the layer package should contain only the Node.js binary
 * in the standard directory structure (/opt/nodejs/bin/) and exclude unnecessary files like
 * documentation or development tools.
 *
 * **Validates: Requirements 5.1, 5.2, 5.3**
 * - Req 5.1: When creating a Node.js Layer, the Layer_Manager shall extract only the Node.js binary from the AWS Lambda runtime image
 * - Req 5.2: The Layer_Manager shall exclude unnecessary files like documentation, headers, and development tools
 * - Req 5.3: When packaging layers, the Layer_Manager shall use the standard Lambda Layer directory structure (/opt/nodejs/bin/)
 *
 * @module layer-content-minimization.property.test
 */

import * as fc from 'fast-check';
import { AWSLayerManager } from '../src/aws-layer-manager';
import { LayerCreationOptions, NodeRuntimeLayerError, ErrorCodes } from '../src/nodejs-layer-manager';
import { ConsoleLogger } from '../src/logger';
import { promises as fs, PathLike } from 'fs';
import { spawn } from 'child_process';
import * as path from 'path';

// Mock dependencies
jest.mock('fs', () => ({
    promises: {
        mkdtemp: jest.fn(),
        stat: jest.fn(),
        chmod: jest.fn(),
        mkdir: jest.fn(),
        copyFile: jest.fn(),
        readFile: jest.fn(),
        rm: jest.fn(),
        unlink: jest.fn(),
        readdir: jest.fn(),
    },
}));

jest.mock('child_process');

// Mock AWS SDK at module level to prevent Jest teardown issues
const mockSend = jest.fn();
const mockDestroy = jest.fn();

jest.mock('@aws-sdk/client-lambda', () => ({
    LambdaClient: jest.fn().mockImplementation(() => ({
        send: mockSend,
        destroy: mockDestroy,
    })),
    PublishLayerVersionCommand: jest.fn(),
    GetLayerVersionCommand: jest.fn(),
    ListLayersCommand: jest.fn(),
    ListLayerVersionsCommand: jest.fn(),
    paginateListLayers: jest.fn(),
    paginateListLayerVersions: jest.fn(),
}));

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

/**
 * Sets up AWS SDK mocks for successful layer operations.
 */
function setupAWSSDKMocks(options: LayerCreationOptions): void {
    // Configure the global mock send function
    mockSend.mockClear();
    mockSend.mockResolvedValue({
        LayerVersionArn: `arn:aws:lambda:${options.region}:123456789012:layer:${options.layerName}:1`,
        Version: 1,
        CreatedDate: new Date().toISOString(),
    });

    // Reset the destroy mock as well
    mockDestroy.mockClear();
}

/**
 * Expected layer directory structure for Node.js layers.
 * This represents the minimal required structure per Requirements 5.1, 5.2, 5.3.
 */
const EXPECTED_LAYER_STRUCTURE = {
    /** Root layer directory */
    ROOT: 'layer',
    /** AWS Lambda /opt directory */
    OPT: 'opt',
    /** Node.js runtime directory */
    NODEJS: 'nodejs',
    /** Binary directory */
    BIN: 'bin',
    /** Node.js binary filename */
    NODE_BINARY: 'node',
} as const;

/**
 * Files and directories that should NOT be present in a minimized layer.
 * These represent documentation, headers, and development tools per Requirement 5.2.
 */
const PROHIBITED_CONTENT = [
    // Documentation files
    'README.md',
    'README.txt',
    'CHANGELOG.md',
    'LICENSE',
    'NOTICE',
    'AUTHORS',
    'CONTRIBUTORS',
    'docs/',
    'documentation/',
    'man/',
    'info/',

    // Header files
    'include/',
    'headers/',
    '*.h',
    '*.hpp',

    // Development tools
    'npm',
    'npx',
    'yarn',
    'pnpm',
    'node-gyp',
    'gyp/',
    'build/',
    'src/',
    'test/',
    'tests/',
    'spec/',
    'specs/',
    'examples/',
    'sample/',
    'samples/',
    'demo/',
    'demos/',

    // Package management
    'package.json',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'node_modules/',

    // Build artifacts
    'Makefile',
    'CMakeLists.txt',
    'configure',
    'config.log',
    'config.status',
    '*.o',
    '*.a',
    '*.so.debug',

    // Version control
    '.git/',
    '.gitignore',
    '.gitattributes',
    '.svn/',
    '.hg/',

    // IDE files
    '.vscode/',
    '.idea/',
    '*.swp',
    '*.swo',
    '*~',
] as const;

/**
 * Arbitrary generator for valid Node.js versions used in AWS Lambda.
 */
const nodeVersion = (): fc.Arbitrary<string> =>
    fc.oneof(
        fc.constant('18.19.0'),
        fc.constant('20.10.0'),
        fc.constant('22.1.0')
    );

/**
 * Arbitrary generator for valid AWS Lambda architectures.
 */
const architecture = (): fc.Arbitrary<'x86_64' | 'arm64'> =>
    fc.oneof(
        fc.constant('x86_64' as const),
        fc.constant('arm64' as const)
    );

/**
 * Arbitrary generator for valid AWS regions.
 */
const awsRegion = (): fc.Arbitrary<string> =>
    fc.constantFrom(
        'us-east-1',
        'us-west-2',
        'eu-west-1',
        'eu-central-1',
        'ap-southeast-1'
    );

/**
 * Arbitrary generator for valid layer creation options.
 */
const layerCreationOptions = (): fc.Arbitrary<LayerCreationOptions> =>
    fc.record({
        layerName: fc.oneof(
            fc.constant('lambda-kata-nodejs-nodejs18.x-x86_64'),
            fc.constant('lambda-kata-nodejs-nodejs20.x-x86_64'),
            fc.constant('lambda-kata-nodejs-nodejs22.x-x86_64'),
            fc.constant('lambda-kata-nodejs-nodejs18.x-arm64'),
            fc.constant('lambda-kata-nodejs-nodejs20.x-arm64'),
            fc.constant('lambda-kata-nodejs-nodejs22.x-arm64')
        ),
        nodeVersion: nodeVersion(),
        architecture: architecture(),
        region: awsRegion(),
        description: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
    });

/**
 * Simulated layer content structure for testing.
 */
interface LayerContentItem {
    /** Relative path within the layer */
    path: string;
    /** Whether this is a directory */
    isDirectory: boolean;
    /** File size in bytes (0 for directories) */
    size: number;
    /** File permissions (octal) */
    permissions: number;
}

/**
 * Creates a minimal valid layer content structure.
 * This represents what should be created per Requirements 5.1, 5.3.
 */
function createMinimalLayerContent(nodeVersion: string, architecture: string): LayerContentItem[] {
    return [
        {
            path: EXPECTED_LAYER_STRUCTURE.ROOT,
            isDirectory: true,
            size: 0,
            permissions: 0o755,
        },
        {
            path: `${EXPECTED_LAYER_STRUCTURE.ROOT}/${EXPECTED_LAYER_STRUCTURE.OPT}`,
            isDirectory: true,
            size: 0,
            permissions: 0o755,
        },
        {
            path: `${EXPECTED_LAYER_STRUCTURE.ROOT}/${EXPECTED_LAYER_STRUCTURE.OPT}/${EXPECTED_LAYER_STRUCTURE.NODEJS}`,
            isDirectory: true,
            size: 0,
            permissions: 0o755,
        },
        {
            path: `${EXPECTED_LAYER_STRUCTURE.ROOT}/${EXPECTED_LAYER_STRUCTURE.OPT}/${EXPECTED_LAYER_STRUCTURE.NODEJS}/${EXPECTED_LAYER_STRUCTURE.BIN}`,
            isDirectory: true,
            size: 0,
            permissions: 0o755,
        },
        {
            path: `${EXPECTED_LAYER_STRUCTURE.ROOT}/${EXPECTED_LAYER_STRUCTURE.OPT}/${EXPECTED_LAYER_STRUCTURE.NODEJS}/${EXPECTED_LAYER_STRUCTURE.BIN}/${EXPECTED_LAYER_STRUCTURE.NODE_BINARY}`,
            isDirectory: false,
            size: getExpectedNodeBinarySize(nodeVersion, architecture),
            permissions: 0o755,
        },
    ];
}

/**
 * Gets the expected size of Node.js binary for given version and architecture.
 * These are approximate sizes based on actual AWS Lambda runtime images.
 */
function getExpectedNodeBinarySize(nodeVersion: string, architecture: string): number {
    const majorVersion = nodeVersion.split('.')[0];
    const baseSize = architecture === 'arm64' ? 45000000 : 50000000; // ~45-50MB

    // Slight variations by version
    const versionMultiplier = {
        '18': 0.95,
        '20': 1.0,
        '22': 1.05,
    }[majorVersion] || 1.0;

    return Math.floor(baseSize * versionMultiplier);
}

/**
 * Creates a layer content structure with prohibited items (for negative testing).
 */
function createLayerContentWithProhibitedItems(nodeVersion: string, architecture: string): LayerContentItem[] {
    const minimalContent = createMinimalLayerContent(nodeVersion, architecture);

    // Add some prohibited items
    const prohibitedItems: LayerContentItem[] = [
        {
            path: `${EXPECTED_LAYER_STRUCTURE.ROOT}/README.md`,
            isDirectory: false,
            size: 1024,
            permissions: 0o644,
        },
        {
            path: `${EXPECTED_LAYER_STRUCTURE.ROOT}/docs`,
            isDirectory: true,
            size: 0,
            permissions: 0o755,
        },
        {
            path: `${EXPECTED_LAYER_STRUCTURE.ROOT}/include`,
            isDirectory: true,
            size: 0,
            permissions: 0o755,
        },
        {
            path: `${EXPECTED_LAYER_STRUCTURE.ROOT}/include/node.h`,
            isDirectory: false,
            size: 2048,
            permissions: 0o644,
        },
    ];

    return [...minimalContent, ...prohibitedItems];
}

/**
 * Validates that layer content contains only essential Node.js binary.
 * Implements the core validation logic for Property 9.
 */
function validateLayerContentMinimization(content: LayerContentItem[]): {
    isMinimal: boolean;
    essentialFiles: LayerContentItem[];
    prohibitedFiles: LayerContentItem[];
    missingRequired: string[];
    structureValid: boolean;
} {
    const essentialFiles: LayerContentItem[] = [];
    const prohibitedFiles: LayerContentItem[] = [];
    const missingRequired: string[] = [];

    // Required paths for valid layer structure
    const requiredPaths = [
        EXPECTED_LAYER_STRUCTURE.ROOT,
        `${EXPECTED_LAYER_STRUCTURE.ROOT}/${EXPECTED_LAYER_STRUCTURE.OPT}`,
        `${EXPECTED_LAYER_STRUCTURE.ROOT}/${EXPECTED_LAYER_STRUCTURE.OPT}/${EXPECTED_LAYER_STRUCTURE.NODEJS}`,
        `${EXPECTED_LAYER_STRUCTURE.ROOT}/${EXPECTED_LAYER_STRUCTURE.OPT}/${EXPECTED_LAYER_STRUCTURE.NODEJS}/${EXPECTED_LAYER_STRUCTURE.BIN}`,
        `${EXPECTED_LAYER_STRUCTURE.ROOT}/${EXPECTED_LAYER_STRUCTURE.OPT}/${EXPECTED_LAYER_STRUCTURE.NODEJS}/${EXPECTED_LAYER_STRUCTURE.BIN}/${EXPECTED_LAYER_STRUCTURE.NODE_BINARY}`,
    ];

    // Check for required paths
    const presentPaths = new Set(content.map(item => item.path));
    for (const requiredPath of requiredPaths) {
        if (!presentPaths.has(requiredPath)) {
            missingRequired.push(requiredPath);
        }
    }

    // Classify content items
    for (const item of content) {
        const isRequired = requiredPaths.includes(item.path);

        // Only check for prohibited content if it's not a required path
        const isProhibited = !isRequired && PROHIBITED_CONTENT.some(prohibited => {
            if (prohibited.endsWith('/')) {
                const dirName = prohibited.slice(0, -1);
                // More precise matching: check if the path contains this directory as a separate component
                const pathParts = item.path.split('/');
                return pathParts.includes(dirName);
            }
            if (prohibited.includes('*')) {
                // Handle wildcard patterns more precisely
                if (prohibited.startsWith('*.')) {
                    // File extension pattern like *.o, *.h
                    const extension = prohibited.substring(2);
                    return item.path.endsWith('.' + extension);
                } else {
                    // General wildcard pattern
                    const pattern = prohibited.replace(/\*/g, '.*');
                    return new RegExp(pattern).test(item.path);
                }
            }
            // For exact matches, check if it's the filename or part of the path
            const pathParts = item.path.split('/');
            return pathParts.includes(prohibited);
        });

        if (isRequired) {
            essentialFiles.push(item);
        } else if (isProhibited) {
            prohibitedFiles.push(item);
        }
    }

    const structureValid = missingRequired.length === 0;
    const isMinimal = prohibitedFiles.length === 0 && structureValid;

    return {
        isMinimal,
        essentialFiles,
        prohibitedFiles,
        missingRequired,
        structureValid,
    };
}

/**
 * Mock setup helper for successful layer creation with minimal content.
 */
function setupSuccessfulLayerCreation(options: LayerCreationOptions): void {
    const tempDir = `/tmp/lambda-kata-layer-${Date.now()}`;
    const layerContent = createMinimalLayerContent(options.nodeVersion, options.architecture);

    // Reset all mocks
    jest.clearAllMocks();

    // Setup AWS SDK mocks
    setupAWSSDKMocks(options);

    // Mock temp directory creation
    mockedFs.mkdtemp.mockResolvedValue(tempDir);

    // Mock successful Docker operations
    let dockerCallCount = 0;
    const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
            if (event === 'close') {
                dockerCallCount++;
                setTimeout(() => callback(0), 10); // Success
            }
        }),
        kill: jest.fn(),
    };
    mockedSpawn.mockReturnValue(mockProcess as any);

    // Mock file operations to simulate minimal layer content
    mockedFs.stat.mockImplementation(async (filePath: PathLike) => {
        const pathStr = String(filePath);

        // Handle the extracted Node.js binary specifically
        if (pathStr.endsWith('/node') && !pathStr.includes('layer/')) {
            return {
                isFile: () => true,
                isDirectory: () => false,
                size: getExpectedNodeBinarySize(options.nodeVersion, options.architecture),
            } as any;
        }

        // Handle layer content structure
        const contentItem = layerContent.find(item => pathStr.includes(item.path));
        if (contentItem) {
            return {
                isFile: () => !contentItem.isDirectory,
                isDirectory: () => contentItem.isDirectory,
                size: contentItem.size,
            } as any;
        }

        throw new Error(`File not found: ${pathStr}`);
    });

    // Mock directory reading to return minimal content
    mockedFs.readdir.mockImplementation(async (dirPath: PathLike) => {
        const pathStr = String(dirPath);

        // Return appropriate directory contents based on path
        if (pathStr.includes('layer')) {
            return [{ name: 'opt', isDirectory: () => true }] as any;
        } else if (pathStr.includes('opt')) {
            return [{ name: 'nodejs', isDirectory: () => true }] as any;
        } else if (pathStr.includes('nodejs')) {
            return [{ name: 'bin', isDirectory: () => true }] as any;
        } else if (pathStr.includes('bin')) {
            return [{ name: 'node', isDirectory: () => false }] as any;
        }

        return [] as any;
    });

    // Mock ZIP file reading to return minimal content
    mockedFs.readFile.mockResolvedValue(Buffer.from('minimal-zip-content'));

    // Mock other required file operations
    mockedFs.mkdir.mockResolvedValue(undefined);
    mockedFs.copyFile.mockResolvedValue(undefined);
    mockedFs.chmod.mockResolvedValue(undefined);
    mockedFs.rm.mockResolvedValue(undefined);
    mockedFs.unlink.mockResolvedValue(undefined);
}

// Feature: nodejs-layer-management, Property 9: Layer Content Minimization
describe('Feature: nodejs-layer-management, Property 9: Layer Content Minimization', () => {
    let layerManager: AWSLayerManager;
    let mockLogger: jest.Mocked<ConsoleLogger>;

    beforeEach(() => {
        // Create mock logger
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        } as any;

        layerManager = new AWSLayerManager({
            logger: mockLogger,
        });
    });

    afterEach(() => {
        layerManager.destroy();
    });

    /**
     * **Property 9: Layer Content Minimization**
     * **Validates: Requirements 5.1, 5.2, 5.3**
     * 
     * For any created Node.js layer, the layer package should contain only the Node.js binary
     * in the standard directory structure (/opt/nodejs/bin/) and exclude unnecessary files.
     */
    describe('Property 9: Layer Content Minimization', () => {
        /**
         * **Validates: Requirements 5.1, 5.3**
         *
         * For any valid layer creation options, the created layer should contain
         * only the Node.js binary in the correct directory structure.
         */
        it('should create layers with only essential Node.js binary in correct structure', () => {
            return fc.assert(
                fc.asyncProperty(
                    layerCreationOptions(),
                    async (options) => {
                        setupSuccessfulLayerCreation(options);

                        // Create the layer
                        const layerInfo = await layerManager.createNodeLayer(options);

                        // Verify layer was created successfully
                        expect(layerInfo).toBeDefined();
                        expect(layerInfo.arn).toContain(options.layerName);
                        expect(layerInfo.nodeVersion).toBe(options.nodeVersion);
                        expect(layerInfo.architecture).toBe(options.architecture);

                        // Verify directory structure was created correctly
                        const mkdirCalls = mockedFs.mkdir.mock.calls;
                        const expectedBinPath = expect.stringContaining('/opt/nodejs/bin');
                        expect(mkdirCalls.some(call => String(call[0]).includes('opt/nodejs/bin'))).toBe(true);

                        // Verify only Node.js binary was copied
                        const copyFileCalls = mockedFs.copyFile.mock.calls;
                        expect(copyFileCalls.length).toBe(1);
                        expect(String(copyFileCalls[0][1])).toMatch(/\/bin\/node$/);

                        // Verify binary permissions were set correctly
                        const chmodCalls = mockedFs.chmod.mock.calls;
                        const nodeBinaryChmod = chmodCalls.find(call =>
                            String(call[0]).endsWith('/node')
                        );
                        expect(nodeBinaryChmod).toBeDefined();
                        expect(nodeBinaryChmod![1]).toBe(0o755);

                        return true;
                    }
                ),
                { numRuns: 15 }
            );
        });

        /**
         * **Validates: Requirement 5.2**
         *
         * For any layer creation, the layer should exclude unnecessary files
         * like documentation, headers, and development tools.
         */
        it('should exclude prohibited content from layers', () => {
            return fc.assert(
                fc.property(
                    nodeVersion(),
                    architecture(),
                    (nodeVer, arch) => {
                        // Test with minimal content (should pass)
                        const minimalContent = createMinimalLayerContent(nodeVer, arch);
                        const minimalValidation = validateLayerContentMinimization(minimalContent);

                        expect(minimalValidation.isMinimal).toBe(true);
                        expect(minimalValidation.prohibitedFiles).toHaveLength(0);
                        expect(minimalValidation.structureValid).toBe(true);

                        // Test with prohibited content (should fail)
                        const prohibitedContent = createLayerContentWithProhibitedItems(nodeVer, arch);
                        const prohibitedValidation = validateLayerContentMinimization(prohibitedContent);

                        expect(prohibitedValidation.isMinimal).toBe(false);
                        expect(prohibitedValidation.prohibitedFiles.length).toBeGreaterThan(0);

                        // Verify specific prohibited items are detected
                        const prohibitedPaths = prohibitedValidation.prohibitedFiles.map(f => f.path);
                        expect(prohibitedPaths.some(p => p.includes('README.md'))).toBe(true);
                        expect(prohibitedPaths.some(p => p.includes('docs'))).toBe(true);
                        expect(prohibitedPaths.some(p => p.includes('include'))).toBe(true);

                        return true;
                    }
                ),
                { numRuns: 15 }
            );
        });

        /**
         * **Validates: Requirement 5.3**
         *
         * For any layer creation, the layer should use the standard Lambda Layer
         * directory structure (/opt/nodejs/bin/).
         */
        it('should enforce correct Lambda Layer directory structure', () => {
            return fc.assert(
                fc.property(
                    nodeVersion(),
                    architecture(),
                    (nodeVer, arch) => {
                        const content = createMinimalLayerContent(nodeVer, arch);
                        const validation = validateLayerContentMinimization(content);

                        // Verify all required paths are present
                        expect(validation.missingRequired).toHaveLength(0);
                        expect(validation.structureValid).toBe(true);

                        // Verify essential files include all required structure
                        const essentialPaths = validation.essentialFiles.map(f => f.path);
                        expect(essentialPaths).toContain(EXPECTED_LAYER_STRUCTURE.ROOT);
                        expect(essentialPaths.some(p => p.includes('/opt'))).toBe(true);
                        expect(essentialPaths.some(p => p.includes('/nodejs'))).toBe(true);
                        expect(essentialPaths.some(p => p.includes('/bin'))).toBe(true);
                        expect(essentialPaths.some(p => p.endsWith('/node'))).toBe(true);

                        return true;
                    }
                ),
                { numRuns: 15 }
            );
        });

        /**
         * **Validates: Requirements 5.1, 5.2, 5.3**
         *
         * For any layer content validation, the function should correctly
         * identify minimal vs non-minimal layers.
         */
        it('should correctly validate layer content minimization', () => {
            return fc.assert(
                fc.property(
                    nodeVersion(),
                    architecture(),
                    fc.boolean(), // whether to include prohibited content
                    (nodeVer, arch, includeProhibited) => {
                        const content = includeProhibited
                            ? createLayerContentWithProhibitedItems(nodeVer, arch)
                            : createMinimalLayerContent(nodeVer, arch);

                        const validation = validateLayerContentMinimization(content);

                        if (includeProhibited) {
                            // Should detect prohibited content
                            expect(validation.isMinimal).toBe(false);
                            expect(validation.prohibitedFiles.length).toBeGreaterThan(0);
                        } else {
                            // Should pass minimization check
                            expect(validation.isMinimal).toBe(true);
                            expect(validation.prohibitedFiles).toHaveLength(0);
                        }

                        // Structure should always be valid for our test data
                        expect(validation.structureValid).toBe(true);
                        expect(validation.missingRequired).toHaveLength(0);

                        return true;
                    }
                ),
                { numRuns: 15 }
            );
        });

        /**
         * **Validates: Requirements 5.1, 5.2, 5.3**
         *
         * For any Node.js version and architecture combination, the expected
         * binary size should be reasonable and the structure should be correct.
         */
        it('should generate appropriate binary sizes and structure for all combinations', () => {
            return fc.assert(
                fc.property(
                    nodeVersion(),
                    architecture(),
                    (nodeVer, arch) => {
                        const expectedSize = getExpectedNodeBinarySize(nodeVer, arch);
                        const content = createMinimalLayerContent(nodeVer, arch);

                        // Verify binary size is reasonable (between 30MB and 70MB)
                        expect(expectedSize).toBeGreaterThan(30 * 1024 * 1024);
                        expect(expectedSize).toBeLessThan(70 * 1024 * 1024);

                        // Verify content structure
                        const nodeBinary = content.find(item =>
                            item.path.endsWith('/node') && !item.isDirectory
                        );
                        expect(nodeBinary).toBeDefined();
                        expect(nodeBinary!.size).toBe(expectedSize);
                        expect(nodeBinary!.permissions).toBe(0o755);

                        // Verify all directories have correct permissions
                        const directories = content.filter(item => item.isDirectory);
                        directories.forEach(dir => {
                            expect(dir.permissions).toBe(0o755);
                            expect(dir.size).toBe(0);
                        });

                        return true;
                    }
                ),
                { numRuns: 15 }
            );
        });
    });

    /**
     * Unit tests for layer content validation logic
     */
    describe('Layer Content Validation Logic', () => {
        it('should correctly identify prohibited content patterns', () => {
            const testCases = [
                { path: 'layer/README.md', shouldBeProhibited: true },
                { path: 'layer/docs/api.md', shouldBeProhibited: true },
                { path: 'layer/include/node.h', shouldBeProhibited: true },
                { path: 'layer/opt/nodejs/bin/node', shouldBeProhibited: false },
                { path: 'layer/opt', shouldBeProhibited: false },
                { path: 'layer/package.json', shouldBeProhibited: true },
                { path: 'layer/node_modules/express', shouldBeProhibited: true },
            ];

            testCases.forEach(({ path, shouldBeProhibited }) => {
                const matchingProhibited: string[] = [];
                const isProhibited = PROHIBITED_CONTENT.some(prohibited => {
                    let matches = false;
                    if (prohibited.endsWith('/')) {
                        const dirName = prohibited.slice(0, -1);
                        const pathParts = path.split('/');
                        matches = pathParts.includes(dirName);
                    } else if (prohibited.includes('*')) {
                        // Handle wildcard patterns more precisely
                        if (prohibited.startsWith('*.')) {
                            // File extension pattern like *.o, *.h
                            const extension = prohibited.substring(2);
                            matches = path.endsWith('.' + extension);
                        } else {
                            // General wildcard pattern
                            const pattern = prohibited.replace(/\*/g, '.*');
                            matches = new RegExp(pattern).test(path);
                        }
                    } else {
                        const pathParts = path.split('/');
                        matches = pathParts.includes(prohibited);
                    }

                    if (matches) {
                        matchingProhibited.push(prohibited);
                    }
                    return matches;
                });

                if (isProhibited !== shouldBeProhibited) {
                    console.log(`Pattern mismatch for ${path}: expected ${shouldBeProhibited}, got ${isProhibited}, matching: ${matchingProhibited.join(', ')}`);
                }
                expect(isProhibited).toBe(shouldBeProhibited);
            });
        });

        it('should validate required directory structure', () => {
            const content = createMinimalLayerContent('20.10.0', 'x86_64');
            const validation = validateLayerContentMinimization(content);

            expect(validation.structureValid).toBe(true);
            expect(validation.missingRequired).toHaveLength(0);
            expect(validation.essentialFiles).toHaveLength(5); // 4 directories + 1 binary
        });

        it('should detect missing required paths', () => {
            // Create incomplete content (missing binary)
            const incompleteContent = createMinimalLayerContent('20.10.0', 'x86_64')
                .filter(item => !item.path.endsWith('/node'));

            const validation = validateLayerContentMinimization(incompleteContent);

            expect(validation.structureValid).toBe(false);
            expect(validation.missingRequired.length).toBeGreaterThan(0);
            expect(validation.missingRequired.some(path => path.endsWith('/node'))).toBe(true);
        });
    });
});
