import { canonicalJson, compareCanonicalStrings, sha256 } from "./canonical";
import { INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME } from "@openmirai/intl-abi";

type Sha256 = `sha256:${string}`;
const SHA256_PATTERN = /^sha256:[\da-f]{64}$/u;

export const MIRAI_INTL_CLASSIFIER_AUTHORITY_V3_FILE =
  INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME;

export type MiraiIntlClassifierAuthoritySourceV3 = Readonly<{
  boundaryHash: Sha256;
  decision: "facade-absent" | "facade-present" | "facade-unknown-active";
  requiresProgram: boolean;
  source: string;
  sourceHash: Sha256;
}>;

export type MiraiIntlClassifierAuthorityV3 = Readonly<{
  artifactBinding: unknown;
  artifactHash: Sha256;
  checkpointAHash: Sha256;
  checkpointAInput: ReadonlyArray<
    readonly [
      source: string,
      boundaryHash: Sha256,
      decision: MiraiIntlClassifierAuthoritySourceV3["decision"],
      sourceHash: Sha256,
    ]
  >;
  indexBinding: unknown;
  indexHash: Sha256;
  inputHash: Sha256;
  optimizedRequiresProgramVector: ReadonlyArray<readonly [string, boolean]>;
  optimizedRequiresProgramVectorHash: Sha256;
  referenceRequiresProgramVector: ReadonlyArray<readonly [string, boolean]>;
  referenceRequiresProgramVectorHash: Sha256;
  receiptProjectionHash: Sha256;
  resultHash: Sha256;
  sources: ReadonlyArray<MiraiIntlClassifierAuthoritySourceV3>;
  workspaceRoot: string;
}>;

export type MiraiIntlPersistedClassifierAuthoritySourceV3 = readonly [
  source: string,
  sourceHash: Sha256,
  boundaryHash: Sha256,
  decision: MiraiIntlClassifierAuthoritySourceV3["decision"],
  requiresProgram: boolean,
];

export type MiraiIntlPersistedClassifierAuthorityV3 = Readonly<{
  artifactHash: Sha256;
  checkpointAHash: Sha256;
  indexHash: Sha256;
  inputHash: Sha256;
  optimizedRequiresProgramVectorHash: Sha256;
  owner: string;
  receiptProjectionHash: Sha256;
  referenceRequiresProgramVectorHash: Sha256;
  resultHash: Sha256;
  sources: ReadonlyArray<MiraiIntlPersistedClassifierAuthoritySourceV3>;
}>;

export type MiraiIntlClassifierAuthorityEnvelopeV3 = Readonly<{
  authorities: ReadonlyArray<MiraiIntlPersistedClassifierAuthorityV3>;
  receiptHash: Sha256;
  schemaVersion: 3;
  sourceAuthorizationHash: Sha256;
}>;

export type MiraiIntlPersistedClassifierAuthorityBindingV3 = Omit<
  MiraiIntlPersistedClassifierAuthorityV3,
  "resultHash"
>;

type AuthorityBinding = Omit<MiraiIntlClassifierAuthorityV3, "resultHash">;

function deepFreezeValue<T>(value: T, seen: WeakSet<object>): T {
  if (
    value &&
    typeof value === "object" &&
    !Object.isFrozen(value) &&
    !seen.has(value)
  ) {
    seen.add(value);
    for (const entry of Object.values(value)) {
      deepFreezeValue(entry, seen);
    }
    Object.freeze(value);
  }
  return value;
}

export function deepFreezeMiraiIntlClassifierValue<T>(value: T): T {
  return deepFreezeValue(value, new WeakSet());
}

function vectorHash(
  vector: MiraiIntlClassifierAuthorityV3["optimizedRequiresProgramVector"]
): Sha256 {
  return sha256(
    canonicalJson(["mirai-intl", "requires-program-vector", 3, vector])
  );
}

function resultHash(authority: AuthorityBinding): Sha256 {
  const {
    artifactBinding: _artifactBinding,
    checkpointAInput: _checkpointAInput,
    indexBinding: _indexBinding,
    ...identity
  } = authority;
  return sha256(
    canonicalJson([
      "mirai-intl",
      "classifier-production-authority",
      3,
      identity,
    ])
  );
}

export function buildMiraiIntlClassifierAuthorityV3(
  binding: AuthorityBinding
): MiraiIntlClassifierAuthorityV3 {
  return deepFreezeMiraiIntlClassifierValue(
    validateMiraiIntlClassifierAuthorityV3({
      ...binding,
      resultHash: resultHash(binding),
    })
  );
}

function assertUniqueSortedSources(
  values: ReadonlyArray<string>,
  label: string
): void {
  if (
    new Set(values).size !== values.length ||
    values.some(
      (value, index) =>
        index > 0 &&
        compareCanonicalStrings(values[index - 1] ?? "", value) >= 0
    )
  ) {
    throw new Error(`Invalid Mirai Intl classifier ${label}`);
  }
}

export function validateMiraiIntlClassifierAuthorityV3(
  authority: MiraiIntlClassifierAuthorityV3,
  expectedInputHash?: Sha256
): MiraiIntlClassifierAuthorityV3 {
  const indexMode = (authority.indexBinding as Readonly<{ mode?: unknown }>)
    .mode;
  const checkpointAInput = authority.checkpointAInput.toSorted(
    ([leftSource], [rightSource]) =>
      compareCanonicalStrings(leftSource, rightSource)
  );
  const optimizedVector = authority.optimizedRequiresProgramVector.toSorted(
    ([leftSource], [rightSource]) =>
      compareCanonicalStrings(leftSource, rightSource)
  );
  const referenceVector = authority.referenceRequiresProgramVector.toSorted(
    ([leftSource], [rightSource]) =>
      compareCanonicalStrings(leftSource, rightSource)
  );
  assertUniqueSortedSources(
    checkpointAInput.map(([source]) => source),
    "checkpoint source coverage"
  );
  assertUniqueSortedSources(
    optimizedVector.map(([source]) => source),
    "optimized vector coverage"
  );
  assertUniqueSortedSources(
    referenceVector.map(([source]) => source),
    "reference vector coverage"
  );
  assertUniqueSortedSources(
    authority.sources.map(({ source }) => source),
    "authority source coverage"
  );
  if (
    checkpointAInput.length !== optimizedVector.length ||
    checkpointAInput.length !== referenceVector.length ||
    checkpointAInput.length !== authority.sources.length
  ) {
    throw new Error("Invalid Mirai Intl classifier exact source coverage");
  }
  const programBySource = new Map(optimizedVector);
  const expectedSources = checkpointAInput.map(
    ([source, boundaryHash, decision, sourceHash]) => {
      const requiresProgram = programBySource.get(source);
      if (requiresProgram === undefined) {
        throw new Error(
          "Invalid Mirai Intl classifier optimized vector coverage"
        );
      }
      return {
        boundaryHash,
        decision,
        requiresProgram,
        source,
        sourceHash,
      };
    }
  );
  const { resultHash: authorityResultHash, ...authorityBinding } = authority;
  if (
    (expectedInputHash !== undefined &&
      authority.inputHash !== expectedInputHash) ||
    authority.indexHash !==
      sha256(
        canonicalJson([
          "mirai-intl",
          "generated-facade-candidate-index",
          3,
          authority.indexBinding,
        ])
      ) ||
    authority.checkpointAHash !==
      sha256(
        canonicalJson([
          "mirai-intl",
          "classifier-checkpoint-a",
          3,
          checkpointAInput,
        ])
      ) ||
    authority.artifactHash !==
      sha256(
        canonicalJson([
          "mirai-intl",
          "classifier-checkpoint-b",
          3,
          authority.artifactBinding,
        ])
      ) ||
    authority.optimizedRequiresProgramVectorHash !==
      vectorHash(optimizedVector) ||
    authority.referenceRequiresProgramVectorHash !==
      vectorHash(referenceVector) ||
    !SHA256_PATTERN.test(authority.receiptProjectionHash) ||
    canonicalJson(optimizedVector) !== canonicalJson(referenceVector) ||
    canonicalJson(authority.checkpointAInput) !==
      canonicalJson(checkpointAInput) ||
    canonicalJson(authority.optimizedRequiresProgramVector) !==
      canonicalJson(optimizedVector) ||
    canonicalJson(authority.referenceRequiresProgramVector) !==
      canonicalJson(referenceVector) ||
    canonicalJson(authority.sources) !== canonicalJson(expectedSources) ||
    (indexMode !== "filtered" && indexMode !== "owner-fallback") ||
    authority.sources.some(
      ({ decision, requiresProgram }) =>
        requiresProgram !==
        (indexMode === "owner-fallback" || decision !== "facade-absent")
    ) ||
    authorityResultHash !== resultHash(authorityBinding)
  ) {
    throw new Error("Invalid Mirai Intl classifier production authority");
  }
  return deepFreezeMiraiIntlClassifierValue(authority);
}

function portablePath(value: string, label: string): string {
  if (
    value.length === 0 ||
    value.normalize("NFC") !== value ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[a-z]:/iu.test(value)
  ) {
    throw new Error(`${label} must be a portable workspace-relative path`);
  }
  if (value === ".") {
    return value;
  }
  const segments = value.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    throw new Error(`${label} must be a portable workspace-relative path`);
  }
  return value;
}

function persistedAuthorityResultHash(
  binding: MiraiIntlPersistedClassifierAuthorityBindingV3
): Sha256 {
  return sha256(
    canonicalJson(["mirai-intl", "classifier-persisted-authority", 3, binding])
  );
}

export function validateMiraiIntlPersistedClassifierAuthorityV3(
  authority: MiraiIntlPersistedClassifierAuthorityV3
): MiraiIntlPersistedClassifierAuthorityV3 {
  portablePath(authority.owner, "classifier authority owner");
  const sources = authority.sources.toSorted(([left], [right]) =>
    compareCanonicalStrings(left, right)
  );
  assertUniqueSortedSources(
    sources.map(([source]) => source),
    "persisted source coverage"
  );
  for (const [
    source,
    sourceHash,
    boundaryHash,
    decision,
    requiresProgram,
  ] of sources) {
    portablePath(source, "classifier authority source");
    if (
      !SHA256_PATTERN.test(sourceHash) ||
      !SHA256_PATTERN.test(boundaryHash) ||
      !["facade-absent", "facade-present", "facade-unknown-active"].includes(
        decision
      ) ||
      (decision !== "facade-absent" && !requiresProgram)
    ) {
      throw new Error("Invalid Mirai Intl persisted classifier source");
    }
  }
  const { resultHash: actualResultHash, ...binding } = authority;
  if (
    canonicalJson(authority.sources) !== canonicalJson(sources) ||
    ![
      authority.artifactHash,
      authority.checkpointAHash,
      authority.indexHash,
      authority.inputHash,
      authority.optimizedRequiresProgramVectorHash,
      authority.receiptProjectionHash,
      authority.referenceRequiresProgramVectorHash,
    ].every((value) => SHA256_PATTERN.test(value)) ||
    authority.optimizedRequiresProgramVectorHash !==
      authority.referenceRequiresProgramVectorHash ||
    actualResultHash !== persistedAuthorityResultHash(binding)
  ) {
    throw new Error("Invalid Mirai Intl persisted classifier authority");
  }
  return deepFreezeMiraiIntlClassifierValue(authority);
}

export function buildMiraiIntlPersistedClassifierAuthorityV3(
  binding: MiraiIntlPersistedClassifierAuthorityBindingV3
): MiraiIntlPersistedClassifierAuthorityV3 {
  return validateMiraiIntlPersistedClassifierAuthorityV3({
    ...binding,
    resultHash: persistedAuthorityResultHash(binding),
  });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: ReadonlyArray<string>,
  label: string
): void {
  if (
    canonicalJson(Object.keys(value).toSorted(compareCanonicalStrings)) !==
    canonicalJson([...expected].toSorted(compareCanonicalStrings))
  ) {
    throw new Error(`${label} must contain only its canonical fields`);
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function hash(value: unknown, label: string): Sha256 {
  const result = string(value, label);
  if (!SHA256_PATTERN.test(result)) {
    throw new Error(`${label} must be a SHA-256 identity`);
  }
  return result as Sha256;
}

function array(value: unknown, label: string): ReadonlyArray<unknown> {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function classifierDecision(
  value: unknown,
  label: string
): MiraiIntlClassifierAuthoritySourceV3["decision"] {
  const decision = string(value, label);
  if (
    decision !== "facade-absent" &&
    decision !== "facade-present" &&
    decision !== "facade-unknown-active"
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return decision;
}

export function parseMiraiIntlPersistedClassifierAuthorityV3(
  value: unknown
): MiraiIntlPersistedClassifierAuthorityV3 {
  const input = record(value, "Mirai Intl persisted classifier authority V3");
  exactKeys(
    input,
    [
      "artifactHash",
      "checkpointAHash",
      "indexHash",
      "inputHash",
      "optimizedRequiresProgramVectorHash",
      "owner",
      "receiptProjectionHash",
      "referenceRequiresProgramVectorHash",
      "resultHash",
      "sources",
    ],
    "Mirai Intl persisted classifier authority V3"
  );
  const sources = array(
    input["sources"],
    "persisted classifier authority sources"
  ).map((entry, index): MiraiIntlPersistedClassifierAuthoritySourceV3 => {
    const tuple = array(
      entry,
      `persisted classifier authority sources[${index}]`
    );
    if (tuple.length !== 5 || typeof tuple[4] !== "boolean") {
      throw new Error(
        "Persisted classifier source tuple must have five entries"
      );
    }
    return [
      portablePath(
        string(tuple[0], "persisted classifier source path"),
        "persisted classifier source path"
      ),
      hash(tuple[1], "persisted classifier sourceHash"),
      hash(tuple[2], "persisted classifier boundaryHash"),
      classifierDecision(tuple[3], "persisted classifier source decision"),
      tuple[4],
    ];
  });
  return validateMiraiIntlPersistedClassifierAuthorityV3({
    artifactHash: hash(input["artifactHash"], "classifier artifactHash"),
    checkpointAHash: hash(
      input["checkpointAHash"],
      "classifier checkpointAHash"
    ),
    indexHash: hash(input["indexHash"], "classifier indexHash"),
    inputHash: hash(input["inputHash"], "classifier inputHash"),
    optimizedRequiresProgramVectorHash: hash(
      input["optimizedRequiresProgramVectorHash"],
      "classifier optimized vector hash"
    ),
    owner: portablePath(
      string(input["owner"], "classifier authority owner"),
      "classifier authority owner"
    ),
    receiptProjectionHash: hash(
      input["receiptProjectionHash"],
      "classifier receipt projection hash"
    ),
    referenceRequiresProgramVectorHash: hash(
      input["referenceRequiresProgramVectorHash"],
      "classifier reference vector hash"
    ),
    resultHash: hash(input["resultHash"], "classifier resultHash"),
    sources,
  });
}

export function parseMiraiIntlClassifierAuthorityV3(
  value: unknown
): MiraiIntlClassifierAuthorityV3 {
  const input = record(value, "Mirai Intl classifier authority V3");
  const sources = array(input["sources"], "classifier authority sources").map(
    (entry, index): MiraiIntlClassifierAuthoritySourceV3 => {
      const source = record(entry, `classifier authority sources[${index}]`);
      const decision = classifierDecision(
        source["decision"],
        "Mirai Intl classifier source decision"
      );
      if (typeof source["requiresProgram"] !== "boolean") {
        throw new Error("classifier source requiresProgram must be boolean");
      }
      return {
        boundaryHash: hash(source["boundaryHash"], "classifier boundaryHash"),
        decision,
        requiresProgram: source["requiresProgram"],
        source: string(source["source"], "classifier source"),
        sourceHash: hash(source["sourceHash"], "classifier sourceHash"),
      };
    }
  );
  const checkpointAInput = array(
    input["checkpointAInput"],
    "classifier checkpointAInput"
  ).map((entry, index) => {
    const tuple = array(entry, `classifier checkpointAInput[${index}]`);
    if (tuple.length !== 4) {
      throw new Error("classifier checkpointAInput tuple must have 4 entries");
    }
    const source = string(tuple[0], "classifier checkpoint source");
    const boundaryHash = hash(tuple[1], "classifier checkpoint boundaryHash");
    const decision = classifierDecision(
      tuple[2],
      "Mirai Intl classifier checkpoint decision"
    );
    return [
      source,
      boundaryHash,
      decision,
      hash(tuple[3], "classifier checkpoint sourceHash"),
    ] as const;
  });
  const parseVector = (entry: unknown, label: string) =>
    array(entry, label).map((tupleValue, index) => {
      const tuple = array(tupleValue, `${label}[${index}]`);
      if (tuple.length !== 2 || typeof tuple[1] !== "boolean") {
        throw new Error(`${label} tuple must be [source, boolean]`);
      }
      return [string(tuple[0], `${label} source`), tuple[1]] as const;
    });
  return validateMiraiIntlClassifierAuthorityV3({
    artifactBinding: record(
      input["artifactBinding"],
      "classifier artifactBinding"
    ),
    artifactHash: hash(input["artifactHash"], "classifier artifactHash"),
    checkpointAHash: hash(
      input["checkpointAHash"],
      "classifier checkpointAHash"
    ),
    checkpointAInput,
    indexBinding: record(input["indexBinding"], "classifier indexBinding"),
    indexHash: hash(input["indexHash"], "classifier indexHash"),
    inputHash: hash(input["inputHash"], "classifier inputHash"),
    optimizedRequiresProgramVector: parseVector(
      input["optimizedRequiresProgramVector"],
      "classifier optimized vector"
    ),
    optimizedRequiresProgramVectorHash: hash(
      input["optimizedRequiresProgramVectorHash"],
      "classifier optimized vector hash"
    ),
    referenceRequiresProgramVector: parseVector(
      input["referenceRequiresProgramVector"],
      "classifier reference vector"
    ),
    referenceRequiresProgramVectorHash: hash(
      input["referenceRequiresProgramVectorHash"],
      "classifier reference vector hash"
    ),
    receiptProjectionHash: hash(
      input["receiptProjectionHash"],
      "classifier receipt projection hash"
    ),
    resultHash: hash(input["resultHash"], "classifier resultHash"),
    sources,
    workspaceRoot: string(input["workspaceRoot"], "classifier workspaceRoot"),
  });
}

export function buildMiraiIntlClassifierAuthorityEnvelopeV3(
  input: Readonly<{
    authorities: ReadonlyArray<MiraiIntlPersistedClassifierAuthorityV3>;
    receiptHash: Sha256;
    sourceAuthorizationHash: Sha256;
  }>
): MiraiIntlClassifierAuthorityEnvelopeV3 {
  if (
    !SHA256_PATTERN.test(input.receiptHash) ||
    !SHA256_PATTERN.test(input.sourceAuthorizationHash)
  ) {
    throw new Error("Invalid Mirai Intl classifier envelope receipt binding");
  }
  const authorities = input.authorities
    .map(validateMiraiIntlPersistedClassifierAuthorityV3)
    .toSorted((left, right) =>
      compareCanonicalStrings(left.owner, right.owner)
    );
  assertUniqueSortedSources(
    authorities.map(({ owner }) => owner),
    "persisted owner coverage"
  );
  return deepFreezeMiraiIntlClassifierValue({
    authorities,
    receiptHash: input.receiptHash,
    schemaVersion: 3,
    sourceAuthorizationHash: input.sourceAuthorizationHash,
  });
}

export function canonicalMiraiIntlClassifierAuthorityEnvelopeV3Bytes(
  value: MiraiIntlClassifierAuthorityEnvelopeV3
): string {
  return `${canonicalJson(buildMiraiIntlClassifierAuthorityEnvelopeV3(value))}\n`;
}

export function parseCanonicalMiraiIntlClassifierAuthorityEnvelopeV3(
  source: string
): MiraiIntlClassifierAuthorityEnvelopeV3 {
  const input = record(
    JSON.parse(source) as unknown,
    "Mirai Intl classifier authority envelope V3"
  );
  exactKeys(
    input,
    ["authorities", "receiptHash", "schemaVersion", "sourceAuthorizationHash"],
    "Mirai Intl classifier authority envelope V3"
  );
  if (input["schemaVersion"] !== 3) {
    throw new Error("Classifier authority envelope schemaVersion must equal 3");
  }
  const envelope = buildMiraiIntlClassifierAuthorityEnvelopeV3({
    authorities: array(input["authorities"], "classifier authorities").map(
      parseMiraiIntlPersistedClassifierAuthorityV3
    ),
    receiptHash: hash(input["receiptHash"], "classifier envelope receiptHash"),
    sourceAuthorizationHash: hash(
      input["sourceAuthorizationHash"],
      "classifier envelope sourceAuthorizationHash"
    ),
  });
  if (
    source !== canonicalMiraiIntlClassifierAuthorityEnvelopeV3Bytes(envelope)
  ) {
    throw new Error(
      "Classifier authority envelope must use canonical JSON bytes"
    );
  }
  return envelope;
}

export function hashMiraiIntlClassifierAuthorityEnvelopeV3(
  value: MiraiIntlClassifierAuthorityEnvelopeV3
): Sha256 {
  return sha256(canonicalMiraiIntlClassifierAuthorityEnvelopeV3Bytes(value));
}
