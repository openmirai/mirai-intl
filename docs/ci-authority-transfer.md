# Strict CI authority transfer

Run fresh source authorization on the exact checkout that will be built. Use
the compiler to export and import its selected authority; workflows must not
copy private receipt paths themselves.

```sh
# Producer: dependencies are installed from the frozen lockfile first.
pnpm exec mirai-intl check --workspace --report-file=intl-check.json
pnpm exec mirai-intl authority export --workspace --out intl-authority.tar

# Consumer: same checkout and frozen dependencies, in a separate inactive runner.
pnpm exec mirai-intl authority import --workspace --from intl-authority.tar \
  --report-file=intl-import.json
pnpm exec mirai-intl verify --workspace --report-file=intl-verify.json
```

`@openmirai/intl-compiler/verify` also exports `exportAuthorityBundle` and
`importAuthorityBundle`, each taking `{ root, archive }`. Both return catalog
paths, file count and uncompressed byte count. `root` is a workspace root;
every convention-discovered catalog is mandatory. Existing output archives are
never overwritten.

## What is transferred

The archive contains a canonical inventory plus exactly the selected native
objects for every catalog:

- The package selector and its content-addressed authority set.
- The immutable V3 receipt and classifier-authority envelope referenced by it.
- The generation receipt, current pointer, catalog lock, facade, and every file
  in the selected payload manifest.
- The selected workspace authority, when the producer has one.

The importer independently discovers catalogs and reconstructs the reference
graph. A file list or valid archive digest alone cannot establish completeness.
Native source, package, lock, compiler, locale, provider and artifact validation
still runs; no old receipt fallback or semantic regeneration is allowed.

The format excludes dormant receipt mirrors, other generated builds, temporary
files, credentials and publication locks. It never restores authored source,
package manifests or dependencies over the receiving checkout.

## GitHub Actions

Upload the single non-hidden `intl-authority.tar`, not `.mirai-intl/**` globs.
The normal `upload-artifact@v7` ZIP compression can compress that tar as one
member; there is no need to disable compression or separately gzip it. Download
the exact artifact ID produced by the expected job/run/attempt, using
`download-artifact@v8` and its default `digest-mismatch: error`. Normal download
decompression restores the tar file, then the compiler imports it.

The tar itself is deterministic and uncompressed: it preserves selected file
paths without relying on GitHub's hidden-file selection or permission
normalization. Imports reject compressed tar streams, links, duplicate entries,
unsafe paths, non-regular files, unlisted members, oversized payloads and digest
mismatches. The current limits are 10,000 files and 512 MiB of selected content.
The archive allows a further 64 MiB of bounded tar/manifest overhead.

Optional workspace authority must match every selected package reference and
the receiving lockfile bytes. Top-level tree/snapshot/toolchain hashes are
preserved producer provenance; transfer does not reinterpret or recompute them.
Receiving authorization comes from native V3 package closure verification,
including current compiler and dependency identities. A receiving workspace
authority absent from the bundle is rejected; use a clean checkout.

GitHub's digest validates transferred bytes, not the trustworthiness of their
producer. Keep the producer on the intended trusted workflow/checkout. A
self-consistent bundle from an arbitrary untrusted workflow is not authorization
to build or deploy it. Keep final client and server/Worker proof gates.

Always upload `intl-check.json`, `intl-import.json` and `intl-verify.json` on
failure. Otherwise a redirected diagnostic can disappear when a build stops
before the normal final-proof report is written.

## Publication and recovery

Import is an exclusive preparation operation, not a dev-server or live-build
update. Stop generators and readers first. The importer snapshots the archive
and validates the complete inventory outside the selected output directories.
It then installs generated files under a transaction so the normal compiler
resolver can inspect their declarations. No new authority selector is activated
until all packages verify against the receiving source tree. A final check
catches input changes during publication.

Failures restore the prior generated/authority directories. If rollback itself
fails, the error identifies retained backups and leaves the import lock in place
for explicit recovery; it never deletes those backups to report a clean failure.
A killed process may likewise leave a transaction directory and lock. Recover
those before retrying; do not silently delete locks or bypass verification.
Import also refuses existing catalog publication locks or journals instead of
replacing their recovery evidence.

Do not import concurrently with builds or generation. Existing publication
contracts do not provide lock-free readers during generated-directory rotation.
