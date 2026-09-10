# Corrected Turbo candidate timing checkpoint

Immutable Turbo `911339ca7ac0df9cc37acf2201898ac55505291f`, library `37a8628f66cd793330db2d5a163287f8454182a8`, candidate artifact10159503087. Full acceptance run[34506410455](https://github.com/openmirai/fe-mirai-org-turbo/actions/runs/34506410455) succeeds. This is one sequential candidate acceptance job, not the ordinary CI DAG and not an A/B speedup distribution.

| CI step | Seconds |
| --- | ---: |
| Set up job | 3 |
| Run actions/checkout@v6 | 3 |
| Run actions/setup-node@v6 | 4 |
| Run pnpm/setup@v2.1.0 | 2 |
| Install locked verifier tools without saving a dependency cache | 17 |
| Pin reviewed library producer and candidate artifact | 1 |
| Recheck producer after artifact download | 1 |
| Verify and prepare exact candidate package inputs | 1 |
| Install candidate without Rust compilation | 12 |
| Authorize all five catalogs and export authority | 84 |
| Verify unchanged reuse skips audit and regeneration | 42 |
| Verify authority import for downstream consumption | 42 |
| Run candidate source quality and runtime contracts | 124 |
| Run every application test suite with candidate packages | 1234 |
| Build all four apps in production mode and finalize proofs | 750 |
| Verify locale source and artifact strictness in the actual consumer | 132 |
| Verify all four version-only regeneration regressions | 118 |
| Upload acceptance and final artifact evidence | 1 |
| Post Run actions/checkout@v6 | 1 |

Job wall time: 2574seconds (42m54s). Run creation to job start: 23seconds. Whole-second GitHub timestamps cannot resolve exclusive internal phase costs or subsecond transfer overhead. Setup includes runner/action preparation and separate candidate installation; measured paired preparation samples exclude those startup/install steps.

The workflow runs complete app tests at task concurrency1 and all four production builds sequentially to validate the same pinned package without exhausting existing runner memory. Ordinary Quality/Tests and app fanout use a different DAG, so neither2574seconds nor the preparation3.26% gain can be called an ordinary CI end-to-end speedup. The actual ordinary critical path must be collected after approved publication/adoption.

The run retains all17 restored strictness cases, four version-only regressions, five-catalog zero-work verification and eight finalized app/target proofs. Full emitted application bundles are not in this evidence archive; the retained finalized proof objects are actual CI outputs, not an independent replay of every emitted file.

Raw full archive is private Turbo `docs/plans/intl-native-ci/evidence/turbo-ci-34506410455.zip`; its digest and verified metadata are in the adjacent JSON summary. It includes private recovery backups and must not be copied into the public library.
