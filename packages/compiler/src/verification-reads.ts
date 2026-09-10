/** Drain every observation before returning control to publication or rollback. */
export function settleVerificationChecks<
  T extends ReadonlyArray<Promise<unknown>> | [],
>(checks: T): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }>;
export async function settleVerificationChecks(
  checks: ReadonlyArray<Promise<unknown>>
): Promise<Array<unknown>> {
  const results = await Promise.allSettled(checks);
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    const messages = [
      ...new Set(
        failures.map((failure) =>
          failure instanceof Error
            ? failure.message
            : "Unknown observation failure"
        )
      ),
    ]
      .slice(0, 8)
      .join("; ")
      .slice(0, 8192);
    throw new AggregateError(
      failures,
      `Mirai Intl file observations failed: ${messages}`
    );
  }
  return results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  );
}

/** One observation phase. Never carry this scope across a mutation barrier. */
export class VerificationReadScope {
  private readonly hashes = new Map<string, Promise<`sha256:${string}`>>();
  private readonly waiting: Array<() => void> = [];
  private active = 0;

  constructor(
    private readonly readHash: (path: string) => Promise<`sha256:${string}`>,
    private readonly limit = 16
  ) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 64) {
      throw new Error(
        "Verification read limit must be an integer from 1 to 64"
      );
    }
  }

  hash(path: string): Promise<`sha256:${string}`> {
    const existing = this.hashes.get(path);
    if (existing) {
      return existing;
    }
    const observation = this.observe(path);
    this.hashes.set(path, observation);
    return observation;
  }

  private async observe(path: string): Promise<`sha256:${string}`> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await this.readHash(path);
    } finally {
      const next = this.waiting.shift();
      if (next) {
        next();
      } else {
        this.active--;
      }
    }
  }
}
