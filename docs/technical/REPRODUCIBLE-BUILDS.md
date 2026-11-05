# Reproducible builds

Status 2026-11-05: game, token and the caller-bound referee were each built twice in fresh containers on this machine from committed source `ba3d23f0a50784e66a1a62476a35db8aee71502b`. Each independent pair matched byte-for-byte. Actual game/token NEP-330 views matched that revision and pinned recipe; the exact referee passed component/import/manifest checks. This is local reproducibility evidence, not cross-machine evidence, hosted-byte verification, a testnet deployment or a freeze. Repeat on the final frozen revision before P6.4.

## Referee

The `linux/amd64` builder is `rust:1.97.1@sha256:4277ce860337f6cfa1b679891bbf689a447f4b3f4f55701742614ad31321cee7`. Docker Hub returned that amd64 digest for the 1.97.1 index on 2026-11-04; OutLayer's compiler Dockerfile also pins it. The script installs the `wasm32-wasip2` target in each fresh container, uses `--locked`, `SOURCE_DATE_EPOCH=0`, fixed path remapping and a fresh Cargo home and target directory. No build cache or demo feature is used. The account is embedded in the OutLayer manifest, so a different caller changes the bytes and the bound key.

Example from the repository root in WSL, using a stable workspace snapshot (do not include secrets, `.git`, build outputs or `scratch`):

```sh
mkdir -p scratch/repro/src-1 scratch/repro/src-2
tar --exclude=target --exclude=.git --exclude=scratch --exclude=node_modules \
    --exclude=.env --exclude='.env.*' -cf - Cargo.toml Cargo.lock rust-toolchain.toml \
    crates contracts enclave verifier tests | tar -xf - -C scratch/repro/src-1
cp -a scratch/repro/src-1/. scratch/repro/src-2/
export RULE_GAME_ACCOUNT=game-r1.therule.testnet
bash scripts/referee/build-reproducible.sh scratch/repro/src-1 scratch/repro/referee-1.wasm
bash scripts/referee/build-reproducible.sh scratch/repro/src-2 scratch/repro/referee-2.wasm
sha256sum scratch/repro/referee-{1,2}.wasm
bash scripts/referee/publish.sh scratch/repro/referee-1.wasm
```

The snapshot must contain a current `Cargo.lock`; the build fails rather than updating it. For this run it was copied from the working tree, not generated in the container; its SHA-256 was `e43719f0dc56ca142c4ae683c994654375d49391fb7bb75b067b77ffc8efd5c0`. Both builds produced 320,737 bytes with SHA-256 `77264b2577a4e9ad52c0b4e174c2783057b30ff127deb8c1121ff770cb62fe63`. The embedded manifest names `game-r1.therule.testnet`. The snapshot includes uncommitted workspace changes and is not a production freeze artifact.

`scripts/referee/audit-imports.sh` rebuilds its own production and demo binaries; it does **not** accept a prebuilt artifact. Run it on an isolated copy of the same snapshot with `RULE_GAME_ACCOUNT`, a WSL-local `CARGO_TARGET_DIR`, and `wasm-tools` 1.240.0 on `PATH`. Compare `wasm-tools component wit scratch/repro/referee-1.wasm` with that audit's `enclave/referee/IMPORTS.txt`, and check the container artifact for `RULE_DEMO` separately. This distinction matters: an audit of a different local build alone would not audit the published bytes.

Observed on the isolated snapshot: the existing script reported `PASS: OutLayer MAC present; no network or filesystem imports; hashes differ`. Its local production hash was `41cfc738d16d76ffd6643632507929c18c8a377c0b40eaaf9536f12b49b39d08`, not the container hash; its demo hash was `2702439a243ca14e6adf5d6210e505d85f3c31483149901c9e7e0bd4d09ba258`. The container artifact's extracted WIT matched the audited imports byte-for-byte and contained no `RULE_DEMO` string. The string check is not a proof of no environment access.

### Current committed-source referee evidence

On 2026-11-05, `git archive` of source `ba3d23f0a50784e66a1a62476a35db8aee71502b` supplied the workspace snapshot; its `Cargo.lock` SHA-256 was `0ef89e150fadbe8d55f03ee95248dd9ee8182889cc9dcc0894263af8a94317d3`. Two fresh pinned containers built non-demo `game-r1.therule.testnet` referee bytes identically. The resulting 228,161-byte component hash is recorded in the table below. Do not reuse the earlier uncommitted-snapshot artifact/hash above.

Pinned `wasm-tools` 1.240.0 validated the exact component. Its extracted WIT matched committed `enclave/referee/IMPORTS.txt`; the MAC import was present and no socket/HTTP/filesystem import appeared. The actual `outlayer.manifest` custom section matched the caller-bound template, and no `RULE_DEMO` string appeared. These checks do not prove secret retention or absence of all environment access, and the artifact has not run on real OutLayer.

The restored Linux audit-tool release archive matched SHA-256 `b6ad301b8ac65e283703d1a5cf79280058a5f5699f8ff1fcaf66dbcf80a9efae` from [the official 1.240.0 release](https://github.com/bytecodealliance/wasm-tools/releases/tag/v1.240.0). It was extracted only into gitignored `scratch/tools/`; the archive was removed.

## Artifact hosting

`scripts/referee/publish.sh FILE.wasm` prints SHA-256 and size and rejects files of 10 MiB or more. Optionally add `--verify-url https://...` to fetch the URL with HTTPS-only redirects (at most three) and check its hash. It never uploads. A matching local fetch does not prove availability to the deployed OutLayer worker. OutLayer requires public HTTPS on port 443, at most three redirects and a maximum of 10 MiB, and checks the supplied hash.

- FastFS testnet: the earlier uploaded probe returned HTTP 404; cause unknown.
- Cloudflare quick tunnel: temporary, only while the local tunnel process runs; used for the probe, not durable hosting.
- Commit-pinned GitHub raw or release asset: candidate only; the founder authorized the source remote/push on 2026-11-05 (D22), but GitHub reported the repository PRIVATE. A public referee endpoint and asset publication still require authorization and verification (D28); source push alone does not host the wasm.

No upload or URL verification for this referee was performed. P2.2 remains open until the chosen hosting and both matching URLs are exercised. Older INTEGRATIONS and BUILD-PLAN text describes automatic FastFS upload and a GitHub mirror; it conflicts with D28's current blocked status and this no-upload helper.

## Contract build entrypoint and dry-run limits

The pinned contract builder is `sourcescan/cargo-near:0.22.0-rust-1.97.1@sha256:7467038bdddc86484b73b416eeadce926ff59013e128e53dec5a19e1cb4b2234` (Docker Hub digest checked 2026-11-04). Both game and token manifests specify the same image, locked container build and `--no-abi`. The game metadata follows the existing token convention and [cargo-near template](https://github.com/near/cargo-near/blob/main/cargo-near/src/commands/new/new-project-template/Cargo.template.toml). `cargo metadata --locked --no-deps --format-version 1` accepted the updated workspace locally. This validates manifest/dependency shape, not successful reproducible builds.

`cargo near build reproducible-wasm` clones committed Git sources, unlike a non-reproducible local build, and embeds reproducible-build metadata. On 2026-11-04's then-committed sources, token build failed before Docker because the committed lockfile was stale. That historical failure is not a current-lockfile diagnosis. The earlier WSL Docker integration check also failed. No pair of reproducible contract hashes was obtained.

The local comparison command `cargo near build non-reproducible-wasm --locked --no-abi --manifest-path contracts/token/Cargo.toml --out-dir scratch/repro/token-local` succeeded on the working tree: 194,542 bytes, SHA-256 `84a1a8d94dd020d04f7b2c7822b2a13b87a11d91c920514464bd3dfdde3bbe9b`. This demonstrates `--no-abi` on the local build only; it does not establish that cargo-near's reproducible flow accepts that inner command or that its output differs.

`make build-contracts` now invokes `scripts/build/contracts-reproducible.sh` for both contracts, with isolated config/cache defaults and a `CONTRACTS_OUT` output root. The wrapper checks Docker before creating output, reports the committed source revision, invokes only `cargo near build reproducible-wasm`, and prints each successful artifact hash under `<output>/<game|token>/<game|token>.wasm`. It never signs, deploys or falls back to non-reproducible bytes. A later contract failure may leave the earlier successful contract artifact; absence of the second hash is not a complete build.

Observed 2026-11-05: WSL `docker info` still reports unavailable integration; Windows `docker.exe info` cannot open `dockerDesktopLinuxEngine`, and engine enumeration cannot open `dockerBackendApiServer`. `docker.exe desktop start` reports already running, so that did not repair the backend. The actual make entrypoint fails nonzero on the Docker prerequisite; no reproducible artifact is claimed. Restarting Desktop could interrupt another project's containers, so owner approval is required before doing that. No Docker settings were changed.

Later on 2026-11-05, after the founder enabled the engine, Windows and WSL `docker info` both reached Docker Desktop 28.5.1. The actual `make build-contracts` passed that prerequisite and failed NEP-330 validation: `[package.repository]: should not be empty`. Both contract packages now inherit the planned D22 HTTPS repository identifier from the workspace. This is build metadata, not an added remote or evidence that the revision is publicly retrievable. The requirement follows [cargo-near validation](https://github.com/near/cargo-near/blob/main/cargo-near-build/src/types/near/docker_build/metadata/validate.rs) and [NEP-330](https://github.com/near/NEPs/blob/master/neps/nep-0330.md). A successful manifest check alone does not accept a reproducible build.

The first Docker-completed invocation at source `a33034f4a1dbf5abbe9c14a24533479d767dc0ac` is **rejected as provenance evidence**: its container reported game hash `d60bb2f548fa437a32cd2be6c8596144f830800c40a37d06d847321042bae5a4`, but the host output was the old local `af8d7ae7d01aa091826f41d268197ae1b512a1a6f5babe4237d0d2936b4d916b`. The token output was also the old local artifact. An actual sandbox call to that game's `contract_source_metadata` returned null `build_info` and failed the requested-revision check. The wrapper now removes the inherited host `CARGO_TARGET_DIR` only for the reproducible command, preventing that host-cache selection. Pairwise equality alone is insufficient: exercise the returned NEP-330 metadata against the requested revision, image and contract path.

The artifact provenance executable is `cargo run -p sandbox-tests --profile fast --example provenance`. Set `GAME_WASM`, `TOKEN_WASM` to the reproducible pair and `EXPECTED_SOURCE_REV` to the full committed source id. It deploys only to an isolated local sandbox and calls the actual metadata views without initialization. The stale-artifact run failed as expected; after isolating the target environment, both real metadata views passed at source `a33034f4a1dbf5abbe9c14a24533479d767dc0ac`, including exact image, source, contract paths and locked no-ABI command. This verifies artifact selection, not a two-build comparison, a contract freeze, testnet behavior or public source availability.

For a future clean committed revision, run twice:

```sh
export CARGO_TARGET_DIR="$HOME/target-the-rule-repro" CARGO_BUILD_JOBS=2
export XDG_CONFIG_HOME="$HOME/.config-the-rule"
make build-contracts CONTRACTS_OUT=scratch/repro/contracts-1
make build-contracts CONTRACTS_OUT=scratch/repro/contracts-2
sha256sum scratch/repro/contracts-{1,2}/game/game.wasm
sha256sum scratch/repro/contracts-{1,2}/token/token.wasm
```

Compare both pairs and exercise the actual metadata/ABI and changed runtime paths. Do not deploy dry-run bytes or call the contracts frozen. B7's Docker access is resolved; P2.2/P6.4 still require hosted bytes and final-revision acceptance.

### Observed committed-source artifact pairs (2026-11-05)

All rows use source `ba3d23f0a50784e66a1a62476a35db8aee71502b`. Both contracts were built through the actual make entrypoint with the host target override removed. `cmp` passed for each independent pair; actual sandbox metadata views matched the source, image, contract paths and exact locked no-ABI command.

| Artifact | Bytes | SHA-256 (both builds) |
| --- | --- | --- |
| Game | 429,484 | `27d728d53a097d77c52f12991c8fb6e507868db543c05e213495f117fae57e08` |
| Token | 167,389 | `06c898a8c917fd233aa40d2fc669961f14aa21167a7c5e89601ee2848bcdd1e0` |
| Referee (`game-r1.therule.testnet`) | 228,161 | `67ca482631d80efc80ef12d230ebf51f813326c9d54984ccbdc4f2de72749c60` |

Both reproducible contract artifacts also passed their existing ABI export allowlists. The five added admission/play sandbox runtimes were then exercised again against this exact reproducible pair: saturation/lifecycle/retry, settled duplicate, five verdict failure shapes, delayed YES after freeze, low compute and private-callback rejection all passed. Those runtimes still use MOCK OutLayer, not a deployed TEE referee.

Artifacts live in gitignored `scratch/repro/admission-{1,2}/` and `scratch/repro/referee-committed-{1,2}.wasm`. During that build run, no bytes were uploaded, no remote was added, and no testnet transaction was signed. The founder subsequently authorized the private source remote/push (D22), not referee asset publication or deployment. The repository identifier in metadata does not mean that revision is publicly retrievable. Contract changes or another frozen revision require rebuilding and rechecking.
