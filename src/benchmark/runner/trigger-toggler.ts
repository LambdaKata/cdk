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
 * Layer D — {@link TriggerToggler}: the run-time event-source-mapping toggling
 * control plane (run-time, CDK-free) (Req 10.3, 10.4, 10.5).
 *
 * ## Responsibility
 *
 * For a Competing_Source both the baseline and kata event source mappings are
 * provisioned ONCE at deploy time (baseline per routing options, kata disabled —
 * Req 10.1, 10.2). To switch which variant receives traffic for a benchmark
 * window the runner does NOT redeploy the stack; it flips the mappings' `Enabled`
 * state at run time through the Lambda **`UpdateEventSourceMapping`** operation,
 * addressing each mapping by the UUID resolved into the Benchmark Manifest
 * (`ManifestTrigger.baselineMappingUuid` / `kataMappingUuid`) (Req 10.3, 10.4).
 *
 * The toggler owns three concerns:
 *
 * 1. **Single-mapping enable/disable with `Updating` retry**
 *    ({@link TriggerToggler.setMappingEnabled}). `UpdateEventSourceMapping`
 *    returns immediately with the mapping in a transient `Updating` state; a
 *    mapping that is already `Updating` rejects a concurrent update. The toggler
 *    therefore waits until the mapping has SETTLED out of its transient state
 *    both before issuing the update (so the call is accepted) and after (so the
 *    new `Enabled` state has taken effect) before proceeding (Req 10.3).
 * 2. **Competing-pair activation** ({@link TriggerToggler.activateVariant}). To
 *    target one variant for a window the toggler **disables the non-active
 *    mapping first and waits for it to settle, THEN enables the active one** —
 *    the ordering that guarantees the two competing mappings are never both
 *    enabled at the same instant (Req 10.5, Property 4 at run-time).
 * 3. **Conservative all-off** ({@link TriggerToggler.disableBoth}) for setting
 *    the safe initial state and for the max-duration guardrail's "disable
 *    benchmark-owned mappings" stop (Req 10.5).
 *
 * ## Dependency inversion (testability)
 *
 * The Lambda control-plane capability is expressed as the minimal injected
 * {@link EventSourceMappingControlClient} port (mirroring the injected clients of
 * `./manifest-loader` and the client ports of `./load`), so unit tests pass a
 * mock and never touch AWS. {@link TriggerToggler.withDefaultClient} constructs a
 * real {@link LambdaClient}-backed implementation for production callers.
 *
 * ## CDK-free constraint
 *
 * This module imports ONLY `@aws-sdk/client-lambda` (a runtime dependency of the
 * package) and no `aws-cdk-lib` / `constructs`. That keeps the runner package
 * shippable without CDK and is enforced by `test/benchmark-runner-cdk-free.test.ts`.
 *
 * @remarks
 * Validates: Requirements 10.3, 10.4, 10.5
 *
 * @module benchmark/runner/trigger-toggler
 */

import {
  LambdaClient,
  UpdateEventSourceMappingCommand,
  GetEventSourceMappingCommand,
} from '@aws-sdk/client-lambda';

/**
 * The lifecycle states an AWS Lambda event source mapping reports through its
 * `State` field.
 *
 * The terminal states the toggler drives toward are `Enabled` and `Disabled`;
 * the remaining states are transient and the toggler waits them out (see
 * {@link TRANSIENT_MAPPING_STATES}). `state` on {@link EventSourceMappingStatus}
 * is kept a plain `string` (not this union) so an unrecognized future state from
 * the service is tolerated rather than mis-typed.
 */
export type EventSourceMappingState =
  | 'Creating'
  | 'Enabling'
  | 'Enabled'
  | 'Disabling'
  | 'Disabled'
  | 'Updating'
  | 'Deleting';

/**
 * The transient (in-progress) mapping states the toggler must wait OUT before it
 * can consider an update accepted/applied (Req 10.3).
 *
 * `Updating` is the headline state called out by the design ("retry while a
 * mapping is in `Updating` state before starting the window"); `Creating`,
 * `Enabling`, and `Disabling` are the sibling in-progress states that equally
 * mean "not yet settled", so they are treated identically. A mapping is SETTLED
 * when its state is none of these (i.e. `Enabled`, `Disabled`, or a terminal
 * state the toggler does not drive).
 */
export const TRANSIENT_MAPPING_STATES: ReadonlySet<string> = new Set<string>([
  'Creating',
  'Enabling',
  'Disabling',
  'Updating',
]);

/** The variant a competing event source mapping belongs to. */
export type ToggleVariant = 'baseline' | 'kata';

/** A request to set the `Enabled` state of a single event source mapping. */
export interface UpdateEventSourceMappingRequest {
  /** The event source mapping UUID (from the manifest). */
  readonly uuid: string;
  /** The desired `Enabled` state. */
  readonly enabled: boolean;
}

/**
 * The observed status of a single event source mapping — the minimal projection
 * the toggler needs from `UpdateEventSourceMapping` / `GetEventSourceMapping`.
 */
export interface EventSourceMappingStatus {
  /** The event source mapping UUID. */
  readonly uuid: string;
  /** The raw `State` reported by Lambda (e.g. `Enabled`, `Updating`). */
  readonly state: string;
}

/**
 * The minimal Lambda control-plane capability the {@link TriggerToggler} depends
 * on, injected for testability (dependency inversion).
 *
 * Implementations wrap the two Lambda operations the toggler uses:
 * `UpdateEventSourceMapping` (flip `Enabled`) and `GetEventSourceMapping` (poll
 * `State` while transient). Unit tests provide an in-memory mock; production uses
 * the {@link LambdaClient}-backed adapter built by
 * {@link TriggerToggler.withDefaultClient}. The toggler never constructs SDK
 * command objects itself, so the core toggling logic is independent of the SDK
 * command shapes.
 */
export interface EventSourceMappingControlClient {
  /**
   * Flip a mapping's `Enabled` state via `UpdateEventSourceMapping` (Req 10.4).
   *
   * @param request - The mapping UUID and the desired `Enabled` state.
   * @returns The mapping status immediately after the call (typically
   *   `Updating`).
   */
  updateEventSourceMapping(
    request: UpdateEventSourceMappingRequest,
  ): Promise<EventSourceMappingStatus>;

  /**
   * Read a mapping's current status via `GetEventSourceMapping`.
   *
   * @param uuid - The mapping UUID to read.
   * @returns The current mapping status.
   */
  getEventSourceMapping(uuid: string): Promise<EventSourceMappingStatus>;
}

/** A pair of competing event source mappings for one variant pair (Req 10.1). */
export interface CompetingMappingPair {
  /** The baseline variant's event source mapping UUID. */
  readonly baselineMappingUuid: string;
  /** The kata variant's event source mapping UUID. */
  readonly kataMappingUuid: string;
}

/** The outcome of activating one variant of a {@link CompetingMappingPair}. */
export interface ActivateVariantResult {
  /** The variant that is now active (enabled). */
  readonly active: ToggleVariant;
  /** UUID of the now-active (enabled) mapping. */
  readonly activeUuid: string;
  /** UUID of the now-inactive (disabled) mapping. */
  readonly inactiveUuid: string;
  /** Settled state of the active mapping (expected `Enabled`). */
  readonly activeState: string;
  /** Settled state of the inactive mapping (expected `Disabled`). */
  readonly inactiveState: string;
}

/**
 * Tuning + injected-timing options for a {@link TriggerToggler}.
 *
 * Defaults are conservative for a real Lambda control plane (mappings can take
 * several seconds to settle); tests inject a no-op {@link sleep} so the
 * `Updating`-retry path runs instantly and deterministically.
 */
export interface TriggerTogglerOptions {
  /**
   * Maximum number of `GetEventSourceMapping` polls to wait for a mapping to
   * leave a transient state before failing. Default {@link DEFAULT_MAX_SETTLE_POLLS}.
   */
  readonly maxSettlePolls?: number;
  /**
   * Delay between settle polls, in milliseconds. Default
   * {@link DEFAULT_POLL_INTERVAL_MS}.
   */
  readonly pollIntervalMs?: number;
  /**
   * Injected sleep used between polls; defaults to a real `setTimeout`-based
   * delay. Tests pass a resolved-immediately function to avoid wall-clock waits.
   */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Default maximum number of settle polls before {@link TriggerToggler} fails. */
export const DEFAULT_MAX_SETTLE_POLLS = 60;

/** Default delay (ms) between settle polls. */
export const DEFAULT_POLL_INTERVAL_MS = 2000;

/**
 * Error raised when the toggler cannot bring a mapping to a settled, expected
 * state — a mapping that never leaves its transient state within
 * {@link TriggerTogglerOptions.maxSettlePolls}, or a competing-pair activation
 * whose post-conditions (active enabled, inactive disabled) were not met.
 *
 * Distinct, named, and carrying the offending UUID so the runner can surface a
 * precise diagnosis rather than a generic SDK error.
 */
export class TriggerToggleError extends Error {
  /** The event source mapping UUID the failure concerns. */
  public readonly uuid: string;

  public constructor(message: string, uuid: string) {
    super(message);
    this.name = 'TriggerToggleError';
    this.uuid = uuid;
  }
}

/** Real `setTimeout`-based delay used when no {@link sleep} is injected. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Adapter implementing {@link EventSourceMappingControlClient} over a concrete
 * AWS SDK v3 {@link LambdaClient} (Req 10.4).
 *
 * It is the only place that constructs `UpdateEventSourceMapping` /
 * `GetEventSourceMapping` command objects, keeping the SDK surface isolated from
 * the toggler's control logic. Production callers obtain it via
 * {@link TriggerToggler.withDefaultClient}; tests bypass it entirely with a mock
 * port.
 */
export class LambdaEventSourceMappingControl
  implements EventSourceMappingControlClient {
  private readonly client: LambdaClient;

  /**
   * @param client - The AWS SDK Lambda client used to issue the two operations.
   */
  public constructor(client: LambdaClient) {
    this.client = client;
  }

  /** @inheritDoc */
  public async updateEventSourceMapping(
    request: UpdateEventSourceMappingRequest,
  ): Promise<EventSourceMappingStatus> {
    const response = await this.client.send(
      new UpdateEventSourceMappingCommand({
        UUID: request.uuid,
        Enabled: request.enabled,
      }),
    );
    return { uuid: request.uuid, state: response.State ?? 'Unknown' };
  }

  /** @inheritDoc */
  public async getEventSourceMapping(
    uuid: string,
  ): Promise<EventSourceMappingStatus> {
    const response = await this.client.send(
      new GetEventSourceMappingCommand({ UUID: uuid }),
    );
    return { uuid, state: response.State ?? 'Unknown' };
  }
}

/**
 * Run-time control plane that toggles competing event source mappings' `Enabled`
 * state via `UpdateEventSourceMapping`, never by redeploying (Req 10.3, 10.4,
 * 10.5).
 *
 * The toggler is stateless across calls beyond its injected client and timing
 * options, so a single instance can drive every variant pair for a run.
 *
 * @remarks
 * Validates: Requirements 10.3, 10.4, 10.5
 */
export class TriggerToggler {
  private readonly client: EventSourceMappingControlClient;
  private readonly maxSettlePolls: number;
  private readonly pollIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  /**
   * @param client - The injected Lambda control-plane port. Required, so the
   *   toggler is always constructed with an explicit dependency; use
   *   {@link TriggerToggler.withDefaultClient} to build a real one.
   * @param options - Optional settle-poll tuning and an injected sleep.
   */
  public constructor(
    client: EventSourceMappingControlClient,
    options: TriggerTogglerOptions = {},
  ) {
    this.client = client;
    this.maxSettlePolls = options.maxSettlePolls ?? DEFAULT_MAX_SETTLE_POLLS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /**
   * Construct a toggler backed by a real region-resolved {@link LambdaClient}
   * (production default). Tests should use the constructor with a mock port.
   *
   * @param region - Optional explicit region; when omitted the SDK resolves it
   *   from the standard provider chain (env/config).
   * @param options - Optional settle-poll tuning.
   * @returns A toggler backed by {@link LambdaEventSourceMappingControl}.
   */
  public static withDefaultClient(
    region?: string,
    options: TriggerTogglerOptions = {},
  ): TriggerToggler {
    const config = region !== undefined ? { region } : {};
    return new TriggerToggler(
      new LambdaEventSourceMappingControl(new LambdaClient(config)),
      options,
    );
  }

  /**
   * Read a mapping's current `State` (Req 10.3).
   *
   * @param uuid - The mapping UUID to read.
   * @returns The raw `State` string reported by Lambda.
   */
  public async getMappingState(uuid: string): Promise<string> {
    const status = await this.client.getEventSourceMapping(uuid);
    return status.state;
  }

  /**
   * Poll `GetEventSourceMapping` until the mapping leaves every transient state
   * ({@link TRANSIENT_MAPPING_STATES}), then return its settled status (Req 10.3).
   *
   * Each poll that observes a transient state sleeps for
   * {@link TriggerTogglerOptions.pollIntervalMs} (injected in tests) before
   * re-reading. If the mapping is still transient after
   * {@link TriggerTogglerOptions.maxSettlePolls} polls, a {@link TriggerToggleError}
   * is thrown rather than waiting forever.
   *
   * @param uuid - The mapping UUID to wait on.
   * @returns The settled mapping status.
   *
   * @throws {TriggerToggleError} If the mapping does not settle within the poll
   *   budget.
   */
  public async waitUntilSettled(uuid: string): Promise<EventSourceMappingStatus> {
    // One initial read plus up to maxSettlePolls re-reads after a sleep.
    let status = await this.client.getEventSourceMapping(uuid);
    let polls = 0;
    while (TRANSIENT_MAPPING_STATES.has(status.state)) {
      if (polls >= this.maxSettlePolls) {
        throw new TriggerToggleError(
          `Event source mapping '${uuid}' did not leave transient state ` +
          `'${status.state}' after ${this.maxSettlePolls} polls.`,
          uuid,
        );
      }
      polls += 1;
      await this.sleep(this.pollIntervalMs);
      status = await this.client.getEventSourceMapping(uuid);
    }
    return status;
  }

  /**
   * Set a single mapping's `Enabled` state, retrying around the transient
   * `Updating` window (Req 10.3, 10.4).
   *
   * The sequence is deliberately settle → update → settle:
   *
   * 1. wait until the mapping is settled, so a concurrent `Updating` from a prior
   *    operation does not cause `UpdateEventSourceMapping` to be rejected;
   * 2. issue `UpdateEventSourceMapping({ UUID, Enabled })`;
   * 3. wait until the mapping settles again, so the new `Enabled` state has
   *    actually taken effect before the caller proceeds.
   *
   * This is idempotent in effect: requesting the state a mapping already holds
   * still returns its settled status.
   *
   * @param uuid - The mapping UUID to update.
   * @param enabled - The desired `Enabled` state.
   * @returns The settled mapping status after the update has applied.
   *
   * @throws {TriggerToggleError} If the mapping does not settle within the poll
   *   budget at either wait point.
   */
  public async setMappingEnabled(
    uuid: string,
    enabled: boolean,
  ): Promise<EventSourceMappingStatus> {
    await this.waitUntilSettled(uuid);
    await this.client.updateEventSourceMapping({ uuid, enabled });
    return this.waitUntilSettled(uuid);
  }

  /**
   * Activate exactly one variant of a competing mapping pair for a benchmark
   * window, keeping the other variant's mapping disabled (Req 10.5, Property 4).
   *
   * The non-active mapping is disabled FIRST and fully settled before the active
   * mapping is enabled. This ordering is the invariant's guarantee: there is no
   * instant at which both competing mappings are enabled. After both updates the
   * settled states are verified — active `Enabled`, inactive `Disabled` — and a
   * {@link TriggerToggleError} is thrown if either post-condition is not met.
   *
   * @param pair - The baseline/kata competing mapping UUIDs.
   * @param variant - The variant to make active for the window.
   * @returns The activation result with both settled states.
   *
   * @throws {TriggerToggleError} If a mapping does not settle, or the resulting
   *   states violate the single-active invariant.
   */
  public async activateVariant(
    pair: CompetingMappingPair,
    variant: ToggleVariant,
  ): Promise<ActivateVariantResult> {
    const activeUuid = variant === 'baseline'
      ? pair.baselineMappingUuid
      : pair.kataMappingUuid;
    const inactiveUuid = variant === 'baseline'
      ? pair.kataMappingUuid
      : pair.baselineMappingUuid;

    // Disable the non-active mapping FIRST and wait for it to settle, so the two
    // competing mappings are never both enabled at once (Req 10.5, Property 4).
    const inactiveStatus = await this.setMappingEnabled(inactiveUuid, false);
    if (!isDisabled(inactiveStatus.state)) {
      throw new TriggerToggleError(
        `Non-active mapping '${inactiveUuid}' settled in state ` +
        `'${inactiveStatus.state}' instead of 'Disabled'; refusing to enable ` +
        `the active mapping while a competing mapping may still be enabled.`,
        inactiveUuid,
      );
    }

    // Only now enable the active mapping for this window.
    const activeStatus = await this.setMappingEnabled(activeUuid, true);
    if (!isEnabled(activeStatus.state)) {
      throw new TriggerToggleError(
        `Active mapping '${activeUuid}' settled in state '${activeStatus.state}' ` +
        `instead of 'Enabled'.`,
        activeUuid,
      );
    }

    return {
      active: variant,
      activeUuid,
      inactiveUuid,
      activeState: activeStatus.state,
      inactiveState: inactiveStatus.state,
    };
  }

  /**
   * Disable BOTH competing mappings, leaving the pair fully inert (Req 10.5).
   *
   * Used to establish the safe initial state and as the max-duration guardrail's
   * "disable benchmark-owned mappings" stop. Each mapping is settled in turn.
   *
   * @param pair - The baseline/kata competing mapping UUIDs.
   *
   * @throws {TriggerToggleError} If either mapping does not settle as disabled.
   */
  public async disableBoth(pair: CompetingMappingPair): Promise<void> {
    for (const uuid of [pair.baselineMappingUuid, pair.kataMappingUuid]) {
      const status = await this.setMappingEnabled(uuid, false);
      if (!isDisabled(status.state)) {
        throw new TriggerToggleError(
          `Mapping '${uuid}' settled in state '${status.state}' instead of ` +
          `'Disabled'.`,
          uuid,
        );
      }
    }
  }
}

/** Whether a settled `State` represents an enabled mapping. */
function isEnabled(state: string): boolean {
  return state === 'Enabled';
}

/** Whether a settled `State` represents a disabled mapping. */
function isDisabled(state: string): boolean {
  return state === 'Disabled';
}
