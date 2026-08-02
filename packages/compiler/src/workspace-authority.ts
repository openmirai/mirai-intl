import type { PackageAuthoritySetV1, Sha256 } from "@openmirai/intl-abi";

import { canonicalJson, compareCanonicalStrings, sha256 } from "./canonical";

const SHA256_PATTERN = /^sha256:[\da-f]{64}$/u;

export const INTL_WORKSPACE_AUTHORITY_DIRECTORY =
  ".mirai-intl/workspace-authority" as const;
export const INTL_WORKSPACE_AUTHORITY_MANIFESTS_DIRECTORY =
  `${INTL_WORKSPACE_AUTHORITY_DIRECTORY}/manifests` as const;
export const INTL_WORKSPACE_AUTHORITY_ROOT_POINTER_PATH =
  `${INTL_WORKSPACE_AUTHORITY_DIRECTORY}/current.json` as const;

export type WorkspaceAuthorityPackageV1 = Readonly<{
  authoritySetHash: Sha256;
  catalogContentHash: Sha256;
  classifierAuthorityHash: Sha256;
  generationReceiptHash: Sha256;
  package: Readonly<{
    manifestHash: Sha256;
    name: string;
    root: string;
  }>;
  receiptHash: Sha256;
  sourceAuthorizationHash: Sha256;
}>;

export type WorkspaceAuthorityV1 = Readonly<{
  gitTreeHash: Sha256;
  packages: ReadonlyArray<WorkspaceAuthorityPackageV1>;
  schemaVersion: 1;
  snapshotHash: Sha256;
  sourceEvidenceRoot: Sha256;
  toolchainHash: Sha256;
  workspaceLock: Readonly<{ hash: Sha256; path: string }>;
}>;

export type WorkspaceAuthorityRootPointerV1 = Readonly<{
  manifestHash: Sha256;
  schemaVersion: 1;
}>;

export type WorkspaceAuthorityPackageInputV1 = Readonly<{
  authoritySet: PackageAuthoritySetV1;
  authoritySetHash: Sha256;
  catalogContentHash: Sha256;
  generationReceiptHash: Sha256;
  sourceAuthorizationHash: Sha256;
}>;

export type WorkspaceAuthorityInputV1 = Readonly<{
  gitTreeHash: Sha256;
  packages: ReadonlyArray<WorkspaceAuthorityPackageInputV1>;
  snapshotHash: Sha256;
  toolchainHash: Sha256;
  workspaceLock: Readonly<{ hash: Sha256; path: string }>;
}>;

function fail(context: string, detail: string): never {
  throw new TypeError(`${context} ${detail}`);
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return fail(context, "must be a plain object");
  }
  return value as Record<string, unknown>;
}

function exact(
  value: unknown,
  keys: ReadonlyArray<string>,
  context: string
): Record<string, unknown> {
  const object = record(value, context);
  const actual = Object.keys(object).toSorted(compareCanonicalStrings);
  const expected = [...keys].toSorted(compareCanonicalStrings);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    return fail(context, "has unexpected or missing fields");
  }
  return object;
}

function hash(value: unknown, context: string): Sha256 {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    return fail(context, "must be a canonical SHA-256 identity");
  }
  return value as Sha256;
}

function text(value: unknown, context: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.normalize("NFC") !== value
  ) {
    return fail(context, "must be a non-empty NFC string");
  }
  return value;
}

function portablePath(value: unknown, context: string): string {
  const result = text(value, context);
  if (
    result.includes("\\") ||
    result.startsWith("/") ||
    /^[A-Za-z]:/u.test(result) ||
    [...result].some((character) => character.charCodeAt(0) <= 0x1f) ||
    (result !== "." &&
      result
        .split("/")
        .some(
          (segment) => segment === "" || segment === "." || segment === ".."
        ))
  ) {
    return fail(context, "must be a confined canonical relative path");
  }
  return result;
}

function parsePackageAuthoritySet(
  value: unknown,
  context: string
): PackageAuthoritySetV1 {
  const object = exact(
    value,
    ["classifierAuthority", "package", "receipt", "schemaVersion"],
    context
  );
  if (object.schemaVersion !== 1) {
    fail(`${context}.schemaVersion`, "must equal 1");
  }
  const classifier = exact(
    object.classifierAuthority,
    ["hash", "schemaVersion"],
    `${context}.classifierAuthority`
  );
  if (classifier.schemaVersion !== 3) {
    fail(`${context}.classifierAuthority.schemaVersion`, "must equal 3");
  }
  const packageIdentity = exact(
    object.package,
    ["manifestHash", "name", "root"],
    `${context}.package`
  );
  const receipt = exact(
    object.receipt,
    ["hash", "schemaVersion"],
    `${context}.receipt`
  );
  if (receipt.schemaVersion !== 3) {
    fail(`${context}.receipt.schemaVersion`, "must equal 3; V2 is forbidden");
  }
  return {
    classifierAuthority: {
      hash: hash(classifier.hash, `${context}.classifierAuthority.hash`),
      schemaVersion: 3,
    },
    package: {
      manifestHash: hash(
        packageIdentity.manifestHash,
        `${context}.package.manifestHash`
      ),
      name: text(packageIdentity.name, `${context}.package.name`),
      root: portablePath(packageIdentity.root, `${context}.package.root`),
    },
    receipt: {
      hash: hash(receipt.hash, `${context}.receipt.hash`),
      schemaVersion: 3,
    },
    schemaVersion: 1,
  };
}

function canonicalPackageAuthoritySetBytes(
  value: PackageAuthoritySetV1
): string {
  return `${canonicalJson(parsePackageAuthoritySet(value, "Package authority set"))}\n`;
}

function parseWorkspacePackage(
  value: unknown,
  context: string
): WorkspaceAuthorityPackageV1 {
  const object = exact(
    value,
    [
      "authoritySetHash",
      "catalogContentHash",
      "classifierAuthorityHash",
      "generationReceiptHash",
      "package",
      "receiptHash",
      "sourceAuthorizationHash",
    ],
    context
  );
  const packageIdentity = exact(
    object.package,
    ["manifestHash", "name", "root"],
    `${context}.package`
  );
  return {
    authoritySetHash: hash(
      object.authoritySetHash,
      `${context}.authoritySetHash`
    ),
    catalogContentHash: hash(
      object.catalogContentHash,
      `${context}.catalogContentHash`
    ),
    classifierAuthorityHash: hash(
      object.classifierAuthorityHash,
      `${context}.classifierAuthorityHash`
    ),
    generationReceiptHash: hash(
      object.generationReceiptHash,
      `${context}.generationReceiptHash`
    ),
    package: {
      manifestHash: hash(
        packageIdentity.manifestHash,
        `${context}.package.manifestHash`
      ),
      name: text(packageIdentity.name, `${context}.package.name`),
      root: portablePath(packageIdentity.root, `${context}.package.root`),
    },
    receiptHash: hash(object.receiptHash, `${context}.receiptHash`),
    sourceAuthorizationHash: hash(
      object.sourceAuthorizationHash,
      `${context}.sourceAuthorizationHash`
    ),
  };
}

function sourceEvidenceRoot(
  packages: ReadonlyArray<WorkspaceAuthorityPackageV1>
): Sha256 {
  return sha256(
    canonicalJson(["mirai-intl", "workspace-source-evidence-root", 1, packages])
  );
}

export function validateWorkspaceAuthorityV1(
  value: unknown
): WorkspaceAuthorityV1 {
  const object = exact(
    value,
    [
      "gitTreeHash",
      "packages",
      "schemaVersion",
      "snapshotHash",
      "sourceEvidenceRoot",
      "toolchainHash",
      "workspaceLock",
    ],
    "Workspace authority V1"
  );
  if (object.schemaVersion !== 1) {
    fail("Workspace authority V1.schemaVersion", "must equal 1");
  }
  if (!Array.isArray(object.packages) || object.packages.length !== 5) {
    fail(
      "Workspace authority V1.packages",
      "must contain exactly five entries"
    );
  }
  const packages = object.packages.map((entry, index) =>
    parseWorkspacePackage(entry, `Workspace authority V1.packages[${index}]`)
  );
  const roots = packages.map((entry) => entry.package.root);
  if (
    new Set(roots).size !== roots.length ||
    roots.some(
      (root, index) =>
        index > 0 && compareCanonicalStrings(roots[index - 1] ?? "", root) >= 0
    )
  ) {
    fail(
      "Workspace authority V1.packages",
      "must have unique canonically sorted package roots"
    );
  }
  const workspaceLock = exact(
    object.workspaceLock,
    ["hash", "path"],
    "Workspace authority V1.workspaceLock"
  );
  const authority: WorkspaceAuthorityV1 = {
    gitTreeHash: hash(object.gitTreeHash, "Workspace authority V1.gitTreeHash"),
    packages,
    schemaVersion: 1,
    snapshotHash: hash(
      object.snapshotHash,
      "Workspace authority V1.snapshotHash"
    ),
    sourceEvidenceRoot: hash(
      object.sourceEvidenceRoot,
      "Workspace authority V1.sourceEvidenceRoot"
    ),
    toolchainHash: hash(
      object.toolchainHash,
      "Workspace authority V1.toolchainHash"
    ),
    workspaceLock: {
      hash: hash(
        workspaceLock.hash,
        "Workspace authority V1.workspaceLock.hash"
      ),
      path: portablePath(
        workspaceLock.path,
        "Workspace authority V1.workspaceLock.path"
      ),
    },
  };
  if (authority.sourceEvidenceRoot !== sourceEvidenceRoot(packages)) {
    fail(
      "Workspace authority V1.sourceEvidenceRoot",
      "does not bind the exact package evidence"
    );
  }
  return Object.freeze({
    ...authority,
    packages: Object.freeze(
      packages.map((entry) =>
        Object.freeze({ ...entry, package: Object.freeze(entry.package) })
      )
    ),
    workspaceLock: Object.freeze(authority.workspaceLock),
  });
}

export function buildWorkspaceAuthorityV1(
  input: WorkspaceAuthorityInputV1
): WorkspaceAuthorityV1 {
  if (input.packages.length !== 5) {
    fail(
      "Workspace authority input packages",
      "must contain exactly five entries"
    );
  }
  const packages = input.packages
    .map((entry, index): WorkspaceAuthorityPackageV1 => {
      const context = `Workspace authority input packages[${index}]`;
      const authoritySet = parsePackageAuthoritySet(
        entry.authoritySet,
        `${context}.authoritySet`
      );
      const authoritySetHash = hash(
        entry.authoritySetHash,
        `${context}.authoritySetHash`
      );
      if (
        authoritySetHash !==
        sha256(canonicalPackageAuthoritySetBytes(authoritySet))
      ) {
        fail(
          `${context}.authoritySetHash`,
          "does not bind canonical package authority-set bytes"
        );
      }
      const classifierAuthority = authoritySet.classifierAuthority;
      if (classifierAuthority === null) {
        fail(
          `${context}.authoritySet.classifierAuthority`,
          "must be present for a V3 package authority set"
        );
      }
      return {
        authoritySetHash,
        catalogContentHash: hash(
          entry.catalogContentHash,
          `${context}.catalogContentHash`
        ),
        classifierAuthorityHash: classifierAuthority.hash,
        generationReceiptHash: hash(
          entry.generationReceiptHash,
          `${context}.generationReceiptHash`
        ),
        package: authoritySet.package,
        receiptHash: authoritySet.receipt.hash,
        sourceAuthorizationHash: hash(
          entry.sourceAuthorizationHash,
          `${context}.sourceAuthorizationHash`
        ),
      };
    })
    .toSorted((left, right) =>
      compareCanonicalStrings(left.package.root, right.package.root)
    );
  return validateWorkspaceAuthorityV1({
    gitTreeHash: input.gitTreeHash,
    packages,
    schemaVersion: 1,
    snapshotHash: input.snapshotHash,
    sourceEvidenceRoot: sourceEvidenceRoot(packages),
    toolchainHash: input.toolchainHash,
    workspaceLock: input.workspaceLock,
  });
}

export function canonicalWorkspaceAuthorityV1Bytes(
  value: WorkspaceAuthorityV1
): string {
  return `${canonicalJson(validateWorkspaceAuthorityV1(value))}\n`;
}

export function parseCanonicalWorkspaceAuthorityV1(
  source: string
): WorkspaceAuthorityV1 {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    return fail("Workspace authority V1", "must contain valid JSON");
  }
  const authority = validateWorkspaceAuthorityV1(value);
  if (source !== canonicalWorkspaceAuthorityV1Bytes(authority)) {
    fail("Workspace authority V1", "must use canonical JSON bytes");
  }
  return authority;
}

export function hashWorkspaceAuthorityV1(value: WorkspaceAuthorityV1): Sha256 {
  return sha256(canonicalWorkspaceAuthorityV1Bytes(value));
}

export function workspaceAuthorityManifestPath(manifestHash: Sha256): string {
  const digest = hash(manifestHash, "Workspace authority manifest hash").slice(
    "sha256:".length
  );
  return `${INTL_WORKSPACE_AUTHORITY_MANIFESTS_DIRECTORY}/${digest}.json`;
}

export function buildWorkspaceAuthorityRootPointerV1(
  manifestHash: Sha256
): WorkspaceAuthorityRootPointerV1 {
  return Object.freeze({
    manifestHash: hash(manifestHash, "Workspace authority root manifestHash"),
    schemaVersion: 1,
  });
}

export function canonicalWorkspaceAuthorityRootPointerV1Bytes(
  value: WorkspaceAuthorityRootPointerV1
): string {
  const object = exact(
    value,
    ["manifestHash", "schemaVersion"],
    "Workspace authority root pointer V1"
  );
  if (object.schemaVersion !== 1) {
    fail("Workspace authority root pointer V1.schemaVersion", "must equal 1");
  }
  return `${canonicalJson({
    manifestHash: hash(
      object.manifestHash,
      "Workspace authority root pointer V1.manifestHash"
    ),
    schemaVersion: 1,
  })}\n`;
}

export function parseCanonicalWorkspaceAuthorityRootPointerV1(
  source: string
): WorkspaceAuthorityRootPointerV1 {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    return fail(
      "Workspace authority root pointer V1",
      "must contain valid JSON"
    );
  }
  const bytes = canonicalWorkspaceAuthorityRootPointerV1Bytes(
    value as WorkspaceAuthorityRootPointerV1
  );
  if (source !== bytes) {
    fail(
      "Workspace authority root pointer V1",
      "must use canonical JSON bytes"
    );
  }
  return buildWorkspaceAuthorityRootPointerV1(
    (value as WorkspaceAuthorityRootPointerV1).manifestHash
  );
}
