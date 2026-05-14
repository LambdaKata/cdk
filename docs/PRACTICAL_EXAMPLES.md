# Node.js Layer Management - Practical Examples

This document provides complete, runnable examples for implementing Node.js Layer Management in real projects.

## Table of Contents

1. [Complete Project Setup](#complete-project-setup)
2. [Real-World CDK Stack Example](#real-world-cdk-stack-example)
3. [Microservices Architecture Example](#microservices-architecture-example)
4. [CI/CD Pipeline Integration](#cicd-pipeline-integration)
5. [Monitoring and Observability](#monitoring-and-observability)

## Complete Project Setup

### Project Structure

```
my-nodejs-lambda-project/
├── src/
│   ├── handlers/
│   │   ├── api-handler.ts
│   │   ├── processor-handler.ts
│   │   └── scheduler-handler.ts
│   ├── lib/
│   │   ├── database.ts
│   │   ├── utils.ts
│   │   └── types.ts
│   └── stacks/
│       ├── api-stack.ts
│       ├── processing-stack.ts
│       └── main-stack.ts
├── test/
│   ├── unit/
│   └── integration/
├── cdk.json
├── package.json
├── tsconfig.json
└── README.md
```

### package.json

```json
{
  "name": "my-nodejs-lambda-project",
  "version": "1.0.0",
  "description": "Node.js Lambda project with automatic layer management",
  "scripts": {
    "build": "tsc",
    "watch": "tsc -w",
    "test": "jest",
    "cdk": "cdk",
    "deploy": "cdk deploy --all",
    "destroy": "cdk destroy --all",
    "synth": "cdk synth",
    "diff": "cdk diff"
  },
  "dependencies": {
    "@lambdakata/cdk": "^1.0.0",
    "aws-cdk-lib": "^2.100.0",
    "constructs": "^10.0.0",
    "aws-sdk": "^2.1400.0"
  },
  "devDependencies": {
    "@types/aws-lambda": "^8.10.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "aws-cdk": "^2.100.0"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "declaration": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": false,
    "inlineSourceMap": true,
    "inlineSources": true,
    "experimentalDecorators": true,
    "strictPropertyInitialization": false,
    "typeRoots": ["./node_modules/@types"],
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "exclude": ["cdk.out", "node_modules"]
}
```

### cdk.json

```json
{
  "app": "npx ts-node --prefer-ts-exts src/app.ts",
  "watch": {
    "include": ["**"],
    "exclude": [
      "README.md",
      "cdk*.json",
      "**/*.d.ts",
      "**/*.js",
      "tsconfig.json",
      "package*.json",
      "yarn.lock",
      "node_modules",
      "test"
    ]
  },
  "context": {
    "@aws-cdk/aws-lambda:recognizeLayerVersion": true,
    "@aws-cdk/core:checkSecretUsage": true,
    "@aws-cdk/core:target-partitions": ["aws", "aws-cn"],
    "@aws-cdk-containers/ecs-service-extensions:enableDefaultLogDriver": true,
    "@aws-cdk/aws-ec2:uniqueImdsv2TemplateName": true,
    "@aws-cdk/aws-ecs:arnFormatIncludesClusterName": true,
    "@aws-cdk/core:validateSnapshotRemovalPolicy": true,
    "@aws-cdk/aws-codepipeline:crossAccountKeyAliasStackSafeResourceName": true,
    "@aws-cdk/aws-s3:createDefaultLoggingPolicy": true,
    "@aws-cdk/aws-sns-subscriptions:restrictSqsDescryption": true,
    "@aws-cdk/aws-apigateway:disableCloudWatchRole": true,
    "@aws-cdk/core:enablePartitionLiterals": true,
    "@aws-cdk/aws-events:eventsTargetQueueSameAccount": true,
    "@aws-cdk/aws-iam:minimizePolicies": true,
    "@aws-cdk/core:disableStackTrace": false
  }
}
```

## Real-World CDK Stack Example

### Main Application Entry Point

```typescript
// src/app.ts
import * as cdk from 'aws-cdk-lib';
import { ApiStack } from './stacks/api-stack';
import { ProcessingStack } from './stacks/processing-stack';
import { MainStack } from './stacks/main-stack';

const app = new cdk.App();

// Environment configuration
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

// Create stacks with proper dependencies
const mainStack = new MainStack(app, 'MyApp-Main', { env });

const apiStack = new ApiStack(app, 'MyApp-API', {
  env,
  database: mainStack.database,
  vpc: mainStack.vpc,
});

const processingStack = new ProcessingStack(app, 'MyApp-Processing', {
  env,
  database: mainStack.database,
  eventBus: mainStack.eventBus,
});

// Add dependencies
apiStack.addDependency(mainStack);
processingStack.addDependency(mainStack);

app.synth();
```

### API Stack with Node.js Layer Management

```typescript
// src/stacks/api-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { kata } from '@lambdakata/cdk';

interface ApiStackProps extends cdk.StackProps {
  database: dynamodb.Table;
  vpc: ec2.Vpc;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly functions: { [key: string]: lambda.Function };

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Create API Gateway
    this.api = new apigateway.RestApi(this, 'MyApi', {
      restApiName: 'My Node.js API',
      description: 'API with automatic Node.js layer management',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Create Lambda functions with automatic Node.js layer management
    this.functions = this.createLambdaFunctions(props);

    // Set up API routes
    this.setupApiRoutes();

    // Add outputs
    this.addOutputs();
  }

  private createLambdaFunctions(props: ApiStackProps): { [key: string]: lambda.Function } {
    const commonEnvironment = {
      TABLE_NAME: props.database.tableName,
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
    };

    // User management function (Node.js 20.x, x86_64)
    const userHandler = kata(new lambda.Function(this, 'UserHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.X86_64,
      handler: 'handlers/api-handler.userHandler',
      code: lambda.Code.fromAsset('src'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        ...commonEnvironment,
        HANDLER_TYPE: 'user',
      },
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    }));

    // Product management function (Node.js 20.x, ARM64 for cost optimization)
    const productHandler = kata(new lambda.Function(this, 'ProductHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64, // Different architecture
      handler: 'handlers/api-handler.productHandler',
      code: lambda.Code.fromAsset('src'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      environment: {
        ...commonEnvironment,
        HANDLER_TYPE: 'product',
      },
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    }));

    // Order processing function (Node.js 18.x for compatibility)
    const orderHandler = kata(new lambda.Function(this, 'OrderHandler', {
      runtime: lambda.Runtime.NODEJS_18_X, // Different runtime version
      architecture: lambda.Architecture.X86_64,
      handler: 'handlers/api-handler.orderHandler',
      code: lambda.Code.fromAsset('src'),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(60),
      environment: {
        ...commonEnvironment,
        HANDLER_TYPE: 'order',
      },
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    }));

    // Grant database permissions
    [userHandler, productHandler, orderHandler].forEach(fn => {
      props.database.grantReadWriteData(fn);
    });

    return {
      userHandler,
      productHandler,
      orderHandler,
    };
  }

  private setupApiRoutes(): void {
    // Users resource
    const usersResource = this.api.root.addResource('users');
    usersResource.addMethod('GET', new apigateway.LambdaIntegration(this.functions.userHandler));
    usersResource.addMethod('POST', new apigateway.LambdaIntegration(this.functions.userHandler));
    
    const userResource = usersResource.addResource('{userId}');
    userResource.addMethod('GET', new apigateway.LambdaIntegration(this.functions.userHandler));
    userResource.addMethod('PUT', new apigateway.LambdaIntegration(this.functions.userHandler));
    userResource.addMethod('DELETE', new apigateway.LambdaIntegration(this.functions.userHandler));

    // Products resource
    const productsResource = this.api.root.addResource('products');
    productsResource.addMethod('GET', new apigateway.LambdaIntegration(this.functions.productHandler));
    productsResource.addMethod('POST', new apigateway.LambdaIntegration(this.functions.productHandler));
    
    const productResource = productsResource.addResource('{productId}');
    productResource.addMethod('GET', new apigateway.LambdaIntegration(this.functions.productHandler));
    productResource.addMethod('PUT', new apigateway.LambdaIntegration(this.functions.productHandler));

    // Orders resource
    const ordersResource = this.api.root.addResource('orders');
    ordersResource.addMethod('GET', new apigateway.LambdaIntegration(this.functions.orderHandler));
    ordersResource.addMethod('POST', new apigateway.LambdaIntegration(this.functions.orderHandler));
    
    const orderResource = ordersResource.addResource('{orderId}');
    orderResource.addMethod('GET', new apigateway.LambdaIntegration(this.functions.orderHandler));
    orderResource.addMethod('PUT', new apigateway.LambdaIntegration(this.functions.orderHandler));
  }

  private addOutputs(): void {
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'API Gateway URL',
      exportName: `${this.stackName}-ApiUrl`,
    });

    new cdk.CfnOutput(this, 'UserFunctionName', {
      value: this.functions.userHandler.functionName,
      description: 'User Handler Function Name',
    });

    new cdk.CfnOutput(this, 'ProductFunctionName', {
      value: this.functions.productHandler.functionName,
      description: 'Product Handler Function Name',
    });

    new cdk.CfnOutput(this, 'OrderFunctionName', {
      value: this.functions.orderHandler.functionName,
      description: 'Order Handler Function Name',
    });
  }
}
```

### Lambda Handler Implementation

```typescript
// src/handlers/api-handler.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

// Initialize DynamoDB client
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.TABLE_NAME!;
const HANDLER_TYPE = process.env.HANDLER_TYPE!;

// Common response helper
function createResponse(statusCode: number, body: any): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
    body: JSON.stringify(body),
  };
}

// User Handler
export async function userHandler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
  console.log('User handler invoked', { 
    httpMethod: event.httpMethod, 
    path: event.path,
    nodeVersion: process.version,
    architecture: process.arch,
  });

  try {
    const { httpMethod, pathParameters } = event;
    const userId = pathParameters?.userId;

    switch (httpMethod) {
      case 'GET':
        if (userId) {
          // Get specific user
          const result = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `USER#${userId}`, SK: `USER#${userId}` },
          }));
          
          if (!result.Item) {
            return createResponse(404, { error: 'User not found' });
          }
          
          return createResponse(200, result.Item);
        } else {
          // List all users
          const result = await docClient.send(new ScanCommand({
            TableName: TABLE_NAME,
            FilterExpression: 'begins_with(PK, :pk)',
            ExpressionAttributeValues: { ':pk': 'USER#' },
          }));
          
          return createResponse(200, { users: result.Items || [] });
        }

      case 'POST':
        // Create new user
        const userData = JSON.parse(event.body || '{}');
        const newUserId = `user-${Date.now()}`;
        
        const newUser = {
          PK: `USER#${newUserId}`,
          SK: `USER#${newUserId}`,
          id: newUserId,
          ...userData,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await docClient.send(new PutCommand({
          TableName: TABLE_NAME,
          Item: newUser,
        }));

        return createResponse(201, newUser);

      case 'PUT':
        if (!userId) {
          return createResponse(400, { error: 'User ID required' });
        }

        const updateData = JSON.parse(event.body || '{}');
        
        await docClient.send(new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: `USER#${userId}`, SK: `USER#${userId}` },
          UpdateExpression: 'SET #data = :data, updatedAt = :updatedAt',
          ExpressionAttributeNames: { '#data': 'data' },
          ExpressionAttributeValues: {
            ':data': updateData,
            ':updatedAt': new Date().toISOString(),
          },
        }));

        return createResponse(200, { message: 'User updated successfully' });

      case 'DELETE':
        if (!userId) {
          return createResponse(400, { error: 'User ID required' });
        }

        await docClient.send(new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { PK: `USER#${userId}`, SK: `USER#${userId}` },
        }));

        return createResponse(200, { message: 'User deleted successfully' });

      default:
        return createResponse(405, { error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('User handler error:', error);
    return createResponse(500, { error: 'Internal server error' });
  }
}

// Product Handler
export async function productHandler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
  console.log('Product handler invoked', { 
    httpMethod: event.httpMethod, 
    path: event.path,
    nodeVersion: process.version,
    architecture: process.arch,
  });

  try {
    const { httpMethod, pathParameters } = event;
    const productId = pathParameters?.productId;

    switch (httpMethod) {
      case 'GET':
        if (productId) {
          const result = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `PRODUCT#${productId}`, SK: `PRODUCT#${productId}` },
          }));
          
          if (!result.Item) {
            return createResponse(404, { error: 'Product not found' });
          }
          
          return createResponse(200, result.Item);
        } else {
          const result = await docClient.send(new ScanCommand({
            TableName: TABLE_NAME,
            FilterExpression: 'begins_with(PK, :pk)',
            ExpressionAttributeValues: { ':pk': 'PRODUCT#' },
          }));
          
          return createResponse(200, { products: result.Items || [] });
        }

      case 'POST':
        const productData = JSON.parse(event.body || '{}');
        const newProductId = `product-${Date.now()}`;
        
        const newProduct = {
          PK: `PRODUCT#${newProductId}`,
          SK: `PRODUCT#${newProductId}`,
          id: newProductId,
          ...productData,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await docClient.send(new PutCommand({
          TableName: TABLE_NAME,
          Item: newProduct,
        }));

        return createResponse(201, newProduct);

      case 'PUT':
        if (!productId) {
          return createResponse(400, { error: 'Product ID required' });
        }

        const updateData = JSON.parse(event.body || '{}');
        
        await docClient.send(new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: `PRODUCT#${productId}`, SK: `PRODUCT#${productId}` },
          UpdateExpression: 'SET #data = :data, updatedAt = :updatedAt',
          ExpressionAttributeNames: { '#data': 'data' },
          ExpressionAttributeValues: {
            ':data': updateData,
            ':updatedAt': new Date().toISOString(),
          },
        }));

        return createResponse(200, { message: 'Product updated successfully' });

      default:
        return createResponse(405, { error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Product handler error:', error);
    return createResponse(500, { error: 'Internal server error' });
  }
}

// Order Handler
export async function orderHandler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
  console.log('Order handler invoked', { 
    httpMethod: event.httpMethod, 
    path: event.path,
    nodeVersion: process.version,
    architecture: process.arch,
  });

  try {
    const { httpMethod, pathParameters } = event;
    const orderId = pathParameters?.orderId;

    switch (httpMethod) {
      case 'GET':
        if (orderId) {
          const result = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `ORDER#${orderId}`, SK: `ORDER#${orderId}` },
          }));
          
          if (!result.Item) {
            return createResponse(404, { error: 'Order not found' });
          }
          
          return createResponse(200, result.Item);
        } else {
          const result = await docClient.send(new ScanCommand({
            TableName: TABLE_NAME,
            FilterExpression: 'begins_with(PK, :pk)',
            ExpressionAttributeValues: { ':pk': 'ORDER#' },
          }));
          
          return createResponse(200, { orders: result.Items || [] });
        }

      case 'POST':
        const orderData = JSON.parse(event.body || '{}');
        const newOrderId = `order-${Date.now()}`;
        
        // Complex order processing logic (demonstrating Node.js 18.x compatibility)
        const processedOrder = await processComplexOrder(orderData);
        
        const newOrder = {
          PK: `ORDER#${newOrderId}`,
          SK: `ORDER#${newOrderId}`,
          id: newOrderId,
          ...processedOrder,
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await docClient.send(new PutCommand({
          TableName: TABLE_NAME,
          Item: newOrder,
        }));

        return createResponse(201, newOrder);

      case 'PUT':
        if (!orderId) {
          return createResponse(400, { error: 'Order ID required' });
        }

        const updateData = JSON.parse(event.body || '{}');
        
        await docClient.send(new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: `ORDER#${orderId}`, SK: `ORDER#${orderId}` },
          UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': updateData.status,
            ':updatedAt': new Date().toISOString(),
          },
        }));

        return createResponse(200, { message: 'Order updated successfully' });

      default:
        return createResponse(405, { error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Order handler error:', error);
    return createResponse(500, { error: 'Internal server error' });
  }
}

// Complex order processing function
async function processComplexOrder(orderData: any): Promise<any> {
  // Simulate complex business logic that benefits from Node.js 18.x features
  const items = orderData.items || [];
  
  const processedItems = await Promise.all(
    items.map(async (item: any) => {
      // Simulate async processing
      await new Promise(resolve => setTimeout(resolve, 10));
      
      return {
        ...item,
        processedAt: new Date().toISOString(),
        price: item.price * 1.1, // Add tax
      };
    })
  );

  return {
    ...orderData,
    items: processedItems,
    totalAmount: processedItems.reduce((sum, item) => sum + item.price, 0),
    processedAt: new Date().toISOString(),
  };
}
```

## Microservices Architecture Example

### Event-Driven Processing Stack

```typescript
// src/stacks/processing-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { kata } from '@lambdakata/cdk';

interface ProcessingStackProps extends cdk.StackProps {
  database: dynamodb.Table;
  eventBus: events.EventBus;
}

export class ProcessingStack extends cdk.Stack {
  public readonly processors: { [key: string]: lambda.Function };
  public readonly queues: { [key: string]: sqs.Queue };

  constructor(scope: Construct, id: string, props: ProcessingStackProps) {
    super(scope, id, props);

    // Create SQS queues for different processing types
    this.queues = this.createQueues();

    // Create processing functions with different Node.js versions
    this.processors = this.createProcessors(props);

    // Set up event routing
    this.setupEventRouting(props.eventBus);

    // Add monitoring and alarms
    this.setupMonitoring();
  }

  private createQueues(): { [key: string]: sqs.Queue } {
    const orderQueue = new sqs.Queue(this, 'OrderProcessingQueue', {
      queueName: 'order-processing',
      visibilityTimeout: cdk.Duration.minutes(5),
      deadLetterQueue: {
        queue: new sqs.Queue(this, 'OrderDLQ', {
          queueName: 'order-processing-dlq',
        }),
        maxReceiveCount: 3,
      },
    });

    const emailQueue = new sqs.Queue(this, 'EmailQueue', {
      queueName: 'email-notifications',
      visibilityTimeout: cdk.Duration.minutes(2),
      deadLetterQueue: {
        queue: new sqs.Queue(this, 'EmailDLQ', {
          queueName: 'email-notifications-dlq',
        }),
        maxReceiveCount: 5,
      },
    });

    const analyticsQueue = new sqs.Queue(this, 'AnalyticsQueue', {
      queueName: 'analytics-processing',
      visibilityTimeout: cdk.Duration.minutes(10),
      deadLetterQueue: {
        queue: new sqs.Queue(this, 'AnalyticsDLQ', {
          queueName: 'analytics-processing-dlq',
        }),
        maxReceiveCount: 2,
      },
    });

    return {
      orderQueue,
      emailQueue,
      analyticsQueue,
    };
  }

  private createProcessors(props: ProcessingStackProps): { [key: string]: lambda.Function } {
    const commonEnvironment = {
      TABLE_NAME: props.database.tableName,
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
    };

    // Order processor - Node.js 20.x for latest features
    const orderProcessor = kata(new lambda.Function(this, 'OrderProcessor', {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64, // Cost optimization
      handler: 'handlers/processor-handler.processOrder',
      code: lambda.Code.fromAsset('src'),
      memorySize: 1024,
      timeout: cdk.Duration.minutes(5),
      environment: {
        ...commonEnvironment,
        PROCESSOR_TYPE: 'order',
      },
      reservedConcurrentExecutions: 10,
    }));

    // Email processor - Node.js 18.x for stability
    const emailProcessor = kata(new lambda.Function(this, 'EmailProcessor', {
      runtime: lambda.Runtime.NODEJS_18_X,
      architecture: lambda.Architecture.X86_64,
      handler: 'handlers/processor-handler.processEmail',
      code: lambda.Code.fromAsset('src'),
      memorySize: 256,
      timeout: cdk.Duration.minutes(2),
      environment: {
        ...commonEnvironment,
        PROCESSOR_TYPE: 'email',
        EMAIL_SERVICE_URL: 'https://api.emailservice.com',
      },
      reservedConcurrentExecutions: 20,
    }));

    // Analytics processor - Node.js 22.x for cutting-edge performance
    const analyticsProcessor = kata(new lambda.Function(this, 'AnalyticsProcessor', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'handlers/processor-handler.processAnalytics',
      code: lambda.Code.fromAsset('src'),
      memorySize: 2048,
      timeout: cdk.Duration.minutes(10),
      environment: {
        ...commonEnvironment,
        PROCESSOR_TYPE: 'analytics',
        ANALYTICS_BUCKET: 'my-analytics-bucket',
      },
      reservedConcurrentExecutions: 5,
    }));

    // Grant database permissions
    [orderProcessor, emailProcessor, analyticsProcessor].forEach(fn => {
      props.database.grantReadWriteData(fn);
    });

    // Connect processors to queues
    orderProcessor.addEventSource(new sources.SqsEventSource(this.queues.orderQueue, {
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(5),
    }));

    emailProcessor.addEventSource(new sources.SqsEventSource(this.queues.emailQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(2),
    }));

    analyticsProcessor.addEventSource(new sources.SqsEventSource(this.queues.analyticsQueue, {
      batchSize: 1, // Process one at a time for heavy analytics
    }));

    return {
      orderProcessor,
      emailProcessor,
      analyticsProcessor,
    };
  }

  private setupEventRouting(eventBus: events.EventBus): void {
    // Route order events to order processing queue
    new events.Rule(this, 'OrderEventRule', {
      eventBus,
      eventPattern: {
        source: ['myapp.orders'],
        detailType: ['Order Created', 'Order Updated'],
      },
      targets: [new targets.SqsQueue(this.queues.orderQueue)],
    });

    // Route email events to email processing queue
    new events.Rule(this, 'EmailEventRule', {
      eventBus,
      eventPattern: {
        source: ['myapp.notifications'],
        detailType: ['Send Email', 'Send Welcome Email'],
      },
      targets: [new targets.SqsQueue(this.queues.emailQueue)],
    });

    // Route analytics events to analytics processing queue
    new events.Rule(this, 'AnalyticsEventRule', {
      eventBus,
      eventPattern: {
        source: ['myapp.analytics'],
        detailType: ['User Action', 'Order Completed', 'Page View'],
      },
      targets: [new targets.SqsQueue(this.queues.analyticsQueue)],
    });
  }

  private setupMonitoring(): void {
    // Add CloudWatch alarms for each processor
    Object.entries(this.processors).forEach(([name, processor]) => {
      // Error rate alarm
      new cdk.aws_cloudwatch.Alarm(this, `${name}ErrorAlarm`, {
        metric: processor.metricErrors({
          period: cdk.Duration.minutes(5),
        }),
        threshold: 5,
        evaluationPeriods: 2,
        alarmDescription: `High error rate for ${name}`,
      });

      // Duration alarm
      new cdk.aws_cloudwatch.Alarm(this, `${name}DurationAlarm`, {
        metric: processor.metricDuration({
          period: cdk.Duration.minutes(5),
        }),
        threshold: 30000, // 30 seconds
        evaluationPeriods: 3,
        alarmDescription: `High duration for ${name}`,
      });
    });

    // Queue depth alarms
    Object.entries(this.queues).forEach(([name, queue]) => {
      new cdk.aws_cloudwatch.Alarm(this, `${name}QueueDepthAlarm`, {
        metric: queue.metricApproximateNumberOfVisibleMessages({
          period: cdk.Duration.minutes(5),
        }),
        threshold: 100,
        evaluationPeriods: 2,
        alarmDescription: `High queue depth for ${name}`,
      });
    });
  }
}
```

## CI/CD Pipeline Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/deploy.yml
name: Deploy Node.js Lambda Application

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '20'
  AWS_REGION: 'us-east-1'

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      docker:
        image: docker:20.10.7-dind
        options: --privileged
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linting
        run: npm run lint

      - name: Run unit tests
        run: npm run test:unit

      - name: Run integration tests
        run: npm run test:integration
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: ${{ env.AWS_REGION }}

      - name: Build application
        run: npm run build

      - name: Test Node.js layer management
        run: |
          # Test that Node.js layer management works correctly
          npm run test:layer-management
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: ${{ env.AWS_REGION }}

  deploy-staging:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/develop'
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Deploy to staging
        run: |
          npm run build
          npx cdk deploy --all --require-approval never
        env:
          ENVIRONMENT: staging
          CDK_DEFAULT_ACCOUNT: ${{ secrets.AWS_ACCOUNT_ID }}
          CDK_DEFAULT_REGION: ${{ env.AWS_REGION }}

      - name: Run smoke tests
        run: npm run test:smoke
        env:
          API_URL: ${{ steps.deploy.outputs.api-url }}

  deploy-production:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.PROD_AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.PROD_AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Deploy to production
        run: |
          npm run build
          npx cdk deploy --all --require-approval never
        env:
          ENVIRONMENT: production
          CDK_DEFAULT_ACCOUNT: ${{ secrets.PROD_AWS_ACCOUNT_ID }}
          CDK_DEFAULT_REGION: ${{ env.AWS_REGION }}

      - name: Run production smoke tests
        run: npm run test:smoke
        env:
          API_URL: ${{ steps.deploy.outputs.api-url }}

      - name: Notify deployment success
        uses: 8398a7/action-slack@v3
        with:
          status: success
          text: 'Production deployment completed successfully!'
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

### Test Scripts for Layer Management

```typescript
// test/layer-management.test.ts
import { ensureNodeRuntimeLayer } from '@lambdakata/cdk';
import { createDefaultLogger } from '@lambdakata/cdk/logger';

describe('Node.js Layer Management Integration', () => {
  const logger = createDefaultLogger();
  
  beforeAll(() => {
    // Ensure AWS credentials are available
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error('AWS credentials required for integration tests');
    }
  });

  it('should create and reuse Node.js 20.x layer', async () => {
    const options = {
      runtimeName: 'nodejs20.x' as const,
      architecture: 'x86_64' as const,
      region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
      accountId: process.env.CDK_DEFAULT_ACCOUNT!,
      logger,
    };

    // First call should create the layer
    const firstResult = await ensureNodeRuntimeLayer(options);
    expect(firstResult.created).toBe(true);
    expect(firstResult.layerArn).toMatch(/^arn:aws:lambda:/);
    expect(firstResult.nodeVersion).toMatch(/^20\.\d+\.\d+$/);

    // Second call should reuse the layer
    const secondResult = await ensureNodeRuntimeLayer(options);
    expect(secondResult.created).toBe(false);
    expect(secondResult.layerArn).toBe(firstResult.layerArn);

    logger.info('Layer management test completed successfully', {
      layerArn: firstResult.layerArn,
      nodeVersion: firstResult.nodeVersion,
    });
  }, 300000); // 5 minute timeout for AWS operations

  it('should handle different architectures', async () => {
    const baseOptions = {
      runtimeName: 'nodejs18.x' as const,
      region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
      accountId: process.env.CDK_DEFAULT_ACCOUNT!,
      logger,
    };

    // Test x86_64 architecture
    const x86Result = await ensureNodeRuntimeLayer({
      ...baseOptions,
      architecture: 'x86_64',
    });

    // Test ARM64 architecture
    const armResult = await ensureNodeRuntimeLayer({
      ...baseOptions,
      architecture: 'arm64',
    });

    // Should create different layers for different architectures
    expect(x86Result.layerArn).not.toBe(armResult.layerArn);
    expect(x86Result.layerName).toContain('x86_64');
    expect(armResult.layerName).toContain('arm64');

    logger.info('Architecture test completed successfully', {
      x86LayerArn: x86Result.layerArn,
      armLayerArn: armResult.layerArn,
    });
  }, 300000);
});
```

## Monitoring and Observability

### CloudWatch Dashboard

```typescript
// src/monitoring/dashboard.ts
import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export class MonitoringDashboard extends Construct {
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, functions: lambda.Function[]) {
    super(scope, id);

    this.dashboard = new cloudwatch.Dashboard(this, 'NodeJsLayerDashboard', {
      dashboardName: 'nodejs-layer-management-monitoring',
    });

    this.addFunctionMetrics(functions);
    this.addLayerMetrics();
    this.addErrorMetrics(functions);
  }

  private addFunctionMetrics(functions: lambda.Function[]): void {
    const invocationWidgets = functions.map(fn => 
      new cloudwatch.GraphWidget({
        title: `${fn.functionName} - Invocations`,
        left: [fn.metricInvocations()],
        right: [fn.metricErrors()],
        width: 12,
        height: 6,
      })
    );

    const durationWidgets = functions.map(fn =>
      new cloudwatch.GraphWidget({
        title: `${fn.functionName} - Duration`,
        left: [
          fn.metricDuration({ statistic: 'Average' }),
          fn.metricDuration({ statistic: 'p99' }),
        ],
        width: 12,
        height: 6,
      })
    );

    this.dashboard.addWidgets(...invocationWidgets);
    this.dashboard.addWidgets(...durationWidgets);
  }

  private addLayerMetrics(): void {
    // Custom metrics for layer management
    const layerCreationMetric = new cloudwatch.Metric({
      namespace: 'LambdaKata/NodeJsLayers',
      metricName: 'LayersCreated',
      statistic: 'Sum',
    });

    const layerReuseMetric = new cloudwatch.Metric({
      namespace: 'LambdaKata/NodeJsLayers',
      metricName: 'LayersReused',
      statistic: 'Sum',
    });

    const layerWidget = new cloudwatch.GraphWidget({
      title: 'Node.js Layer Management',
      left: [layerCreationMetric],
      right: [layerReuseMetric],
      width: 24,
      height: 6,
    });

    this.dashboard.addWidgets(layerWidget);
  }

  private addErrorMetrics(functions: lambda.Function[]): void {
    const errorWidget = new cloudwatch.GraphWidget({
      title: 'Function Errors',
      left: functions.map(fn => fn.metricErrors()),
      width: 24,
      height: 6,
    });

    this.dashboard.addWidgets(errorWidget);
  }
}
```

### Custom Metrics in Lambda Functions

```typescript
// src/lib/metrics.ts
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const cloudWatch = new CloudWatchClient({});

export class MetricsCollector {
  private namespace: string;

  constructor(namespace: string = 'LambdaKata/NodeJsLayers') {
    this.namespace = namespace;
  }

  async recordLayerCreation(runtime: string, architecture: string): Promise<void> {
    await this.putMetric('LayersCreated', 1, [
      { Name: 'Runtime', Value: runtime },
      { Name: 'Architecture', Value: architecture },
    ]);
  }

  async recordLayerReuse(runtime: string, architecture: string): Promise<void> {
    await this.putMetric('LayersReused', 1, [
      { Name: 'Runtime', Value: runtime },
      { Name: 'Architecture', Value: architecture },
    ]);
  }

  async recordProcessingTime(operation: string, duration: number): Promise<void> {
    await this.putMetric('ProcessingTime', duration, [
      { Name: 'Operation', Value: operation },
    ]);
  }

  private async putMetric(
    metricName: string, 
    value: number, 
    dimensions: Array<{ Name: string; Value: string }> = []
  ): Promise<void> {
    try {
      await cloudWatch.send(new PutMetricDataCommand({
        Namespace: this.namespace,
        MetricData: [{
          MetricName: metricName,
          Value: value,
          Unit: 'Count',
          Dimensions: dimensions,
          Timestamp: new Date(),
        }],
      }));
    } catch (error) {
      console.error('Failed to put metric:', error);
      // Don't throw - metrics shouldn't break the main flow
    }
  }
}

// Usage in Lambda handlers
export const metrics = new MetricsCollector();
```

This comprehensive guide provides real-world, production-ready examples of implementing Node.js Layer Management with Lambda Kata. The examples demonstrate proper error handling, monitoring, CI/CD integration, and architectural patterns for scalable serverless applications.
