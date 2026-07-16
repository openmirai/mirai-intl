#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

for (const args of [
  ["pnpm", "install", "--frozen-lockfile"],
  ["pnpm", "build"],
]) {
  const result = spawnSync("corepack", args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
