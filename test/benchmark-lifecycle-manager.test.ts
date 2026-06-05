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
 * Unit tests for the run-time {@link LifecycleManager} (Layer D, task 23).
 *
 * The manager owns three concerns, each exercised here against a MOCKED cleanup
 * client (no AWS, no CDK, no network):
 *
 *  - **Ownership tagging (Req 20.1):** the produced ownership tag records the
 *    `Bench_Run_Id` under the configured tag key.
 *  - **Cost guardrail (Req 20.3, 20.5, 20.6):** a configured cost limit of zero
 *    is accepted and does NOT pre-block at construction; a resource creation
 *    whose estimated cost would push cumulative spend over the ceiling throws
 *    {@link CostLimitExceededError} at the creation point; a creation within
 *    budget succeeds and accumulates spend.
 *  - **Tag-scoped, all-or-nothing cleanup (Req 20.2, 20.7, 20.8, Property 10):**
 *    cleanup removes ONLY resources tagged for the targeted run and, when any
 *    resource cannot be removed, reports `complete: false` with each remaining
 *    resource listed.
 *
 * **Validates: Requirements 20.1, 20.2, 20.3, 20.5, 20.6, 20.7, 20.8**
 *
 * @module benchmark-lifecycle-manager.test
 */

import {
  LifecycleManager,
  CostLimitExceededError,
  LifecycleConfigurationError,
  cleanupRun,
  type BenchmarkResourceCleanupClient,
  type TaggedResource,
  type CleanupResult,
} from '../src/benchmark/runner/lifecycle-manager';

// ── Mocked cleanup client (no AWS) ───────────────────────────────────────────

/**
 * In-memory {@link BenchmarkResourceCleanupClient} modelling a tag-indexed store
 * of benchmark-owned resources. `listTaggedResources(runId)` returns ONLY the
 * resources recorded for that run; `deleteResource` removes a resource from the
 * store unless its id is configured as undeletable (modelling a resource that
 * cannot be removed, Req 20.8). Every call is recorded for assertions.
 */
class FakeCleanupClient implements BenchmarkResourceCleanupClient {
  public readonly listCalls: string[] = [];
  public readonly deleteCalls: TaggedResource[] = [];
  private readonly table: Map<string, TaggedResource[]>;
  private readonly undeletable: Set<string>;

  public constructor(
    table: Record<string, TaggedResource[]>,
    undeletable: ReadonlyArray<string> = [],
  ) {
    this.table = new Map(Object.entries(table).map(([k, v]) => [k, [...v]]));
    this.undeletable = new Set(undeletable);
  }

  public async listTaggedResources(
    benchRunId: string,
  ): Promise<ReadonlyArray<TaggedResource>> {
    this.listCalls.push(benchRunId);
    return [...(this.table.get(benchRunId) ?? [])];
  }

  public async deleteResource(resource: TaggedResource): Promise<void> {
    this.deleteCalls.push(resource);
    if (this.undeletable.has(resource.id)) {
      throw new Error(`simulated failure: cannot remove '${resource.id}'`);
    }
    const list = this.table.get(resource.benchRunId);
    if (list !== undefined) {
      this.table.set(
        resource.benchRunId,
        list.filter((r) => r.id !== resource.id),
      );
    }
  }
}

/** A tagged resource fixture for a given run. */
function resource(
  type: TaggedResource['type'],
  id: string,
  benchRunId: string,
): TaggedResource {
  return { type, id, benchRunId };
}

const TAG_KEY = 'lambda-kata:bench-run-id';

// ── Ownership tagging (Req 20.1) ─────────────────────────────────────────────

describe('LifecycleManager — ownership tagging (Req 20.1)', () => {
  it('records the Bench_Run_Id in the ownership tag under the configured key', () => {
    const manager = new LifecycleManager({
      benchRunId: 'run-42',
      cleanupClient: new FakeCleanupClient({}),
      ownershipTagKey: 'team:bench-id',
    });

    expect(manager.ownershipTag()).toEqual({ key: 'team:bench-id', value: 'run-42' });
  });

  it('defaults the ownership tag key and embeds the run id into a tag map', () => {
    const manager = new LifecycleManager({
      benchRunId: 'run-7',
      cleanupClient: new FakeCleanupClient({}),
    });

    expect(manager.ownershipTag()).toEqual({ key: TAG_KEY, value: 'run-7' });
    expect(manager.tagsFor()).toEqual({ [TAG_KEY]: 'run-7' });
    expect(manager.tagsFor({ Name: 'kata-clone' })).toEqual({
      [TAG_KEY]: 'run-7',
      Name: 'kata-clone',
    });
  });

  it('never lets caller tags override the ownership tag', () => {
    const manager = new LifecycleManager({
      benchRunId: 'run-7',
      cleanupClient: new FakeCleanupClient({}),
      ownershipTagKey: TAG_KEY,
    });

    // A caller attempting to overwrite the ownership tag must not win.
    const tags = manager.tagsFor({ [TAG_KEY]: 'spoofed' });
    expect(tags[TAG_KEY]).toBe('run-7');
  });
});

// ── Cost guardrail (Req 20.3, 20.5, 20.6) ────────────────────────────────────

describe('LifecycleManager — cost guardrail (Req 20.3, 20.5, 20.6)', () => {
  it('accepts a configured cost limit of zero and does NOT pre-block (Req 20.5)', () => {
    // Construction with maxCostUsd: 0 must not throw — no pre-flight block.
    const manager = new LifecycleManager({
      benchRunId: 'run-0',
      cleanupClient: new FakeCleanupClient({}),
      guardrails: { maxCostUsd: 0 },
    });

    expect(manager.guardrails.maxCostUsd).toBe(0);
    // A zero-cost creation is allowed even under a zero ceiling.
    expect(() => manager.authorizeResourceCreation(0)).not.toThrow();
    expect(manager.recordedCostUsd).toBe(0);
  });

  it('fails AT the creation point when a positive cost would exceed a zero ceiling (Req 20.6)', () => {
    const manager = new LifecycleManager({
      benchRunId: 'run-0',
      cleanupClient: new FakeCleanupClient({}),
      guardrails: { maxCostUsd: 0 },
    });

    expect(() => manager.authorizeResourceCreation(0.01)).toThrow(CostLimitExceededError);
    // Cumulative spend is unchanged because the creation did not proceed.
    expect(manager.recordedCostUsd).toBe(0);
  });

  it('records the cost-limit failure cause on the thrown error (Req 20.6)', () => {
    const manager = new LifecycleManager({
      benchRunId: 'run-c',
      cleanupClient: new FakeCleanupClient({}),
      guardrails: { maxCostUsd: 1 },
    });

    manager.authorizeResourceCreation(0.6);
    let captured: CostLimitExceededError | undefined;
    try {
      manager.authorizeResourceCreation(0.6);
    } catch (error) {
      captured = error as CostLimitExceededError;
    }

    expect(captured).toBeInstanceOf(CostLimitExceededError);
    expect(captured?.limitUsd).toBe(1);
    expect(captured?.priorCostUsd).toBeCloseTo(0.6);
    expect(captured?.attemptedCostUsd).toBeCloseTo(0.6);
    expect(captured?.projectedCostUsd).toBeCloseTo(1.2);
    expect(captured?.benchRunId).toBe('run-c');
    // The over-budget creation is rejected; recorded spend stays at the prior total.
    expect(manager.recordedCostUsd).toBeCloseTo(0.6);
  });

  it('allows creations within budget and accumulates spend', () => {
    const manager = new LifecycleManager({
      benchRunId: 'run-b',
      cleanupClient: new FakeCleanupClient({}),
      guardrails: { maxCostUsd: 1 },
    });

    manager.authorizeResourceCreation(0.3);
    expect(manager.recordedCostUsd).toBeCloseTo(0.3);
    manager.authorizeResourceCreation(0.4);
    expect(manager.recordedCostUsd).toBeCloseTo(0.7);
    // Exactly hitting the ceiling is allowed (boundary).
    expect(() => manager.authorizeResourceCreation(0.3)).not.toThrow();
    expect(manager.recordedCostUsd).toBeCloseTo(1.0);
  });

  it('does not constrain creations when no cost ceiling is configured', () => {
    const manager = new LifecycleManager({
      benchRunId: 'run-u',
      cleanupClient: new FakeCleanupClient({}),
    });

    expect(manager.guardrails.maxCostUsd).toBeUndefined();
    expect(() => manager.authorizeResourceCreation(1_000_000)).not.toThrow();
    expect(manager.recordedCostUsd).toBeCloseTo(1_000_000);
  });

  it('rejects an invalid (negative) cost ceiling at construction (Req 20.5)', () => {
    expect(
      () =>
        new LifecycleManager({
          benchRunId: 'run-x',
          cleanupClient: new FakeCleanupClient({}),
          guardrails: { maxCostUsd: -1 },
        }),
    ).toThrow(LifecycleConfigurationError);
  });

  it('rejects a negative estimated creation cost', () => {
    const manager = new LifecycleManager({
      benchRunId: 'run-x',
      cleanupClient: new FakeCleanupClient({}),
      guardrails: { maxCostUsd: 5 },
    });

    expect(() => manager.authorizeResourceCreation(-0.5)).toThrow(LifecycleConfigurationError);
  });
});

// ── Run-duration / concurrency guardrails (Req 20.3) ─────────────────────────

describe('LifecycleManager — duration/concurrency guardrails (Req 20.3)', () => {
  it('exposes the configured guardrails', () => {
    const manager = new LifecycleManager({
      benchRunId: 'run-g',
      cleanupClient: new FakeCleanupClient({}),
      guardrails: { maxRunDurationMs: 60_000, maxConcurrency: 5, maxCostUsd: 2 },
    });

    expect(manager.guardrails).toEqual({
      maxRunDurationMs: 60_000,
      maxConcurrency: 5,
      maxCostUsd: 2,
    });
  });

  it('reports when an elapsed run duration exceeds the ceiling', () => {
    const manager = new LifecycleManager({
      benchRunId: 'run-g',
      cleanupClient: new FakeCleanupClient({}),
      guardrails: { maxRunDurationMs: 1000 },
    });

    expect(manager.isRunDurationExceeded(999)).toBe(false);
    expect(manager.isRunDurationExceeded(1000)).toBe(false);
    expect(manager.isRunDurationExceeded(1001)).toBe(true);
  });

  it('treats an absent duration ceiling as never exceeded', () => {
    const manager = new LifecycleManager({
      benchRunId: 'run-g',
      cleanupClient: new FakeCleanupClient({}),
    });

    expect(manager.isRunDurationExceeded(Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it('reports whether a concurrency level is within the ceiling', () => {
    const manager = new LifecycleManager({
      benchRunId: 'run-g',
      cleanupClient: new FakeCleanupClient({}),
      guardrails: { maxConcurrency: 3 },
    });

    expect(manager.isConcurrencyWithinLimit(3)).toBe(true);
    expect(manager.isConcurrencyWithinLimit(4)).toBe(false);
  });

  it('rejects invalid concurrency / duration ceilings at construction', () => {
    expect(
      () =>
        new LifecycleManager({
          benchRunId: 'run-g',
          cleanupClient: new FakeCleanupClient({}),
          guardrails: { maxConcurrency: 0 },
        }),
    ).toThrow(LifecycleConfigurationError);
    expect(
      () =>
        new LifecycleManager({
          benchRunId: 'run-g',
          cleanupClient: new FakeCleanupClient({}),
          guardrails: { maxRunDurationMs: -5 },
        }),
    ).toThrow(LifecycleConfigurationError);
  });
});

// ── Tag-scoped, all-or-nothing cleanup (Req 20.2, 20.7, 20.8, Property 10) ────

describe('LifecycleManager — tag-scoped cleanup (Req 20.7, Property 10)', () => {
  it('removes ONLY resources tagged for the targeted Bench_Run_Id (Req 20.7)', async () => {
    const client = new FakeCleanupClient({
      'run-A': [
        resource('event-source-mapping', 'esm-A', 'run-A'),
        resource('function', 'fn-A', 'run-A'),
      ],
      'run-B': [resource('function', 'fn-B', 'run-B')],
    });
    const manager = new LifecycleManager({ benchRunId: 'run-A', cleanupClient: client });

    const result = await manager.cleanup();

    expect(result).toEqual({ complete: true, remaining: [] });
    // Scoped to the targeted run only.
    expect(client.listCalls).toEqual(['run-A']);
    // Deleted exactly the targeted set — never run-B's resources.
    const deletedIds = client.deleteCalls.map((r) => r.id);
    expect(deletedIds).toEqual(['esm-A', 'fn-A']);
    expect(deletedIds).not.toContain('fn-B');
  });

  it('defensively skips a resource the client mis-attributes to another run (Req 20.7)', async () => {
    // A buggy client returns a cross-run resource in the targeted run's list.
    const client = new FakeCleanupClient({
      'run-A': [
        resource('function', 'fn-A', 'run-A'),
        resource('function', 'fn-cross', 'run-OTHER'),
      ],
    });
    const manager = new LifecycleManager({ benchRunId: 'run-A', cleanupClient: client });

    const result = await manager.cleanup();

    expect(result.complete).toBe(true);
    const deletedIds = client.deleteCalls.map((r) => r.id);
    expect(deletedIds).toEqual(['fn-A']);
    expect(deletedIds).not.toContain('fn-cross');
  });

  it('reports complete with an empty remaining set when there is nothing to clean', async () => {
    const client = new FakeCleanupClient({});
    const manager = new LifecycleManager({ benchRunId: 'run-empty', cleanupClient: client });

    const result = await manager.cleanup();

    expect(result).toEqual({ complete: true, remaining: [] });
    expect(client.deleteCalls).toEqual([]);
  });
});

describe('LifecycleManager — cleanup atomicity + remaining reporting (Req 20.8, Property 10)', () => {
  it('fails the cleanup and reports each resource that could not be removed', async () => {
    const client = new FakeCleanupClient(
      {
        'run-A': [
          resource('event-source-mapping', 'esm-A', 'run-A'),
          resource('function', 'fn-A', 'run-A'),
          resource('log-group', 'lg-A', 'run-A'),
        ],
      },
      // esm-A and lg-A cannot be removed.
      ['esm-A', 'lg-A'],
    );
    const manager = new LifecycleManager({ benchRunId: 'run-A', cleanupClient: client });

    const result = await manager.cleanup();

    // Operation reported as FAILED.
    expect(result.complete).toBe(false);
    // Every unremovable resource is reported (Req 20.8) — by type:id label.
    expect(result.remaining).toEqual(
      expect.arrayContaining(['event-source-mapping:esm-A', 'log-group:lg-A']),
    );
    expect(result.remaining).toHaveLength(2);
    // The removable resource is NOT in the remaining set.
    expect(result.remaining).not.toContain('function:fn-A');
    // All resources were attempted (not stopped at the first failure).
    expect(client.deleteCalls.map((r) => r.id)).toEqual(['esm-A', 'fn-A', 'lg-A']);
  });

  it('reports complete: false with every resource when none can be removed', async () => {
    const client = new FakeCleanupClient(
      { 'run-A': [resource('function', 'fn-A', 'run-A'), resource('function', 'fn-B', 'run-A')] },
      ['fn-A', 'fn-B'],
    );
    const manager = new LifecycleManager({ benchRunId: 'run-A', cleanupClient: client });

    const result = await manager.cleanup();

    expect(result.complete).toBe(false);
    expect(result.remaining).toEqual(['function:fn-A', 'function:fn-B']);
  });
});

// ── Backward-compatible cleanupRun free function ─────────────────────────────

describe('cleanupRun free function (runner.ts compatibility)', () => {
  it('is exported as a function with the (benchRunId) => Promise<CleanupResult> contract', () => {
    expect(typeof cleanupRun).toBe('function');
    expect(cleanupRun.length).toBe(1);
  });

  it('delegates to an injected manager/client when one is provided', async () => {
    const client = new FakeCleanupClient({
      'run-Z': [resource('function', 'fn-Z', 'run-Z')],
    });

    const result: CleanupResult = await cleanupRun('run-Z', { cleanupClient: client });

    expect(result).toEqual({ complete: true, remaining: [] });
    expect(client.listCalls).toEqual(['run-Z']);
    expect(client.deleteCalls.map((r) => r.id)).toEqual(['fn-Z']);
  });
});
