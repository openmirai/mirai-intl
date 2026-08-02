import { fork } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

export type EnsureWorkerResult = Readonly<{
  afterHash: string;
  beforeHash: string;
  changed: boolean;
  contextId: string;
  id: number;
  kind: "bootstrap" | "measure" | "warmup";
  milliseconds: number;
  peakRssBytes: number;
  pid: number;
  type: "result";
}>;

type Ready = Readonly<{
  contextId: string;
  implementationHash: string;
  lifecycle: string;
  pid: number;
  type: "ready";
}>;

type Fatal = Readonly<{ message: string; type: "fatal" }>;

export class EnsureWorker {
  readonly #child: ChildProcess;
  readonly #pending = new Map<
    number,
    Readonly<{
      reject: (error: Error) => void;
      resolve: (value: EnsureWorkerResult) => void;
    }>
  >();
  #ready: Promise<Ready>;
  #sequence = 0;

  constructor(cli: string, contextId: string) {
    this.#child = fork(
      fileURLToPath(
        new URL("./authorization-ensure-worker.ts", import.meta.url)
      ),
      [],
      {
        env: {
          ...process.env,
          MIRAI_INTL_BENCHMARK_CLI: cli,
          MIRAI_INTL_BENCHMARK_CONTEXT: contextId,
        },
        execArgv: ["--import", "tsx"],
        silent: true,
      }
    );
    this.#ready = new Promise((resolve, reject) => {
      const onMessage = (message: Ready | Fatal | EnsureWorkerResult) => {
        if (message.type === "ready") {
          resolve(message);
        } else if (message.type === "fatal") {
          reject(new Error(message.message));
        }
      };
      this.#child.on("message", onMessage);
      this.#child.once("exit", (code, signal) => {
        const error = new Error(
          `Ensure worker exited without replacement: code=${String(code)} signal=${String(signal)}`
        );
        reject(error);
        for (const pending of this.#pending.values()) {
          pending.reject(error);
        }
        this.#pending.clear();
      });
      this.#child.on(
        "message",
        (message: Ready | Fatal | EnsureWorkerResult) => {
          if (message.type === "fatal") {
            const error = new Error(message.message);
            for (const pending of this.#pending.values()) {
              pending.reject(error);
            }
            this.#pending.clear();
            return;
          }
          if (message.type === "result") {
            const pending = this.#pending.get(message.id);
            if (pending) {
              this.#pending.delete(message.id);
              pending.resolve(message);
            }
          }
        }
      );
    });
  }

  ready(): Promise<Ready> {
    return this.#ready;
  }

  async request(
    kind: EnsureWorkerResult["kind"],
    root: string,
    expectedFixtureHash: string
  ): Promise<EnsureWorkerResult> {
    const ready = await this.#ready;
    const id = this.#sequence++;
    const result = await new Promise<EnsureWorkerResult>((resolve, reject) => {
      this.#pending.set(id, { reject, resolve });
      this.#child.send({
        contextId: ready.contextId,
        expectedFixtureHash,
        id,
        kind,
        root,
      });
    });
    if (
      result.contextId !== ready.contextId ||
      result.pid !== ready.pid ||
      result.beforeHash !== expectedFixtureHash ||
      result.afterHash !== expectedFixtureHash
    ) {
      throw new Error("Ensure worker identity or fixture hash changed");
    }
    return result;
  }

  async close(): Promise<void> {
    if (this.#child.exitCode !== null) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.#child.once("exit", () => resolve());
      this.#child.disconnect();
    });
  }

  crashForTest(): void {
    this.#child.kill("SIGKILL");
  }
}
