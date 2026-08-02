import { resolve } from "node:path";

import {
  compileCatalog,
  emitArtifacts,
} from "../packages/compiler/src/internal";
import { verifyArtifactSet } from "../packages/compiler/test/non-authoritative-writer";

import { catalogFixtureSource } from "../test/fixtures/catalog";

const output = compileCatalog(catalogFixtureSource);
const representation = "precompiled";
const root = resolve(
  import.meta.dirname,
  "..",
  "test",
  "generated",
  representation
);
await verifyArtifactSet(
  root,
  emitArtifacts(output, representation, { compact: true })
);

process.stdout.write(`${JSON.stringify({ generatedArtifacts: "current" })}\n`);
