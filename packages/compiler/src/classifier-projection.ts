import { canonicalJson, sha256 } from "./canonical";
import type { MiraiIntlClassifierReceiptProjectionV3 } from "./classifier-candidate";

type Sha256 = `sha256:${string}`;

const classifierProjectionHashes = new WeakMap<
  MiraiIntlClassifierReceiptProjectionV3,
  Sha256
>();

export function hashMiraiIntlClassifierReceiptProjectionV3(
  projection: MiraiIntlClassifierReceiptProjectionV3
): Sha256 {
  const cached = classifierProjectionHashes.get(projection);
  if (cached !== undefined) {
    return cached;
  }
  const hash = sha256(
    canonicalJson([
      "mirai-intl",
      "classifier-receipt-projection",
      3,
      projection,
    ])
  );
  // Production projections are recursively frozen before hashing. Cache only
  // immutable values so mutable qualification inputs cannot return stale IDs.
  if (Object.isFrozen(projection)) {
    classifierProjectionHashes.set(projection, hash);
  }
  return hash;
}
