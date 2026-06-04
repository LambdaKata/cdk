/*
 * Apache-2.0
 * Copyright (C) 2025–present Raman Marozau, Target Insight Function. All rights reserved.
 * Contact: raman@worktif.com
 *
 * This file is part of the Licensed Work: lambda_kata_npm_cdk, <worktif_lambda_kata_npm_cdk>.
 * Use of this software is governed by the Apache-2.0; see the LICENSE file
 * or https://www.apache.org/licenses/LICENSE-2.0 for details.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Layer C — the default {@link TriggerAdapterRegistry} wiring (Req 9.1, 9.3).
 *
 * This is the single composition point that registers EXACTLY ONE synth-time
 * adapter per supported trigger type. It is kept separate from the pure
 * {@link module:benchmark/triggers/registry} (which has no `aws-cdk-lib`
 * dependency) because the concrete adapters DO import `aws-cdk-lib` to create
 * benchmark sources — so the registry data structure stays dependency-free
 * while the wiring that needs CDK lives here.
 *
 * @remarks
 * Validates: Requirements 9.1, 9.3
 *
 * @module benchmark/triggers/default-registry
 */

import { TriggerAdapterRegistry } from './registry';
import { InvokeTriggerAdapter } from './invoke';
import { ApiGatewayTriggerAdapter } from './apigw';
import { FunctionUrlTriggerAdapter } from './function-url';
import { SqsTriggerAdapter } from './sqs';
import { EventBridgeTriggerAdapter } from './eventbridge';
import { SnsTriggerAdapter } from './sns';
import { KinesisTriggerAdapter } from './kinesis';
import { DynamoDbStreamsTriggerAdapter } from './dynamodb-streams';
import { KafkaTriggerAdapter } from './kafka';

/**
 * Construct the default registry seeded with EXACTLY ONE adapter per supported
 * trigger type (Req 9.1, 9.3): invoke, apiGateway, functionUrl, sqs,
 * eventBridge, sns, kinesis, dynamoDbStreams, kafka.
 *
 * This is the single wiring point the orchestrator (task 14) uses to resolve a
 * trigger declaration to its adapter. It is a factory (not a shared singleton)
 * so each `kataBench` run gets an independent registry — the adapters hold no
 * per-run state, but a fresh registry keeps the API free of hidden global
 * mutability.
 *
 * @returns A {@link TriggerAdapterRegistry} containing all nine adapters.
 */
export function createDefaultTriggerAdapterRegistry(): TriggerAdapterRegistry {
  return new TriggerAdapterRegistry([
    new InvokeTriggerAdapter(),
    new ApiGatewayTriggerAdapter(),
    new FunctionUrlTriggerAdapter(),
    new SqsTriggerAdapter(),
    new EventBridgeTriggerAdapter(),
    new SnsTriggerAdapter(),
    new KinesisTriggerAdapter(),
    new DynamoDbStreamsTriggerAdapter(),
    new KafkaTriggerAdapter(),
  ]);
}
