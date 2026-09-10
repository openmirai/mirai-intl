import { appendFile, writeFile } from "node:fs/promises";
import { targets } from "./release.mjs";

export function selectArtifacts(
  artifacts,
  { revision, attempt, runId, repositoryId }
) {
  const names = targets.map(
    (target) => `native-${revision}-${attempt}-${target}`
  );
  const selected = names.map((name) => {
    const matches = artifacts.filter((item) => item.name === name);
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one immutable native artifact: ${name}`
      );
    }
    const item = matches[0];
    if (
      item.expired !== false ||
      !Number.isSafeInteger(item.id) ||
      item.id < 1 ||
      !Number.isSafeInteger(item.size_in_bytes) ||
      item.size_in_bytes < 1 ||
      item.size_in_bytes > 70 * 1024 * 1024 ||
      !/^sha256:[a-f0-9]{64}$/u.test(item.digest ?? "") ||
      String(item.workflow_run?.id) !== String(runId) ||
      String(item.workflow_run?.repository_id) !== String(repositoryId)
    ) {
      throw new Error(`Untrusted or expired native artifact: ${name}`);
    }
    return {
      id: item.id,
      name,
      digest: item.digest,
      bytes: item.size_in_bytes,
    };
  });
  if (new Set(selected.map((item) => item.id)).size !== targets.length) {
    throw new Error("Duplicate native artifact IDs");
  }
  return selected;
}
if (process.argv[1]?.endsWith("/artifact-pins.mjs")) {
  const revision = process.argv[2];
  if (!/^[a-f0-9]{40}$/u.test(revision ?? "")) {
    throw new Error("Expected immutable revision");
  }
  const artifacts = [];
  for (let page = 1; page <= 10; page++) {
    const response = await fetch(
      `${process.env.GITHUB_API_URL}/repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/artifacts?per_page=100&page=${page}`,
      {
        headers: {
          authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (!response.ok) {
      throw new Error(`Artifact listing failed: HTTP ${response.status}`);
    }
    const result = await response.json();
    artifacts.push(...result.artifacts);
    if (result.artifacts.length < 100) {
      break;
    }
    if (page === 10) {
      throw new Error("Artifact inventory exceeded bounded listing");
    }
  }
  const pins = selectArtifacts(artifacts, {
    revision,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    runId: process.env.GITHUB_RUN_ID,
    repositoryId: process.env.GITHUB_REPOSITORY_ID,
  });
  await writeFile(
    "native-artifact-pins.json",
    `${JSON.stringify({ revision, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, artifacts: pins })}\n`
  );
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `ids=${pins.map((pin) => pin.id).join(",")}\n`
  );
}
