# Unapplied ordinary Turbo adoption

The patch is retained in private `openmirai/fe-mirai-org-turbo` at `docs/plans/intl-native-ci/proposals/turbo-published-adoption.patch`; it is not copied into this public library. It targets Turbo commit
`2596ad2c03ef401e53fe2d83c0556e6f2f81ff9d`. The five patched files match staging
`f730f7b4bbd866bb55ff103876bb1c8d912e8015`. This is a proposal only: no Turbo
file, lockfile, generated output, runner, or published package was changed.

Prerequisites from the Turbo feature branch must accompany adoption: the
`prepare-intl-authority` action, `find-intl-authority.mjs`,
`prepare-intl-authority.mjs`, their tests, and the existing task-specific
`MIRAI_INTL_ENGINE` passthrough in `turbo.json`. The patch does not independently
install these prerequisites on staging and introduces no global passthrough.

## Proposed behavior

- Both existing prepare jobs call the composite with the existing GitHub token
  and the unchanged `runner.temp/intl-authority.tar` destination. Their existing
  conditions, runners, job dependencies, archive names and downstream consumers
  are preserved. Existing permissions already cover Actions metadata/downloads.
- Non-application quality materialization uses that same composite under its
  unchanged condition, with step ID `quality-intl-authority` and separate
  `runner.temp/intl-quality-authority.tar` output. Valid unchanged authority
  avoids another audit here too. Its dedicated best-effort diagnostic upload
  includes discovery/recheck/preparation JSON plus workspace and authority reports.
  The five-catalog verification and generated-drift gate remain mandatory.
- The composite searches at most ten trusted successful producers, pins run,
  attempt, artifact and digest, uses official digest-enforced download, then
  rechecks the saved pin. Metadata/transport/operational failures stay fatal.
  Only discovery miss or structured native recovery-safe rejection authorizes
  one fresh producer. Reuse verifies five catalogs with zero compilation,
  emission and semantic runs and forwards exact archive bytes. Both branches
  finish with the current five-root generated-drift check.
- Separate diagnostic uploads retain discovery, recheck and preparation JSON.
  They are best-effort, like existing diagnostics; the actual authority upload
  and all verification gates remain mandatory. No extra archive copy is uploaded.
- Rust is forced inside all three preparation calls, consumer import/verification,
  coverage task invocation and Worker
  build invocation. Existing task-specific passthrough carries it to build/test
  processes. Consumers still import the exact current-run artifact and enforce
  the unchanged five-catalog zero-work proof in `intl-authority.sh`.
- Exactly five existing npm registry tarball URLs advance from `0.3.29` to
  `0.3.30`; catalog selectors and all unrelated dependencies remain unchanged.

## Publication and generated-state gate

Do not apply for operational adoption until the corrected library release has
passed its required source, all-eight-target native, packed-consumer and strictness
checks and publication is explicitly approved and completed. Library `37a8628` now has passing normal34494038352 and native34494038965 CI,
including all eight targets and packed strictness. Corrected Turbo acceptance34498093485 and34506410455 pass; paired preparation34506408677 and workspace verification34510179246 pass. Workspace reuse and historical preparation context remain required; publication has not occurred. Local3eb49b8 adds tests/docs only and needs final-head CI before publication approval.
Historical `.30` candidate evidence does not substitute for these corrected consumer gates.

After publication, in the authorized isolated Turbo adoption worktree with
`.nvmrc` selected, first check and apply the patch, then use repository tools:

```sh
git apply --check /absolute/path/to/turbo-published-adoption.patch
git apply /absolute/path/to/turbo-published-adoption.patch
corepack pnpm install --no-frozen-lockfile
MIRAI_INTL_ENGINE=rust corepack pnpm run intl:authorize
MIRAI_INTL_ENGINE=rust corepack pnpm run intl:verify-authority
```

Review the tool-produced `pnpm-lock.yaml` and generated controls/artifacts for
all five catalogs, including changed generation identities. Verify actual
resolved published package identities and native assets; package version strings
alone do not prove registry bytes. Do not fabricate integrity fields, hand-edit
receipts, or copy candidate `file:` overrides into the published lock. A frozen
install must pass afterward. Apply the repository's existing commit/review rules
to the regenerated tracked state; the CI drift gate is expected to fail until
that state is included in the adoption change.

Run the focused preparation/discovery/action and environment-contract tests,
required normal checks, and an actual cold producer followed by accepted reuse
with exact-byte forwarding. Confirm downstream quality, tests and all required
application builds import and verify without compilation/emission/semantic work.
Neither candidate measurement mode nor the local helper pilot establishes this
ordinary-CI adoption proof. Keep the patch unapplied until these gates can be met.

Validation of the proposal: `git apply --check` against the inspected Turbo
worktree; YAML parsing of all five proposed files; unchanged workflow job
inventories, dependencies and runner labels. No install, generation, build,
workflow execution, commit, push, merge or publication was performed for this
proposal.

The revision also checks the preserved non-application quality condition and
absence of its former direct `pnpm run intl:authorize` step. The explicit local
authorization command above is only for post-publication regeneration of changed
tracked inputs; it is not a remaining unconditional ordinary-CI audit callsite.

## Protected producer sequence for the final cache-hit proof

Discovery accepts successful producers from the existing validation/release workflows on protected main/staging. A feature-PR artifact is deliberately not elevated to a trusted reusable producer. Source/receipt/artifact verification remains mandatory after that metadata filter.

Consequently the first ordinary feature CI after0.3.30 publication may correctly reject all older0.3.29 authorities and perform one fresh audit. Demonstrate that clean path and all downstream proofs before requesting the exact Turbo squash merge approval. The exact approved squash commit message must contain the repository-supported `[build-only]` marker: use PR title `ci(intl): adopt native authority reuse [build-only]`, include the marker in the reviewed PR body, and confirm GitHub squash message configuration before invoking the required merge wrapper. The marker keeps `.github/workflows/validate.yml` from dispatching changed-app staging qualification/deployment on the merge push. Do not merge without confirming that exact message or separately approving deployment. After the approved `[build-only]` merge, allow or dispatch ordinary staging validation to create the first trusted0.3.30 authority; then dispatch a second ordinary validation on identical staging inputs and require a verified reuse hit with zero audit/regeneration. Do not weaken producer provenance merely to get a pre-merge cache-hit demonstration. Dispatching validation is already authorized; merging is not.

No main promotion, application deployment or runner configuration change is part of this proof. Release workflow wiring receives static/contract verification unless its existing main/version-PR release prerequisite is separately authorized; do not forge that prerequisite.
