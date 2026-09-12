# ADR 0003: Shared call-site emission and artifact ABI v3

- Status: Accepted
- Date: 2026-09-12
- Supersedes: the per-call-site `pN`/`rN`/`mN` triple introduced with compact
  private message modules
- Scope: `packages/compiler` emission and private slicing, `packages/runtime`
  representations
- Artifact ABI: `mirai-intl-artifact-v2` -> `mirai-intl-artifact-v3`

## Context

`catalog.messages.gen.mjs` emitted three statements per message:

```js
const p0 = /* @__PURE__ */ createPrecompiledLocaleRenderer({ "en": (state) => ("Your cart is empty"), "th": (state) => ("…") });
export const r0 = /* @__PURE__ */ createPrecompiledRuntimeMessage({"argumentSchema":{…},"formatterIds":[],"id":"msg_022e…","kind":"text","path":"…","provenanceRef":"message:msg_022e…","resultSchema":{"type":"string"},"tags":[],"validatorId":1}, p0);
export const m0 = /* @__PURE__ */ createPrecompiledDescriptor(/* @__PURE__ */ defineMessageDescriptor({"buildToken":"…","capabilitySetHash":"sha256:…","catalogHash":"sha256:…","catalogId":"…","formatVersion":1,"kind":"text","messageId":"msg_022e…","path":"…","rendererCapabilityId":"portable-ir-v1","runtimeAbi":"1.0.0","validatorId":1}), p0, r0);
```

Two costs are structural rather than informational.

1. **Seven invariant descriptor fields** — `buildToken`, `capabilitySetHash`,
   `catalogHash`, `catalogId`, `formatVersion`, `rendererCapabilityId`, and
   `runtimeAbi` — are byte-identical at every call site of one catalog, and so
   are the derived runtime-message fields `provenanceRef` (always
   `"message:" + id`), `resultSchema` (always `{"type":"string"}` for text and
   rich), `tags` (empty outside rich), and `formatterIds` (usually empty).
2. **The inline precompiled renderer is authoritative only for
   `precompiled-v1`.** `createPrecompiledBackend` renders from it, and
   `MiraiIntlRuntime` throws when it is missing under that capability. Under
   `portable-ir-v1` / `tfunction-bridge-v1` the tfunction bridge renders text
   from the host i18next resource bundle and never reads
   `request.precompiledRenderer`; only `renderRich` does. The emitted text
   renderers — and both locale payloads inside them — were therefore dead
   weight on every intl-bearing chunk, duplicating strings the resource bundle
   already ships and already gates first paint on.

## Decision

### Emission

`catalog.messages.gen.mjs` emits a module-level prelude once and a single
factory call per message:

```js
import { createMiraiIntlCallSites, createPrecompiledLocaleRenderer, renderPrecompiledArgument, … } from "@openmirai/intl/runtime";

const __c = /* @__PURE__ */ createMiraiIntlCallSites({"buildToken":"…","capabilitySetHash":"sha256:…","catalogHash":"sha256:…","catalogId":"…","formatVersion":1,"rendererCapabilityId":"portable-ir-v1","runtimeAbi":"1.0.0"});

export const m7 = /* @__PURE__ */ __c.text(7, "msg_e992…", "greeting.morning", {"name":{"type":"string"}}, ["name"]);

const p10 = /* @__PURE__ */ createPrecompiledLocaleRenderer({ "en": (state) => […], "th": (state) => […] });

export const m10 = /* @__PURE__ */ __c.rich(10, "msg_6bca…", "rich.deactivate", p10, ["medium"], {"name":{"type":"string"}}, ["name"]);
```

Argument lists are positional, ordered by how often each value is non-default,
and trailing defaults are omitted:

- `__c.text(validatorId, messageId, path, properties?, required?, formatterIds?, renderer?, resultSchema?)`
- `__c.rich(validatorId, messageId, path, renderer, tags, properties?, required?, formatterIds?, resultSchema?)`
- `__c.value(validatorId, messageId, path, renderer, resultSchema, properties?, required?, formatterIds?)`

The renderer is emitted when
`manifest.rendererCapabilityId === "precompiled-v1"` (all kinds, unchanged) or
`message.kind !== "text"` (rich and value, every capability). The mode is
derived from the manifest; there is no new user-facing option.

The legacy non-compact `catalog.descriptors.gen.mjs` and the proxy
representation are unchanged — they are not the shipped path and still export
`runtimeMessage_*` bindings.

### Runtime

`createMiraiIntlCallSites(shared)` in `packages/runtime/src/representations.ts`
returns frozen `{ text, rich, value }` builders that construct exactly the
objects the old emission spelled out: `defineMessageDescriptor(...)`, the
`RuntimeMessage` with derived `provenanceRef`/`resultSchema`/`formatterIds`/
`tags`, and then `createPrecompiledDescriptor(descriptor, renderer?,
runtimeMessage)`. When no renderer is emitted the runtime message is a frozen
plain object instead of a `createPrecompiledRuntimeMessage` result, so no
renderer brand is attached and `getPrecompiledRenderer` returns `undefined`.

`createPrecompiledRuntimeMessage` and `createPrecompiledLocaleRenderer` stay
exported for the `precompiled-v1` path and for already-published catalogs.
Descriptor resolution, the embedded-runtime-message lookup, ICU handling, and
missing-resource recovery are untouched.

### Private slicing

`packages/compiler/src/private-module.ts` no longer demands a complete
`pN`/`rN`/`mN` triple. It indexes every top-level declaration by binding name
together with the same-module bindings its initializer references, then slices
the transitive closure of the requested `mN` exports. The `__c` prelude and the
import statements form a preamble carried into every slice. Consequences:

- `mN` is required; `pN` is required exactly when something in the closure
  references it; `rN` is accepted when present (published v2 payloads) and is no
  longer emitted.
- Deleting a referenced declaration still fails closed, now with the precise
  `requires the pN declaration referenced by mN` diagnostic.

## Artifact ABI

`CATALOG_ARTIFACT_ABI` moves from `mirai-intl-artifact-v2` to
`mirai-intl-artifact-v3`. The slicer is coupled to the statement grammar, so an
older compiler must not slice a newer payload. `packages/compiler/src/proof.ts`
and `packages/compiler/src/catalog.ts` now consume the constant rather than
repeating the literal.

What does **not** change:

- `RUNTIME_ABI` stays `1.0.0` and `packages/abi` is untouched. The descriptor
  and runtime-message shapes are identical; only their construction moves.
- `capabilitySetHash` is `canonicalHash({formatterVersions,
  rendererCapabilityId, runtimeAbi})`; none of those inputs change.
- `hashCatalogContent` does not read `manifest.compilerVersion`, so
  `catalogHash` and `buildToken` do not rotate for an unchanged catalog. The
  *artifact* content hash does change (the emitted bytes changed), so
  `current.json`, the build directory, and the generation receipt rotate.
- `catalog.provenance.gen.json` keeps its `runtimeExport: "rN"` entry as a
  positional integrity token; the transform validates index parity against it
  and never imports the binding. Removing the field is a separate provenance
  schema change.

Consumers must regenerate and re-authorize: existing
`catalog-generation-receipt.v1.json` files pin `compilerHash` and a per-file
hash manifest and fail against any compiler byte change regardless.

## Consequences

- Emitted `catalog.messages.gen.mjs` for `test/fixtures` (13 messages, 9 text,
  2 rich, 2 value): 17,792 -> 4,503 bytes raw (-74.7%), 2,591 -> 1,540 bytes
  gzip-9 (-40.6%). A five-message slice: 7,774 -> 2,208 bytes raw (-71.6%),
  1,550 -> 941 bytes gzip-9 (-39.3%).
- On an application-shaped catalog (7,000 text messages, `en` + `th`,
  `portable-ir-v1`): 8,487,959 -> 765,244 bytes raw (-91.0%) and
  425,534 -> 136,080 bytes gzip-9 (-68.0%). A 371-message
  `__mirai_intl_exports` slice — one route chunk's worth of call sites —
  449,844 -> 41,158 bytes raw (-90.9%) and 25,590 -> 8,414 bytes gzip-9
  (-67.1%). Indexing and slicing that module also gets cheaper: 671 ms -> 190 ms
  cold, 1.81 ms -> 0.33 ms warm.
- No behaviour change for text under `portable-ir-v1`: the resource bundle was
  already the only source consulted, and `Provider` already gates first paint on
  it.
- `precompiled-v1` keeps every inline renderer and therefore keeps rendering
  without a resource bundle; `pack:smoke` exercises that path end to end.
