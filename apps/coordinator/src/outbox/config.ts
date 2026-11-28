// Delivery timing and limits for the run outbox (rules H05, H10; stress H05).
//
// Every number here is provisional until the soak tests in #69 set real ones.

export interface OutboxConfig {
  /**
   * How long a sent item waits for its run's cursor acknowledgement before it is sent again.
   * Later attempts wait longer: the delay doubles per attempt up to `maxDelayMs`.
   */
  readonly ackTimeoutMs: number;
  readonly maxDelayMs: number;
  /** Sends per item before it becomes `stalled`. A stalled item is never deleted. */
  readonly maxAttempts: number;
  /** Items claimed for one run in one delivery pass. The rest wait for the next alarm. */
  readonly batchSize: number;
  /** Unsettled items one run may hold. Beyond it the causing command is refused. */
  readonly maxOpenPerRun: number;
  /** The soonest an alarm is set from now, so no condition can make it fire in a tight loop. */
  readonly minAlarmDelayMs: number;
}

export const DEFAULT_OUTBOX_CONFIG: OutboxConfig = {
  ackTimeoutMs: 10_000,
  maxDelayMs: 5 * 60_000,
  maxAttempts: 8,
  batchSize: 100,
  maxOpenPerRun: 1_000,
  minAlarmDelayMs: 1_000,
};

/**
 * The wait after the `attempt`-th send (1-based): exponential, capped, with jitter that keeps it
 * between half and all of the full delay, so runs that reconnect together do not retry together.
 * `random` returns a number in [0, 1).
 */
export function retryDelay(config: OutboxConfig, attempt: number, random: () => number): number {
  const full = Math.min(config.maxDelayMs, config.ackTimeoutMs * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.min(Math.max(random(), 0), 1);
  return Math.round(full * (0.5 + 0.5 * jitter));
}
