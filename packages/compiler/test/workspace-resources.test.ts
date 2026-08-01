import { describe, expect, it } from "vitest";

import {
  allocateWorkspaceCatalogResources,
  defaultWorkspaceCatalogIoThreads,
  defaultWorkspaceAuthorizationWorkers,
  workspaceCatalogWeightsRequired,
} from "../src/workspace-resources";

const GIB = 1024 * 1024 * 1024;

describe("workspace catalog resource allocation", () => {
  const catalogs = [
    { index: 4, packagePriority: true, sourceWeight: 2402 },
    { index: 0, packagePriority: false, sourceWeight: 614 },
    { index: 3, packagePriority: false, sourceWeight: 366 },
    { index: 2, packagePriority: false, sourceWeight: 315 },
    { index: 1, packagePriority: false, sourceWeight: 112 },
  ] as const;

  it("keeps the faster outer-only schedule on an 8-vCPU 16-GiB runner", () => {
    expect(allocateWorkspaceCatalogResources(catalogs, 5, 8, 16 * GIB)).toEqual(
      catalogs.map(({ index }) => ({ index, lanes: 1 }))
    );
  });

  it("does not oversubscribe a machine without spare capacity", () => {
    expect(allocateWorkspaceCatalogResources(catalogs, 5, 4, 8 * GIB)).toEqual(
      catalogs.map(({ index }) => ({ index, lanes: 1 }))
    );
  });

  it("scales the outer process pool down on smaller devices", () => {
    expect(defaultWorkspaceAuthorizationWorkers(5, 8, 16 * GIB)).toBe(5);
    expect(defaultWorkspaceAuthorizationWorkers(5, 2, 4 * GIB)).toBe(2);
    expect(defaultWorkspaceAuthorizationWorkers(1, 8, 16 * GIB)).toBe(1);
  });

  it("bounds filesystem concurrency by the active catalog pool", () => {
    expect(defaultWorkspaceCatalogIoThreads(5, 8)).toBe(2);
    expect(defaultWorkspaceCatalogIoThreads(5, 5)).toBe(1);
    expect(defaultWorkspaceCatalogIoThreads(2, 2)).toBe(1);
    expect(defaultWorkspaceCatalogIoThreads(2, 8)).toBe(2);
  });

  it("does not reserve extra lanes for queued catalogs", () => {
    expect(allocateWorkspaceCatalogResources(catalogs, 2, 8, 16 * GIB)).toEqual(
      [
        { index: 4, lanes: 4 },
        { index: 0, lanes: 2 },
        { index: 3, lanes: 1 },
        { index: 2, lanes: 1 },
        { index: 1, lanes: 1 },
      ]
    );
  });

  it("scales further only when both CPU and memory are available", () => {
    expect(
      allocateWorkspaceCatalogResources(catalogs, 5, 16, 32 * GIB)
    ).toEqual([
      { index: 4, lanes: 4 },
      { index: 0, lanes: 2 },
      { index: 3, lanes: 1 },
      { index: 2, lanes: 1 },
      { index: 1, lanes: 1 },
    ]);
  });

  it("skips source-weight scans when every catalog runs and no inner pool fits", () => {
    expect(workspaceCatalogWeightsRequired(5, 5, 8, 16 * GIB)).toBe(false);
    expect(workspaceCatalogWeightsRequired(5, 5, 16, 32 * GIB)).toBe(true);
    expect(workspaceCatalogWeightsRequired(5, 2, 8, 16 * GIB)).toBe(true);
  });
});
