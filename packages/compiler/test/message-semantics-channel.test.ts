import { Readable, Writable } from "node:stream";
import { expect, it } from "vitest";
import {
  createMessageSemanticsTransfer,
  decodeMessageSemanticsFrame,
  readMessageSemanticsFrame,
  sendMessageSemanticsFrame,
  MAX_MESSAGE_SEMANTICS_FRAME_BYTES,
} from "../src/message-semantics-channel";

const compilerIdentity = `sha256:${"1".repeat(64)}`;

it("round trips a private session frame without interpreting IR as authority", async () => {
  const transfer = createMessageSemanticsTransfer(
    '{"snapshot":"test"}',
    compilerIdentity
  );
  expect(
    decodeMessageSemanticsFrame(
      transfer.frame,
      transfer.session,
      compilerIdentity
    )
  ).toBe('{"snapshot":"test"}');
  expect(
    await readMessageSemanticsFrame(
      Readable.from([
        transfer.frame.subarray(0, 2),
        transfer.frame.subarray(2),
      ]),
      transfer.session,
      compilerIdentity
    )
  ).toBe('{"snapshot":"test"}');
});

it("rejects a different session, truncation, trailing data and tampering", () => {
  const { frame, session } = createMessageSemanticsTransfer(
    "payload",
    compilerIdentity
  );
  expect(() =>
    decodeMessageSemanticsFrame(frame, "0".repeat(64), compilerIdentity)
  ).toThrow(/session/u);
  expect(() =>
    decodeMessageSemanticsFrame(
      frame.subarray(0, -1),
      session,
      compilerIdentity
    )
  ).toThrow(/length/u);
  expect(() =>
    decodeMessageSemanticsFrame(
      Buffer.concat([frame, Buffer.from("x")]),
      session,
      compilerIdentity
    )
  ).toThrow(/length/u);
  const modified = Buffer.from(frame);
  const payload = modified.indexOf("payload");
  modified[payload] = 88;
  expect(() =>
    decodeMessageSemanticsFrame(modified, session, compilerIdentity)
  ).toThrow(/digest/u);
});

it("rejects incompatible execution context even with a valid payload digest", () => {
  const { frame, session } = createMessageSemanticsTransfer(
    "payload",
    compilerIdentity
  );
  const metadataLength = frame.readUInt32BE(4);
  const envelope = JSON.parse(frame.subarray(8, 8 + metadataLength).toString());
  envelope.context.node = "0.0.0";
  const body = Buffer.from(JSON.stringify(envelope));
  const header = Buffer.alloc(8);
  header.writeUInt32BE(4 + body.length + 7, 0);
  header.writeUInt32BE(body.length, 4);
  expect(() =>
    decodeMessageSemanticsFrame(
      Buffer.concat([header, body, Buffer.from("payload")]),
      session,
      compilerIdentity
    )
  ).toThrow(/context/u);
});

it("rejects oversized declarations before waiting for their bodies", async () => {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(MAX_MESSAGE_SEMANTICS_FRAME_BYTES + 1);
  await expect(
    readMessageSemanticsFrame(
      Readable.from([header]),
      "a".repeat(64),
      compilerIdentity
    )
  ).rejects.toThrow(/limit/u);
});

it("bounds stalled-channel lifetime and rejects truncated streams", async () => {
  const { frame, session } = createMessageSemanticsTransfer(
    "payload",
    compilerIdentity
  );
  await expect(
    readMessageSemanticsFrame(
      Readable.from([frame.subarray(0, 7)]),
      session,
      compilerIdentity
    )
  ).rejects.toThrow(/length/u);
  const stalled = new Readable({ read() {} });
  await expect(
    readMessageSemanticsFrame(stalled, session, compilerIdentity, 10)
  ).rejects.toThrow(/timed out/u);
  expect(stalled.destroyed).toBe(true);
});

it("fails closed on blocked or failed writes instead of leaving delivery pending", async () => {
  const transfer = createMessageSemanticsTransfer("payload", compilerIdentity);
  const blocked = new Writable({ write() {} });
  await expect(
    sendMessageSemanticsFrame(blocked, transfer, 10)
  ).rejects.toThrow(/timed out/u);
  const broken = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error("closed receiver"));
    },
  });
  await expect(sendMessageSemanticsFrame(broken, transfer)).rejects.toThrow(
    /closed receiver/u
  );
});

it("frames raw snapshot bytes without multiplying JSON escapes", () => {
  const snapshot = "\0".repeat(2000);
  const { frame, session } = createMessageSemanticsTransfer(
    snapshot,
    compilerIdentity
  );
  expect(frame.length).toBeLessThan(Buffer.byteLength(snapshot) + 4096);
  expect(decodeMessageSemanticsFrame(frame, session, compilerIdentity)).toBe(
    snapshot
  );
});

it("rejects changed compiler bytes even when every version and snapshot digest matches", () => {
  const { frame, session } = createMessageSemanticsTransfer(
    "payload",
    compilerIdentity
  );
  expect(() =>
    decodeMessageSemanticsFrame(frame, session, `sha256:${"2".repeat(64)}`)
  ).toThrow(/context mismatch/u);
});
