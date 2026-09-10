import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { once } from "node:events";

const maxFrameBytes = 64 * 1024 * 1024;

export function addonTransport(path, workers = 2) {
  const { NativeEngine } = createRequire(import.meta.url)(path);
  const engine = new NativeEngine(workers);
  return {
    async request(value) {
      return JSON.parse(await engine.execute(JSON.stringify(value)));
    },
    async close() {
      engine.close();
    },
  };
}

export function workerTransport(path, workers = 2) {
  const child = spawn(path, ["--workers", String(workers)], {
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });
  let pending;
  let buffered = "";
  let stderr = "";
  let terminal;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const fail = (error) => {
    terminal = error;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      pending = undefined;
    }
  };
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-8192);
  });
  child.on("exit", (code, signal) => {
    fail(new Error(`Native worker exited (${code}, ${signal}): ${stderr}`));
  });
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    if (Buffer.byteLength(buffered) > maxFrameBytes) {
      fail(new Error("Native response exceeds frame bound"));
      child.kill();
      return;
    }
    const end = buffered.indexOf("\n");
    if (end === -1) {
      return;
    }
    if (!pending || end !== buffered.length - 1) {
      fail(new Error("Unsolicited or duplicate native response"));
      child.kill();
      return;
    }
    const waiter = pending;
    pending = undefined;
    clearTimeout(waiter.timer);
    try {
      waiter.resolve(JSON.parse(buffered.slice(0, end)));
    } catch (error) {
      waiter.reject(error);
    }
    buffered = "";
  });
  return {
    pid: child.pid,
    request(value) {
      if (terminal) {
        return Promise.reject(terminal);
      }
      if (pending) {
        return Promise.reject(new Error("Native request already in flight"));
      }
      const source = JSON.stringify(value);
      if (Buffer.byteLength(source) > maxFrameBytes) {
        return Promise.reject(new Error("Native request exceeds frame bound"));
      }
      return new Promise((resolve, reject) => {
        pending = {
          resolve,
          reject,
          timer: setTimeout(() => {
            fail(new Error("Native operation timed out"));
            child.kill();
          }, 30_000),
        };
        child.stdin.write(`${source}\n`);
      });
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      const exited = once(child, "exit");
      child.stdin.end();
      const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
