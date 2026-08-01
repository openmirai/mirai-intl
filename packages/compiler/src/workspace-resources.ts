export type WorkspaceCatalogResourceInput = Readonly<{
  index: number;
  packagePriority: boolean;
  sourceWeight: number;
}>;

export type WorkspaceCatalogResourcePlan = Readonly<{
  index: number;
  lanes: number;
}>;

const BYTES_PER_SEMANTIC_LANE = 2 * 1024 * 1024 * 1024;
const HEAVY_CATALOG_SOURCE_THRESHOLD = 500;
const MAX_CATALOG_LANES = 4;

function catalogLaneLimit(entry: WorkspaceCatalogResourceInput): number {
  if (entry.packagePriority) {
    return Math.min(
      MAX_CATALOG_LANES,
      1 + Math.ceil(entry.sourceWeight / HEAVY_CATALOG_SOURCE_THRESHOLD)
    );
  }
  if (entry.sourceWeight < HEAVY_CATALOG_SOURCE_THRESHOLD) {
    return 1;
  }
  return Math.min(
    MAX_CATALOG_LANES,
    1 + Math.floor(entry.sourceWeight / HEAVY_CATALOG_SOURCE_THRESHOLD)
  );
}

export function defaultWorkspaceAuthorizationWorkers(
  catalogCount: number,
  availableCpu: number,
  totalMemoryBytes: number
): number {
  const cpuCapacity = Math.max(1, Math.floor(availableCpu));
  const memoryCapacity = Math.max(
    1,
    Math.floor(totalMemoryBytes / BYTES_PER_SEMANTIC_LANE)
  );
  return Math.max(1, Math.min(catalogCount, 5, cpuCapacity, memoryCapacity));
}

/**
 * Filesystem hashing and mutation barriers are I/O-bound even while semantic
 * analysis consumes the catalog process's JavaScript thread. Give each active
 * catalog at most two libuv workers, but only when the machine has more CPUs
 * than catalog processes. This avoids the former fixed single-threaded I/O
 * tail without allowing large hosts to multiply unbounded thread pools.
 */
export function defaultWorkspaceCatalogIoThreads(
  workerCount: number,
  availableCpu: number
): number {
  const workers = Math.max(1, Math.floor(workerCount));
  const cpuCapacity = Math.max(1, Math.floor(availableCpu));
  return Math.max(1, Math.min(2, Math.ceil(cpuCapacity / workers)));
}

export function workspaceCatalogWeightsRequired(
  catalogCount: number,
  workerCount: number,
  availableCpu: number,
  totalMemoryBytes: number
): boolean {
  if (workerCount < catalogCount) {
    return true;
  }
  const cpuCapacity = Math.max(1, Math.floor(availableCpu));
  const memoryCapacity = Math.max(
    1,
    Math.floor(totalMemoryBytes / BYTES_PER_SEMANTIC_LANE)
  );
  return Math.min(cpuCapacity, memoryCapacity) >= workerCount * 2;
}

/**
 * Assigns spare machine capacity to the long-running catalog tails without
 * oversubscribing either CPUs or the measured semantic-worker memory budget.
 * Every concurrently active catalog keeps one process lane. Extra lanes are
 * deterministic and bounded: the largest catalogs may use up to four lanes,
 * while smaller catalogs remain single-lane.
 */
export function allocateWorkspaceCatalogResources(
  ordered: ReadonlyArray<WorkspaceCatalogResourceInput>,
  workerCount: number,
  availableCpu: number,
  totalMemoryBytes: number
): ReadonlyArray<WorkspaceCatalogResourcePlan> {
  const active = ordered.slice(0, Math.max(0, workerCount));
  if (active.length === 0) {
    return [];
  }
  const cpuCapacity = Math.max(1, Math.floor(availableCpu));
  const memoryCapacity = Math.max(
    1,
    Math.floor(totalMemoryBytes / BYTES_PER_SEMANTIC_LANE)
  );
  const laneCapacity = Math.max(
    active.length,
    Math.min(cpuCapacity, memoryCapacity)
  );
  const lanes = new Map(active.map(({ index }) => [index, 1]));
  // Splitting one catalog duplicates its TypeScript closure preparation.
  // Only consider inner workers when the device has at least one genuinely
  // spare CPU and memory lane per active catalog. On the 8-vCPU/16-GiB CI
  // runner all five catalogs therefore remain single-lane; the outer pool is
  // the faster level of parallelism.
  let remaining =
    laneCapacity >= active.length * 2 ? laneCapacity - active.length : 0;
  const limits = new Map(
    active.map((entry) => [entry.index, catalogLaneLimit(entry)])
  );
  while (remaining > 0) {
    let assigned = false;
    for (const entry of active) {
      const current = lanes.get(entry.index) ?? 1;
      const limit = limits.get(entry.index) ?? 1;
      if (current >= limit) {
        continue;
      }
      lanes.set(entry.index, current + 1);
      remaining -= 1;
      assigned = true;
      if (remaining === 0) {
        break;
      }
    }
    if (!assigned) {
      break;
    }
  }
  return ordered.map(({ index }) => ({
    index,
    lanes: lanes.get(index) ?? 1,
  }));
}
