import { resolve } from "node:path";

import {
  compileCatalog,
  emitArtifacts,
} from "../packages/compiler/src/internal";
import { writeArtifactSet } from "../packages/compiler/test/non-authoritative-writer";

import { catalogFixtureSource } from "../test/fixtures/catalog";

const output = compileCatalog(catalogFixtureSource);
const representation = "precompiled";
const artifacts = emitArtifacts(output, representation, { compact: true });
const result = await writeArtifactSet(
  resolve(import.meta.dirname, "..", "test", "generated", representation),
  artifacts
);

process.stdout.write(
  `${JSON.stringify({ generated: [{ representation, ...result }] }, null, 2)}\n`
);
