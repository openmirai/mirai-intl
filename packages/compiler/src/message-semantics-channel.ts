import { randomBytes } from "node:crypto";
import { fstatSync } from "node:fs";
import { Socket } from "node:net";
import type { Readable, Writable } from "node:stream";
import {
  canonicalHash,
  canonicalJson,
  decodeUtf8Fatal,
  sha256,
} from "./canonical";
import { receiveMessageSemanticsSnapshot } from "./message-semantics";
import {
  getImmutableIntegrityIdentity,
  computeImmutableIntegrityIdentity,
} from "./integrity-identity";
import compilerPackage from "../package.json" with { type: "json" };

// This module is private to the compiler coordinator. A digest detects transfer
// damage; it is NOT evidence that arbitrary IR was derived by the compiler.
// Trust in the executing coordinator is a precondition, not established by
// self-declared PID/session metadata against a hostile launcher.
export const MAX_MESSAGE_SEMANTICS_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const MAX_METADATA_BYTES = 4096;
export const MAX_MESSAGE_SEMANTICS_FRAME_BYTES =
  MAX_MESSAGE_SEMANTICS_SNAPSHOT_BYTES + MAX_METADATA_BYTES + 4;
export const MESSAGE_SEMANTICS_SESSION_ENV =
  "MIRAI_INTL_PRIVATE_SEMANTICS_SESSION";
export const MESSAGE_SEMANTICS_PARENT_ENV =
  "MIRAI_INTL_PRIVATE_SEMANTICS_PARENT";
const CHANNEL_FD = 3;
const context = Object.freeze({
  revision: 1,
  compiler: compilerPackage.version,
  parser: compilerPackage.dependencies["@formatjs/icu-messageformat-parser"],
  node: process.versions.node,
  icu: process.versions.icu ?? null,
  cldr: process.versions.cldr ?? null,
  unicode: process.versions.unicode ?? null,
});

export type MessageSemanticsTransfer = Readonly<{
  session: string;
  frame: Buffer;
}>;

/** Bind actual compiler/dependency bytes, independently of version labels. */
export async function messageSemanticsCompilerIdentity(
  fresh = false
): Promise<string> {
  return canonicalHash(
    await (fresh
      ? computeImmutableIntegrityIdentity()
      : getImmutableIntegrityIdentity())
  );
}

export function createMessageSemanticsTransfer(
  snapshot: string,
  compilerIdentity: string
): MessageSemanticsTransfer {
  if (!/^sha256:[a-f0-9]{64}$/u.test(compilerIdentity)) {
    throw new Error("Invalid message semantics compiler identity");
  }
  const payload = Buffer.from(snapshot);
  if (payload.length > MAX_MESSAGE_SEMANTICS_SNAPSHOT_BYTES) {
    throw new Error("Message semantics snapshot exceeds channel limit");
  }
  const session = randomBytes(32).toString("hex");
  const metadata = Buffer.from(
    JSON.stringify({
      context: { ...context, compilerIdentity },
      session,
      digest: sha256(payload),
    })
  );
  if (metadata.length > MAX_METADATA_BYTES) {
    throw new Error("Message semantics metadata exceeds channel limit");
  }
  // Raw UTF-8 snapshot follows a small JSON header; it is never JSON-escaped twice.
  const header = Buffer.alloc(8);
  header.writeUInt32BE(4 + metadata.length + payload.length, 0);
  header.writeUInt32BE(metadata.length, 4);
  return Object.freeze({
    session,
    frame: Buffer.concat([header, metadata, payload]),
  });
}

export function decodeMessageSemanticsFrame(
  frame: Buffer,
  session: string,
  compilerIdentity: string
): string {
  if (frame.length < 8 || frame.length !== frame.readUInt32BE(0) + 4) {
    throw new Error("Message semantics frame length mismatch");
  }
  const metadataLength = frame.readUInt32BE(4);
  const payloadOffset = 8 + metadataLength;
  if (
    frame.length - 4 > MAX_MESSAGE_SEMANTICS_FRAME_BYTES ||
    metadataLength > MAX_METADATA_BYTES ||
    payloadOffset > frame.length ||
    frame.length - payloadOffset > MAX_MESSAGE_SEMANTICS_SNAPSHOT_BYTES
  ) {
    throw new Error("Message semantics frame exceeds channel limit");
  }
  const envelope: unknown = JSON.parse(
    decodeUtf8Fatal(
      frame.subarray(8, payloadOffset),
      "Message semantics metadata"
    )
  );
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new Error("Invalid message semantics frame");
  }
  if (
    Object.keys(envelope).toSorted().join(",") !== "context,digest,session" ||
    !("session" in envelope) ||
    envelope.session !== session ||
    !/^[a-f0-9]{64}$/u.test(session)
  ) {
    throw new Error("Message semantics frame session mismatch");
  }
  if (
    !("context" in envelope) ||
    canonicalJson(envelope.context) !==
      canonicalJson({ ...context, compilerIdentity })
  ) {
    throw new Error("Message semantics execution context mismatch");
  }
  const payload = frame.subarray(payloadOffset);
  if (!("digest" in envelope) || envelope.digest !== sha256(payload)) {
    throw new Error("Message semantics frame digest mismatch");
  }
  return decodeUtf8Fatal(payload, "Message semantics snapshot");
}

export async function readMessageSemanticsFrame(
  stream: Readable,
  session: string,
  compilerIdentity: string,
  timeoutMs = 30_000
): Promise<string> {
  const timer = setTimeout(
    () => stream.destroy(new Error("Message semantics channel timed out")),
    timeoutMs
  );
  let frame: Buffer | undefined;
  const header = Buffer.alloc(4);
  let total = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (total < 4) {
        bytes.copy(header, total, 0, Math.min(4 - total, bytes.length));
      }
      total += bytes.length;
      if (
        total > MAX_MESSAGE_SEMANTICS_FRAME_BYTES + 4 ||
        (total >= 4 &&
          header.readUInt32BE(0) > MAX_MESSAGE_SEMANTICS_FRAME_BYTES)
      ) {
        throw new Error("Message semantics frame exceeds channel limit");
      }
      if (total >= 4 && total > header.readUInt32BE(0) + 4) {
        throw new Error("Message semantics frame length mismatch");
      }
      if (total >= 4) {
        if (!frame) {
          frame = Buffer.allocUnsafe(header.readUInt32BE(0) + 4);
          header.copy(frame);
        }
        const before = total - bytes.length;
        bytes.copy(frame, Math.max(4, before), Math.max(0, 4 - before));
      }
    }
    return decodeMessageSemanticsFrame(
      (frame ?? header).subarray(0, total),
      session,
      compilerIdentity
    );
  } finally {
    clearTimeout(timer);
    stream.destroy();
  }
}

export async function sendMessageSemanticsFrame(
  stream: Writable,
  transfer: MessageSemanticsTransfer,
  timeoutMs = 30_000
): Promise<void> {
  const timer = setTimeout(
    () => stream.destroy(new Error("Message semantics channel timed out")),
    timeoutMs
  );
  try {
    await new Promise<void>((resolve, reject) => {
      // Keep an error listener through close, including an early child exit.
      stream.on("error", reject);
      stream.end(transfer.frame, (error?: Error | null) =>
        error ? reject(error) : resolve()
      );
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function receiveInheritedMessageSemanticsSession(
  timeoutMs = 30_000
) {
  const session = process.env[MESSAGE_SEMANTICS_SESSION_ENV];
  const parent = process.env[MESSAGE_SEMANTICS_PARENT_ENV];
  delete process.env[MESSAGE_SEMANTICS_SESSION_ENV];
  delete process.env[MESSAGE_SEMANTICS_PARENT_ENV];
  if (session === undefined && parent === undefined) {
    return undefined;
  }
  if (
    !session ||
    !/^[a-f0-9]{64}$/u.test(session) ||
    parent !== String(process.ppid) ||
    process.env.MIRAI_INTL_WORKSPACE_CHILD !== "1"
  ) {
    throw new Error("Invalid private message semantics coordinator session");
  }
  const entry = fstatSync(CHANNEL_FD);
  if (!entry.isFIFO() && !entry.isSocket()) {
    throw new Error("Message semantics requires an inherited pipe");
  }
  const compilerIdentity = await messageSemanticsCompilerIdentity();
  const serialized = await readMessageSemanticsFrame(
    new Socket({ fd: CHANNEL_FD, readable: true, writable: false }),
    session,
    compilerIdentity,
    timeoutMs
  );
  // Shape/context checks are defense in depth. Producer derivation is trusted
  // only because the coordinator created this private channel from its session.
  return receiveMessageSemanticsSnapshot(serialized);
}
