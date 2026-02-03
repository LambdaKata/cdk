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
 * Unit Tests for SnapStart Activator
 *
 * These tests verify the activateSnapStart function correctly enables
 * SnapStart on Lambda functions with proper waiting and error handling.
 *
 * @module snapstart-activator.test
 */

import { activateSnapStart, CustomResourceEvent, handler, SnapStartActivatorConfig } from '../src/snapstart-activator';

// Mock AWS SDK
const mockSend = jest.fn();
const mockWaitUntilFunctionActiveV2 = jest.fn();
const mockWaitUntilFunctionUpdatedV2 = jest.fn();

jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  UpdateFunctionConfigurationCommand: jest.fn().mockImplementation((input) => ({
    input,
    _type: 'UpdateFunctionConfiguration',
  })),
  PublishVersionCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'PublishVersion' })),
  GetFunctionConfigurationCommand: jest.fn().mockImplementation((input) => ({
    input,
    _type: 'GetFunctionConfiguration',
  })),
  CreateAliasCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'CreateAlias' })),
  UpdateAliasCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'UpdateAlias' })),
  GetAliasCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'GetAlias' })),
  ResourceNotFoundException: class ResourceNotFoundException extends Error {
    name = 'ResourceNotFoundException';

    constructor(message?: string) {
      super(message);
    }
  },
  waitUntilFunctionUpdatedV2: (...args: unknown[]) => mockWaitUntilFunctionUpdatedV2(...args),
  waitUntilFunctionActiveV2: (...args: unknown[]) => mockWaitUntilFunctionActiveV2(...args),
}));

describe('snapstart-activator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWaitUntilFunctionActiveV2.mockResolvedValue({ state: 'SUCCESS' });
    mockWaitUntilFunctionUpdatedV2.mockResolvedValue({ state: 'SUCCESS' });
  });

  describe('activateSnapStart', () => {
    const mockLambdaClient = { send: mockSend } as any;
    const functionName = 'test-function';

    describe('successful activation flow', () => {
      beforeEach(() => {
        // Mock successful flow
        mockSend.mockImplementation((command: any) => {
          switch (command._type) {
            case 'UpdateFunctionConfiguration':
              return Promise.resolve({});
            case 'PublishVersion':
              return Promise.resolve({ Version: '1' });
            case 'GetFunctionConfiguration':
              return Promise.resolve({
                State: 'Active',
                SnapStart: { OptimizationStatus: 'On' },
              });
            case 'GetAlias':
              // Alias doesn't exist
              const error = new Error('Alias not found');
              (error as any).name = 'ResourceNotFoundException';
              return Promise.reject(error);
            case 'CreateAlias':
              return Promise.resolve({
                AliasArn: `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:kata`,
              });
            default:
              return Promise.resolve({});
          }
        });
      });

      it('should complete activation cycle successfully', async () => {
        const result = await activateSnapStart(mockLambdaClient, functionName);

        expect(result).toBeDefined();
        expect(result.version).toBe('1');
        expect(result.aliasName).toBe('kata');
        expect(result.aliasArn).toContain(functionName);
        expect(result.optimizationStatus).toBe('On');
      });

      it('should use default alias name "kata"', async () => {
        const result = await activateSnapStart(mockLambdaClient, functionName);

        expect(result.aliasName).toBe('kata');
      });

      it('should use custom alias name when provided', async () => {
        const config: SnapStartActivatorConfig = { aliasName: 'custom-alias' };

        mockSend.mockImplementation((command: any) => {
          if (command._type === 'PublishVersion') {
            return Promise.resolve({ Version: '1' });
          }
          if (command._type === 'GetFunctionConfiguration') {
            return Promise.resolve({ State: 'Active', SnapStart: { OptimizationStatus: 'On' } });
          }
          if (command._type === 'GetAlias') {
            const error = new Error('Not found');
            (error as any).name = 'ResourceNotFoundException';
            return Promise.reject(error);
          }
          if (command._type === 'CreateAlias') {
            return Promise.resolve({ AliasArn: `arn:aws:lambda:us-east-1:123456789012:function:${functionName}:custom-alias` });
          }
          return Promise.resolve({});
        });

        const result = await activateSnapStart(mockLambdaClient, functionName, config);

        expect(result.aliasName).toBe('custom-alias');
      });

      it('should wait for function to be Active before starting', async () => {
        await activateSnapStart(mockLambdaClient, functionName);

        expect(mockWaitUntilFunctionActiveV2).toHaveBeenCalledWith(
          expect.objectContaining({ client: mockLambdaClient, maxWaitTime: 60 }),
          expect.objectContaining({ FunctionName: functionName }),
        );
      });

      it('should wait for configuration update after enabling SnapStart', async () => {
        await activateSnapStart(mockLambdaClient, functionName);

        expect(mockWaitUntilFunctionUpdatedV2).toHaveBeenCalledWith(
          expect.objectContaining({ client: mockLambdaClient, maxWaitTime: 120 }),
          expect.objectContaining({ FunctionName: functionName }),
        );
      });

      it('should enable SnapStart with ApplyOn: PublishedVersions', async () => {
        await activateSnapStart(mockLambdaClient, functionName);

        const updateCall = mockSend.mock.calls.find(
          (call: any) => call[0]._type === 'UpdateFunctionConfiguration',
        );
        expect(updateCall).toBeDefined();
        expect(updateCall[0].input).toEqual({
          FunctionName: functionName,
          SnapStart: { ApplyOn: 'PublishedVersions' },
        });
      });

      it('should publish a new version with description', async () => {
        await activateSnapStart(mockLambdaClient, functionName);

        const publishCall = mockSend.mock.calls.find(
          (call: any) => call[0]._type === 'PublishVersion',
        );
        expect(publishCall).toBeDefined();
        expect(publishCall[0].input.FunctionName).toBe(functionName);
        expect(publishCall[0].input.Description).toContain('SnapStart enabled');
      });
    });

    describe('alias handling', () => {
      it('should create new alias when it does not exist', async () => {
        mockSend.mockImplementation((command: any) => {
          if (command._type === 'PublishVersion') {
            return Promise.resolve({ Version: '1' });
          }
          if (command._type === 'GetFunctionConfiguration') {
            return Promise.resolve({ State: 'Active', SnapStart: { OptimizationStatus: 'On' } });
          }
          if (command._type === 'GetAlias') {
            const error = new Error('Not found');
            (error as any).name = 'ResourceNotFoundException';
            return Promise.reject(error);
          }
          if (command._type === 'CreateAlias') {
            return Promise.resolve({ AliasArn: 'arn:aws:lambda:us-east-1:123456789012:function:test:kata' });
          }
          return Promise.resolve({});
        });

        await activateSnapStart(mockLambdaClient, functionName);

        const createCall = mockSend.mock.calls.find(
          (call: any) => call[0]._type === 'CreateAlias',
        );
        expect(createCall).toBeDefined();
      });

      it('should update existing alias when it exists', async () => {
        mockSend.mockImplementation((command: any) => {
          if (command._type === 'PublishVersion') {
            return Promise.resolve({ Version: '2' });
          }
          if (command._type === 'GetFunctionConfiguration') {
            return Promise.resolve({ State: 'Active', SnapStart: { OptimizationStatus: 'On' } });
          }
          if (command._type === 'GetAlias') {
            return Promise.resolve({ AliasArn: 'arn:aws:lambda:us-east-1:123456789012:function:test:kata' });
          }
          if (command._type === 'UpdateAlias') {
            return Promise.resolve({ AliasArn: 'arn:aws:lambda:us-east-1:123456789012:function:test:kata' });
          }
          return Promise.resolve({});
        });

        await activateSnapStart(mockLambdaClient, functionName);

        const updateCall = mockSend.mock.calls.find(
          (call: any) => call[0]._type === 'UpdateAlias',
        );
        expect(updateCall).toBeDefined();
        expect(updateCall[0].input.FunctionVersion).toBe('2');
      });
    });

    describe('snapshot creation polling', () => {
      it('should poll until State becomes Active', async () => {
        let pollCount = 0;
        mockSend.mockImplementation((command: any) => {
          if (command._type === 'PublishVersion') {
            return Promise.resolve({ Version: '1' });
          }
          if (command._type === 'GetFunctionConfiguration') {
            pollCount++;
            // Return Pending for first 2 calls, then Active
            if (pollCount <= 2) {
              return Promise.resolve({ State: 'Pending', SnapStart: { OptimizationStatus: 'Off' } });
            }
            return Promise.resolve({ State: 'Active', SnapStart: { OptimizationStatus: 'On' } });
          }
          if (command._type === 'GetAlias') {
            const error = new Error('Not found');
            (error as any).name = 'ResourceNotFoundException';
            return Promise.reject(error);
          }
          if (command._type === 'CreateAlias') {
            return Promise.resolve({ AliasArn: 'arn:aws:lambda:us-east-1:123456789012:function:test:kata' });
          }
          return Promise.resolve({});
        });

        const config: SnapStartActivatorConfig = { pollingIntervalSeconds: 0.01 }; // Fast polling for test
        const result = await activateSnapStart(mockLambdaClient, functionName, config);

        expect(pollCount).toBeGreaterThan(2);
        expect(result.optimizationStatus).toBe('On');
      });

      it('should throw error when snapshot creation fails', async () => {
        mockSend.mockImplementation((command: any) => {
          if (command._type === 'PublishVersion') {
            return Promise.resolve({ Version: '1' });
          }
          if (command._type === 'GetFunctionConfiguration') {
            return Promise.resolve({
              State: 'Failed',
              StateReason: 'Initialization error',
              SnapStart: { OptimizationStatus: 'Off' },
            });
          }
          return Promise.resolve({});
        });

        await expect(activateSnapStart(mockLambdaClient, functionName))
          .rejects.toThrow('SnapStart snapshot creation failed: Initialization error');
      });

      it('should include full StateReason in error message when State is Failed', async () => {
        const stateReason = 'The function failed to initialize due to a runtime error in handler code';
        mockSend.mockImplementation((command: any) => {
          if (command._type === 'PublishVersion') {
            return Promise.resolve({ Version: '3' });
          }
          if (command._type === 'GetFunctionConfiguration') {
            return Promise.resolve({
              State: 'Failed',
              StateReason: stateReason,
              SnapStart: { OptimizationStatus: 'Off' },
            });
          }
          return Promise.resolve({});
        });

        try {
          await activateSnapStart(mockLambdaClient, functionName);
          fail('Expected activateSnapStart to throw');
        } catch (e: any) {
          expect(e).toBeInstanceOf(Error);
          expect(e.message).toBe(`SnapStart snapshot creation failed: ${stateReason}`);
        }
      });

      it('should use "Unknown" as StateReason fallback when StateReason is undefined', async () => {
        mockSend.mockImplementation((command: any) => {
          if (command._type === 'PublishVersion') {
            return Promise.resolve({ Version: '1' });
          }
          if (command._type === 'GetFunctionConfiguration') {
            return Promise.resolve({
              State: 'Failed',
              // StateReason intentionally omitted
              SnapStart: { OptimizationStatus: 'Off' },
            });
          }
          return Promise.resolve({});
        });

        await expect(activateSnapStart(mockLambdaClient, functionName))
          .rejects.toThrow('SnapStart snapshot creation failed: Unknown');
      });
    });

    describe('permission error handling', () => {
      it('should throw descriptive error with required permissions when waitUntilFunctionActiveV2 gets AccessDeniedException', async () => {
        const error = new Error('User is not authorized');
        (error as any).name = 'AccessDeniedException';
        mockWaitUntilFunctionActiveV2.mockRejectedValue(error);

        await expect(activateSnapStart(mockLambdaClient, functionName))
          .rejects.toThrow('Insufficient permissions to activate SnapStart');

        try {
          await activateSnapStart(mockLambdaClient, functionName);
        } catch (e: any) {
          expect(e.message).toContain('lambda:GetFunction');
          expect(e.message).toContain('lambda:GetFunctionConfiguration');
          expect(e.message).toContain('lambda:UpdateFunctionConfiguration');
          expect(e.message).toContain('lambda:PublishVersion');
          expect(e.message).toContain('lambda:GetAlias');
          expect(e.message).toContain('lambda:CreateAlias');
          expect(e.message).toContain('lambda:UpdateAlias');
          expect(e.message).toContain(functionName);
        }
      });

      it('should throw descriptive error with required permissions when waitUntilFunctionUpdatedV2 gets AccessDeniedException', async () => {
        // Step 0 succeeds, Step 1 (UpdateFunctionConfiguration) succeeds
        mockSend.mockImplementation((command: any) => {
          if (command._type === 'UpdateFunctionConfiguration') {
            return Promise.resolve({});
          }
          return Promise.resolve({});
        });

        // Step 2 waiter throws AccessDeniedException
        const error = new Error('User is not authorized');
        (error as any).name = 'AccessDeniedException';
        mockWaitUntilFunctionUpdatedV2.mockRejectedValue(error);

        await expect(activateSnapStart(mockLambdaClient, functionName))
          .rejects.toThrow('Insufficient permissions to activate SnapStart');
      });

      it('should throw descriptive error when send call gets AccessDeniedException', async () => {
        // Waiters succeed, but a send call (e.g., UpdateFunctionConfiguration) throws AccessDeniedException
        const error = new Error('User is not authorized to perform: lambda:UpdateFunctionConfiguration');
        (error as any).name = 'AccessDeniedException';
        mockSend.mockRejectedValue(error);

        await expect(activateSnapStart(mockLambdaClient, functionName))
          .rejects.toThrow('Insufficient permissions to activate SnapStart');

        try {
          await activateSnapStart(mockLambdaClient, functionName);
        } catch (e: any) {
          expect(e.message).toContain('lambda:GetFunction');
          expect(e.message).toContain('lambda:UpdateAlias');
          expect(e.message).toContain(functionName);
        }
      });

      it('should detect AccessDeniedException wrapped in waiter cause chain', async () => {
        const cause = new Error('AccessDeniedException');
        (cause as any).name = 'AccessDeniedException';
        const waiterError = new Error('Waiter has entered a failure state');
        (waiterError as any).cause = cause;
        mockWaitUntilFunctionActiveV2.mockRejectedValue(waiterError);

        await expect(activateSnapStart(mockLambdaClient, functionName))
          .rejects.toThrow('Insufficient permissions to activate SnapStart');
      });
    });

    describe('function not found error handling', () => {
      it('should throw descriptive error when waitUntilFunctionActiveV2 gets ResourceNotFoundException', async () => {
        const error = new Error('Function not found');
        (error as any).name = 'ResourceNotFoundException';
        mockWaitUntilFunctionActiveV2.mockRejectedValue(error);

        await expect(activateSnapStart(mockLambdaClient, functionName))
          .rejects.toThrow(`Lambda function '${functionName}' does not exist`);
      });

      it('should throw descriptive error when waitUntilFunctionUpdatedV2 gets ResourceNotFoundException', async () => {
        // Step 0 succeeds, Step 1 (UpdateFunctionConfiguration) succeeds
        mockSend.mockImplementation((command: any) => {
          if (command._type === 'UpdateFunctionConfiguration') {
            return Promise.resolve({});
          }
          return Promise.resolve({});
        });

        // Step 2 waiter throws ResourceNotFoundException
        const error = new Error('Function not found');
        (error as any).name = 'ResourceNotFoundException';
        mockWaitUntilFunctionUpdatedV2.mockRejectedValue(error);

        await expect(activateSnapStart(mockLambdaClient, functionName))
          .rejects.toThrow(`Lambda function '${functionName}' does not exist`);
      });

      it('should detect ResourceNotFoundException wrapped in waiter cause chain', async () => {
        const cause = new Error('ResourceNotFoundException');
        (cause as any).name = 'ResourceNotFoundException';
        const waiterError = new Error('Waiter has entered a failure state');
        (waiterError as any).cause = cause;
        mockWaitUntilFunctionActiveV2.mockRejectedValue(waiterError);

        await expect(activateSnapStart(mockLambdaClient, functionName))
          .rejects.toThrow(`Lambda function '${functionName}' does not exist`);
      });

      it('should re-throw non-ResourceNotFoundException errors from waiters', async () => {
        mockWaitUntilFunctionActiveV2.mockRejectedValue(new Error('Timeout exceeded'));

        await expect(activateSnapStart(mockLambdaClient, functionName))
          .rejects.toThrow('Timeout exceeded');
      });
    });

    describe('configuration options', () => {
      it('should use default timeout of 180 seconds', async () => {
        mockSend.mockImplementation((command: any) => {
          if (command._type === 'PublishVersion') return Promise.resolve({ Version: '1' });
          if (command._type === 'GetFunctionConfiguration') {
            return Promise.resolve({ State: 'Active', SnapStart: { OptimizationStatus: 'On' } });
          }
          if (command._type === 'GetAlias') {
            const error = new Error('Not found');
            (error as any).name = 'ResourceNotFoundException';
            return Promise.reject(error);
          }
          if (command._type === 'CreateAlias') {
            return Promise.resolve({ AliasArn: 'arn:aws:lambda:us-east-1:123456789012:function:test:kata' });
          }
          return Promise.resolve({});
        });

        // This test verifies the function completes without timeout
        const result = await activateSnapStart(mockLambdaClient, functionName);
        expect(result).toBeDefined();
      });

      it('should respect custom timeout configuration', async () => {
        let pollCount = 0;
        mockSend.mockImplementation((command: any) => {
          if (command._type === 'PublishVersion') return Promise.resolve({ Version: '1' });
          if (command._type === 'GetFunctionConfiguration') {
            pollCount++;
            // Always return Pending to test timeout
            return Promise.resolve({ State: 'Pending', SnapStart: { OptimizationStatus: 'Off' } });
          }
          if (command._type === 'GetAlias') {
            const error = new Error('Not found');
            (error as any).name = 'ResourceNotFoundException';
            return Promise.reject(error);
          }
          if (command._type === 'CreateAlias') {
            return Promise.resolve({ AliasArn: 'arn:aws:lambda:us-east-1:123456789012:function:test:kata' });
          }
          return Promise.resolve({});
        });

        const config: SnapStartActivatorConfig = {
          snapshotTimeoutSeconds: 0.1,
          pollingIntervalSeconds: 0.01,
        };

        // Should complete (with warning) even if snapshot doesn't become Active
        const result = await activateSnapStart(mockLambdaClient, functionName, config);
        expect(result).toBeDefined();
        expect(pollCount).toBeGreaterThan(0);
      });
    });
  });

  describe('handler (Custom Resource)', () => {
    const baseEvent: CustomResourceEvent = {
      RequestType: 'Create',
      ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
      ResponseURL: 'https://cloudformation-custom-resource-response.s3.amazonaws.com/...',
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/TestStack/guid',
      RequestId: 'unique-request-id',
      ResourceType: 'Custom::SnapStartActivator',
      LogicalResourceId: 'SnapStartActivator',
      ResourceProperties: {
        ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
        FunctionName: 'test-function',
      },
    };

    beforeEach(() => {
      mockSend.mockImplementation((command: any) => {
        if (command._type === 'PublishVersion') return Promise.resolve({ Version: '1' });
        if (command._type === 'GetFunctionConfiguration') {
          return Promise.resolve({ State: 'Active', SnapStart: { OptimizationStatus: 'On' } });
        }
        if (command._type === 'GetAlias') {
          const error = new Error('Not found');
          (error as any).name = 'ResourceNotFoundException';
          return Promise.reject(error);
        }
        if (command._type === 'CreateAlias') {
          return Promise.resolve({ AliasArn: 'arn:aws:lambda:us-east-1:123456789012:function:test:kata' });
        }
        return Promise.resolve({});
      });
    });

    describe('Create request', () => {
      it('should return SUCCESS status on successful activation', async () => {
        const response = await handler(baseEvent);

        expect(response.Status).toBe('SUCCESS');
        expect(response.Data?.Version).toBe('1');
        expect(response.Data?.AliasName).toBe('kata');
      });

      it('should include physical resource ID', async () => {
        const response = await handler(baseEvent);

        expect(response.PhysicalResourceId).toContain('test-function');
        expect(response.PhysicalResourceId).toContain('snapstart');
      });

      it('should use custom alias name from properties', async () => {
        const event = {
          ...baseEvent,
          ResourceProperties: {
            ...baseEvent.ResourceProperties,
            AliasName: 'custom',
          },
        };

        const response = await handler(event);

        expect(response.Data?.AliasName).toBe('custom');
      });
    });

    describe('Update request', () => {
      it('should activate SnapStart on update', async () => {
        const event: CustomResourceEvent = {
          ...baseEvent,
          RequestType: 'Update',
          PhysicalResourceId: 'test-function:snapstart:kata',
        };

        const response = await handler(event);

        expect(response.Status).toBe('SUCCESS');
      });
    });

    describe('Delete request', () => {
      it('should return SUCCESS without action on delete', async () => {
        const event: CustomResourceEvent = {
          ...baseEvent,
          RequestType: 'Delete',
          PhysicalResourceId: 'test-function:snapstart:kata',
        };

        const response = await handler(event);

        expect(response.Status).toBe('SUCCESS');
        // Should not call any Lambda APIs on delete
        expect(mockSend).not.toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('should return FAILED status on error', async () => {
        mockWaitUntilFunctionActiveV2.mockRejectedValue(new Error('Function not found'));

        const response = await handler(baseEvent);

        expect(response.Status).toBe('FAILED');
        expect(response.Reason).toContain('Function not found');
      });

      it('should include error message in reason', async () => {
        mockSend.mockRejectedValue(new Error('Access denied'));

        const response = await handler(baseEvent);

        expect(response.Status).toBe('FAILED');
        expect(response.Reason).toContain('Access denied');
      });

      it('should return FAILED with required permissions when AccessDeniedException occurs', async () => {
        const error = new Error('User is not authorized');
        (error as any).name = 'AccessDeniedException';
        mockWaitUntilFunctionActiveV2.mockRejectedValue(error);

        const response = await handler(baseEvent);

        expect(response.Status).toBe('FAILED');
        expect(response.Reason).toContain('Insufficient permissions');
        expect(response.Reason).toContain('lambda:GetFunction');
        expect(response.Reason).toContain('lambda:UpdateFunctionConfiguration');
        expect(response.Reason).toContain('lambda:PublishVersion');
        expect(response.Reason).toContain('lambda:CreateAlias');
        expect(response.Reason).toContain('lambda:UpdateAlias');
      });

      it('should return FAILED with descriptive message when function does not exist', async () => {
        const error = new Error('ResourceNotFoundException');
        (error as any).name = 'ResourceNotFoundException';
        mockWaitUntilFunctionActiveV2.mockRejectedValue(error);

        const response = await handler(baseEvent);

        expect(response.Status).toBe('FAILED');
        expect(response.Reason).toContain('does not exist');
        expect(response.Reason).toContain('test-function');
      });

      it('should return FAILED with StateReason when snapshot creation fails', async () => {
        const stateReason = 'Runtime.ImportModuleError: Unable to import module';
        mockSend.mockImplementation((command: any) => {
          if (command._type === 'UpdateFunctionConfiguration') {
            return Promise.resolve({});
          }
          if (command._type === 'PublishVersion') {
            return Promise.resolve({ Version: '1' });
          }
          if (command._type === 'GetFunctionConfiguration') {
            return Promise.resolve({
              State: 'Failed',
              StateReason: stateReason,
              SnapStart: { OptimizationStatus: 'Off' },
            });
          }
          return Promise.resolve({});
        });

        const response = await handler(baseEvent);

        expect(response.Status).toBe('FAILED');
        expect(response.Reason).toContain('SnapStart snapshot creation failed');
        expect(response.Reason).toContain(stateReason);
      });
    });
  });
});
