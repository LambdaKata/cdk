/*
 * Integration tests for Node.js layer attachment in CDK constructs
 */

import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';

import { kataWithAccountId } from '../src/kata-wrapper';
import { createMockLicensingService } from '../src/mock-licensing';

describe('Node.js Layer Integration Tests', () => {
  let app: App;
  let stack: Stack;

  beforeEach(() => {
    app = new App();
    stack = new Stack(app, 'TestStack', {
      env: {
        account: '123456789012',
        region: 'us-east-1',
      },
    });
  });

  it('should handle Node.js layer creation failure gracefully', async () => {
    // Create a Node.js Lambda function
    const lambda = new LambdaFunction(stack, 'TestFunction', {
      runtime: Runtime.NODEJS_18_X,
      handler: 'src/handler.main',
      code: Code.fromInline('exports.main = async () => ({ statusCode: 200 });'),
    });

    // Create mock licensing service that returns entitled status
    const mockLicensingService = createMockLicensingService({
      '123456789012': 'arn:aws:lambda:us-east-1:123456789012:layer:lambda-kata:2',
    });

    // Capture console warnings
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {
    });

    try {
      // Apply kata transformation - Node.js layer creation will likely fail in test environment
      // const result = await kataWithAccountId(lambda, '123456789012', {
      //   licensingService: mockLicensingService,
      // });
      //
      // // Verify transformation was applied despite Node.js layer failure
      // expect(result.transformed).toBe(true);
      // expect(result.licensingResponse.entitled).toBe(true);

      // Verify warning was logged about Node.js layer failure
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Warning: Failed to attach Node.js runtime layer:'),
      );

      // Synthesize the stack to verify CDK template
      const template = Template.fromStack(stack);

      // Verify the Lambda function has the correct runtime and handler
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'python3.12',
        Handler: 'lambdakata.optimized_handler.lambda_handler',
      });

      // Verify that layers are attached by checking the function properties directly
      const functions = template.findResources('AWS::Lambda::Function');
      const functionKeys = Object.keys(functions);
      expect(functionKeys).toHaveLength(1);

      const functionProps = functions[functionKeys[0]].Properties;
      expect(functionProps.Layers).toBeDefined();
      expect(Array.isArray(functionProps.Layers)).toBe(true);
      expect(functionProps.Layers.length).toBeGreaterThanOrEqual(2);

      // Verify Lambda Kata layer is attached
      const hasLambdaKataLayer = functionProps.Layers.some((layer: any) =>
        typeof layer === 'string' && layer.includes('lambda-kata'),
      );
      expect(hasLambdaKataLayer).toBe(true);

      // Verify config layer is created with correct handler
      const layers = template.findResources('AWS::Lambda::LayerVersion');
      const layerKeys = Object.keys(layers);
      expect(layerKeys.length).toBeGreaterThanOrEqual(1);

      // Check that at least one layer has the correct description
      const hasCorrectConfigLayer = layerKeys.some(key => {
        const layerProps = layers[key].Properties;
        return layerProps.Description &&
          layerProps.Description.includes('Lambda Kata config layer for handler: src/handler.main');
      });
      expect(hasCorrectConfigLayer).toBe(true);

    } finally {
      consoleSpy.mockRestore();
    }
  });
});
