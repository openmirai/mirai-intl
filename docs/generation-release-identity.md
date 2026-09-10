# Stable generation and current release authorization

Convention catalogs use `content-v1` as their build identity. Their existing content hash still binds catalog identity, locale content, contracts, composition, formatter versions, renderer capability and runtime ABI. The existing build token combines that stable identity with the catalog hash. Direct callers of `compileCatalog` retain their explicit `CatalogSource.buildId` behavior.

A convention generation receipt binds a domain-separated application manifest projection that excludes **only the top-level `version` field**. Every other manifest field and the complete resolved workspace lock remain included. `generationOptions.applicationIdentity` declares `application-generation-without-release-version:v1`. Compiler bytes, dependencies, TypeScript identity, normalized configuration, locale inventory and contracts retain their existing generation bindings.

Source authorization independently binds the complete current application manifest and lock. A version bump invalidates that authorization even when all generated files remain identical. The producer must audit current sources and bind new authority to the current manifest and verified payload. Standalone, transferred and build verification must reject a version change during their verification barriers. Generation reuse is never authorization reuse.

## Compatibility

The generation receipt, pointer, snapshot, catalog manifest and descriptor wire shapes are unchanged. Legacy V1 generation inputs remain structurally parseable; no field is silently dropped by the parser. Existing explicit compiler inputs remain supported. A compiler upgrade invalidates old generation input and authorization identities through the existing compiler-byte binding, requiring one normal regeneration and fresh audit. No old receipt is rewritten or accepted on the strength of a label or timestamp. After that migration, app-version-only bumps preserve generated payloads, descriptors, imports, catalog locks, pointers and tracked generation receipts byte for byte.

This is a compatible convention policy correction, subject to packed-consumer and real Turbo CI acceptance before a patch-only release. A version bump combined with a dependency or lock change is not a version-only change and receives the normal invalidation checks. No claim about linguistic translation quality follows from these structural guarantees.

## Regression gates

| Trigger | Generation behavior | Authorization and integrity behavior |
| --- | --- | --- |
| Identical rerun | No output or metadata change | Existing fully verified authority reusable |
| Only app version changes | No output or metadata change | Old authority rejected; fresh audit binds full current manifest |
| Version changes during verification | Stable generation hash alone insufficient | Explicit final full-manifest and raw manifest/lock checks reject |
| Translation or message contract changes | Generation invalidated; valid new content emitted | Old authority rejected; invalid locales/contracts fail |
| Source or import resolution changes | Output may stay identical | Current inventory, semantic checks and provider resolution remain mandatory |
| Config, dependencies, lock or compiler changes | Existing identity invalidation retained | Old authority rejected and final mutation barriers retained |
| Descriptor, payload, control or authority tampering | Corrupt selected output rejected | Full emitted-byte/archive/receipt proofs retained |
| Legacy explicit buildId | Original compiler behavior retained | Descriptor token and catalog bindings remain exact |

`docs/plans/intl-native-ci/evidence/generation-version-incident.json` records the exact Turbo incident and first-parent file hashes. The execution record distinguishes focused tests, packed consumer proof, actual four-app probes and final CI evidence; an unexecuted gate is not a pass.
