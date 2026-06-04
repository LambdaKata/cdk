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
 * Unit + property tests for the run-time trigger toggling control plane
 * ({@link TriggerToggler}, Layer D, task 20).
 *
 * The toggler flips competing event source mappings' `Enabled` state via
 * `UpdateEventSourceMapping` (never a redeploy), retries while a mapping is in a
 * transient `Updating` state before proceeding, and keeps the non-active
 * competing mapping disabled. These tests inject a MOCKED Lambda control-plane
 * port (no AWS, no CDK, no network) modelling the real mapping lifecycle —
 * `Update*` returns `Updating`, and the state only settles after a configurable
 * number of `Get*` polls — and assert:
 *
 *  - the toggle path issues `UpdateEventSourceMapping` with the manifest UUID
 *    and the requested `Enabled` value (Req 10.4);
 *  - the `Updating`-retry path polls `GetEventSourceMapping` until the mapping
 *    leaves the transient state before proceeding (Req 10.3);
 *  - activating a variant disables the non-active mapping FIRST and never leaves
 *    both competing mappings enabled at any instant (Req 10.5, Property 4 at
 *    run-time).
 *
 * **Validates: Requirements 10.3, 10.4, 10.5**
 *
 * @module benchmark-trigger-toggler.test
 */

import * as fc from 'fast-check';

import {
  TriggerToggler,
  TriggerToggleError,
  TRANSIENT_MAPPING_STATES,
  type EventSourceMappingControlClient,
  type EventSourceMappingStatus,
  type UpdateEventSourceMappingRequest,
  type CompetingMappingPair,
} from '../src/benchmark/runner/trigger-toggler';

/**
 * In-memory model of a single event source mapping that mimics the real AWS
 * lifecycle: an `UpdateEventSourceMapping` puts the mapping into the transient
 * `Updating` state, and it only reaches its terminal `Enabled`/`Disabled` state
 * after `settleAfterPolls` reads of `GetEventSourceMapping`.
 */
class FakeMapping {
  /** The currently reported state. */
  public state: string;
  /** The terminal state the mapping is transitioning toward. */
  private target: string;
  /** Remaining `Get` polls before the transient state resolves to `target`. */
  private pollsUntilSettled: number;
  /** How many polls each update takes to settle (transient window length). */
  private readonly settleAfterPolls: number;

  public constructor(initialState: string, settleAfterPolls: number) {
    this.state = initialState;
    this.target = initialState;
    this.pollsUntilSettled = 0;
    this.settleAfterPolls = settleAfterPolls;
  }

  /**
   * Seed a pre-existing in-flight transition: the mapping is already `Updating`
   * (left so by a prior operation) and settles to `target` after `polls` reads.
   */
  public seedPending(target: string, polls: number): this {
    this.state = 'Updating';
    this.target = target;
    this.pollsUntilSettled = polls;
    return this;
  }

  /** Begin a transition toward enabled/disabled via the transient `Updating`. */
  public beginUpdate(enabled: boolean): void {
    this.target = enabled ? 'Enabled' : 'Disabled';
    if (this.settleAfterPolls <= 0) {
      this.state = this.target;
      this.pollsUntilSettled = 0;
      return;
    }
    this.state = 'Updating';
    this.pollsUntilSettled = this.settleAfterPolls;
  }

  /** Read the current state, advancing the transient countdown by one poll. */
  public read(): string {
    if (this.pollsUntilSettled > 0) {
      this.pollsUntilSettled -= 1;
      if (this.pollsUntilSettled === 0) {
        this.state = this.target;
      }
    }
    return this.state;
  }
}

/**
 * A recording mock {@link EventSourceMappingControlClient} backed by
 * {@link FakeMapping}s, plus a live tally of which mappings are currently
 * `Enabled` so a test can assert the never-both-enabled invariant continuously.
 */
class FakeControlClient implements EventSourceMappingControlClient {
  public readonly updates: UpdateEventSourceMappingRequest[] = [];
  public readonly gets: string[] = [];
  /** Ordered log of every call, to assert update-vs-poll sequencing. */
  public readonly calls: Array<{ op: 'update' | 'get'; uuid: string }> = [];
  /** The maximum number of mappings simultaneously `Enabled`, ever observed. */
  public maxConcurrentEnabled = 0;

  private readonly mappings: Map<string, FakeMapping>;

  public constructor(mappings: Record<string, FakeMapping>) {
    this.mappings = new Map(Object.entries(mappings));
  }

  public async updateEventSourceMapping(
    request: UpdateEventSourceMappingRequest,
  ): Promise<EventSourceMappingStatus> {
    this.updates.push(request);
    this.calls.push({ op: 'update', uuid: request.uuid });
    const mapping = this.require(request.uuid);
    mapping.beginUpdate(request.enabled);
    this.observeConcurrency();
    return { uuid: request.uuid, state: mapping.state };
  }

  public async getEventSourceMapping(uuid: string): Promise<EventSourceMappingStatus> {
    this.gets.push(uuid);
    this.calls.push({ op: 'get', uuid });
    const mapping = this.require(uuid);
    const state = mapping.read();
    this.observeConcurrency();
    return { uuid, state };
  }

  /** Snapshot how many mappings are currently `Enabled`. */
  private observeConcurrency(): void {
    let enabled = 0;
    for (const mapping of this.mappings.values()) {
      if (mapping.state === 'Enabled') {
        enabled += 1;
      }
    }
    this.maxConcurrentEnabled = Math.max(this.maxConcurrentEnabled, enabled);
  }

  private require(uuid: string): FakeMapping {
    const mapping = this.mappings.get(uuid);
    if (mapping === undefined) {
      throw new Error(`Test setup error: no fake mapping for UUID '${uuid}'.`);
    }
    return mapping;
  }
}

/** A sleep that resolves immediately so the retry loop runs without real delay. */
const immediateSleep = (): Promise<void> => Promise.resolve();

describe('TriggerToggler.setMappingEnabled — toggle + Updating-retry (Req 10.3, 10.4)', () => {
  it('issues UpdateEventSourceMapping with the manifest UUID and Enabled value', async () => {
    const client = new FakeControlClient({
      'uuid-kata': new FakeMapping('Disabled', 0),
    });
    const toggler = new TriggerToggler(client, { sleep: immediateSleep });

    const status = await toggler.setMappingEnabled('uuid-kata', true);

    expect(client.updates).toEqual([{ uuid: 'uuid-kata', enabled: true }]);
    expect(status.state).toBe('Enabled');
  });

  it('polls GetEventSourceMapping until the mapping leaves the transient Updating state', async () => {
    // The mapping stays `Updating` for three polls before settling to `Enabled`.
    const client = new FakeControlClient({
      'uuid-kata': new FakeMapping('Disabled', 3),
    });
    const sleep = jest.fn().mockResolvedValue(undefined);
    const toggler = new TriggerToggler(client, { sleep, pollIntervalMs: 1000 });

    const status = await toggler.setMappingEnabled('uuid-kata', true);

    expect(status.state).toBe('Enabled');
    // It must have slept (retried) at least once while the mapping was Updating.
    expect(sleep).toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledWith(1000);
    // Every observed intermediate state before the final read was transient.
    expect(TRANSIENT_MAPPING_STATES.has('Updating')).toBe(true);
  });

  it('waits for a pre-existing Updating state to settle BEFORE issuing the update', async () => {
    // The mapping is already mid-update (a prior operation left it Updating) and
    // takes two polls to settle.
    const client = new FakeControlClient({
      'uuid-x': new FakeMapping('Disabled', 0).seedPending('Disabled', 2),
    });
    const toggler = new TriggerToggler(client, { sleep: immediateSleep });

    await toggler.setMappingEnabled('uuid-x', true);

    // Exactly one update was issued, and at least one Get happened before it:
    // the toggler settled the pre-existing transient state first (Req 10.3).
    expect(client.updates).toHaveLength(1);
    const firstUpdateAt = client.calls.findIndex((c) => c.op === 'update');
    expect(firstUpdateAt).toBeGreaterThan(0);
    expect(client.calls.slice(0, firstUpdateAt).every((c) => c.op === 'get')).toBe(true);
  });

  it('throws TriggerToggleError when the mapping never leaves the transient state', async () => {
    // Needs more polls to settle than the budget allows.
    const client = new FakeControlClient({
      'uuid-stuck': new FakeMapping('Disabled', 10),
    });
    const toggler = new TriggerToggler(client, {
      sleep: immediateSleep,
      maxSettlePolls: 2,
    });

    await expect(toggler.setMappingEnabled('uuid-stuck', true)).rejects.toBeInstanceOf(
      TriggerToggleError,
    );
  });
});

describe('TriggerToggler.activateVariant — single active, non-active disabled (Req 10.5, Property 4)', () => {
  const pair: CompetingMappingPair = {
    baselineMappingUuid: 'uuid-baseline',
    kataMappingUuid: 'uuid-kata',
  };

  it('disables the non-active mapping BEFORE enabling the active one', async () => {
    const client = new FakeControlClient({
      'uuid-baseline': new FakeMapping('Enabled', 1),
      'uuid-kata': new FakeMapping('Disabled', 1),
    });
    const toggler = new TriggerToggler(client, { sleep: immediateSleep });

    const result = await toggler.activateVariant(pair, 'kata');

    expect(result.active).toBe('kata');
    expect(result.activeState).toBe('Enabled');
    expect(result.inactiveState).toBe('Disabled');

    // The non-active (baseline) mapping was disabled first, then kata enabled.
    expect(client.updates).toEqual([
      { uuid: 'uuid-baseline', enabled: false },
      { uuid: 'uuid-kata', enabled: true },
    ]);
    // The invariant: the two competing mappings were never both enabled at once.
    expect(client.maxConcurrentEnabled).toBeLessThanOrEqual(1);
  });

  it('activates the baseline variant symmetrically, disabling kata first', async () => {
    const client = new FakeControlClient({
      'uuid-baseline': new FakeMapping('Disabled', 1),
      'uuid-kata': new FakeMapping('Enabled', 1),
    });
    const toggler = new TriggerToggler(client, { sleep: immediateSleep });

    const result = await toggler.activateVariant(pair, 'baseline');

    expect(result.active).toBe('baseline');
    expect(client.updates[0]).toEqual({ uuid: 'uuid-kata', enabled: false });
    expect(client.updates[1]).toEqual({ uuid: 'uuid-baseline', enabled: true });
    expect(client.maxConcurrentEnabled).toBeLessThanOrEqual(1);
  });

  it('disableBoth leaves both competing mappings disabled', async () => {
    const client = new FakeControlClient({
      'uuid-baseline': new FakeMapping('Enabled', 1),
      'uuid-kata': new FakeMapping('Disabled', 0),
    });
    const toggler = new TriggerToggler(client, { sleep: immediateSleep });

    await toggler.disableBoth(pair);

    expect(client.updates).toEqual([
      { uuid: 'uuid-baseline', enabled: false },
      { uuid: 'uuid-kata', enabled: false },
    ]);
    expect(client.maxConcurrentEnabled).toBeLessThanOrEqual(1);
  });
});

describe('Property 4 (run-time): toggling never enables both competing mappings (Req 10.5)', () => {
  it('keeps at most one competing mapping enabled across an arbitrary sequence of activations', async () => {
    await fc.assert(
      fc.asyncProperty(
        // A sequence of target variants to activate, each settling after a
        // randomized number of transient polls, starting from a random state.
        fc.array(fc.constantFrom<'baseline' | 'kata'>('baseline', 'kata'), {
          minLength: 1,
          maxLength: 12,
        }),
        fc.integer({ min: 0, max: 3 }),
        fc.boolean(),
        async (sequence, settlePolls, baselineStartsEnabled) => {
          const client = new FakeControlClient({
            'uuid-baseline': new FakeMapping(
              baselineStartsEnabled ? 'Enabled' : 'Disabled',
              settlePolls,
            ),
            // At most one starts enabled, mirroring the deploy-time invariant
            // (baseline per options, kata disabled).
            'uuid-kata': new FakeMapping('Disabled', settlePolls),
          });
          const toggler = new TriggerToggler(client, { sleep: immediateSleep });
          const pair: CompetingMappingPair = {
            baselineMappingUuid: 'uuid-baseline',
            kataMappingUuid: 'uuid-kata',
          };

          for (const variant of sequence) {
            const result = await toggler.activateVariant(pair, variant);
            // After each activation exactly the requested variant is enabled and
            // the competitor is disabled (Req 10.5).
            expect(result.activeState).toBe('Enabled');
            expect(result.inactiveState).toBe('Disabled');
          }

          // The core invariant across the WHOLE sequence: never both enabled.
          expect(client.maxConcurrentEnabled).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
