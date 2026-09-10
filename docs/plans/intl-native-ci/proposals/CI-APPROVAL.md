# Native CI jobs approved

Automatic approval review rejected adding a hosted consumer job because it interprets this as runner infrastructure, for which the user reserved approval. No rejected workflow edit was applied. This directory is a review artifact only and does not activate CI.

Exact reviewable changes:

- `.github/workflows/native-build.yml`: eight prebuilt targets (Linux glibc/musl ARM64/x64, macOS ARM64/x64, Windows ARM64/x64), at most four simultaneous jobs, each at most45minutes, plus one15minute assembly job. Each target uses an existing GitHub-hosted runner, verifies the same immutable source, runs native runtime smoke and uploads pinned artifacts.
- `proposals/native-build-ci.yml` here: candidate PR workflow calls that matrix and adds one Ubuntu24.04 job, at most30minutes, that verifies the exact assembled artifact ID/digest and runs existing strictness and packed-consumer gates with Rust required. Evidence uploaded14days.

Requested approval covers enabling and running these GitHub-hosted CI jobs by committing/pushing the feature PR. It does not authorize package publication, merges, AWS/CodeBuild changes, provisioning custom runners, or production deployment. Those existing approval boundaries remain.

Approval received from the user in this task: “Approve these native CI jobs”. The reviewed proposal can now be enabled and run. Continue local strictness, packed-consumer testing, identical-input benchmarks and production-mode app builds in parallel. Package publication, merges and AWS infrastructure changes still require separate approval.
