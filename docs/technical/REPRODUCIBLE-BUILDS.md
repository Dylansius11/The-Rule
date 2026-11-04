# Reproducible builds

Status 2026-11-04: the referee was built twice in fresh containers **on this one machine**, from two copies of the same working-tree snapshot. This is not evidence of reproducibility across machines or of equivalence to a committed revision. The token reproducible dry run and hosting remain blocked below. Repeat these checks on the frozen, committed sources before P6.4 and preserve the final artifacts and source revision.

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

## Artifact hosting

`scripts/referee/publish.sh FILE.wasm` prints SHA-256 and size and rejects files of 10 MiB or more. Optionally add `--verify-url https://...` to fetch the URL with HTTPS-only redirects (at most three) and check its hash. It never uploads. A matching local fetch does not prove availability to the deployed OutLayer worker. OutLayer requires public HTTPS on port 443, at most three redirects and a maximum of 10 MiB, and checks the supplied hash.

- FastFS testnet: the earlier uploaded probe returned HTTP 404; cause unknown.
- Cloudflare quick tunnel: temporary, only while the local tunnel process runs; used for the probe, not durable hosting.
- Commit-pinned GitHub raw or release asset: candidate only; requires the public repository and appropriate founder authorization. D28 remains open, and D22 currently delays a remote until P8.6.

No upload or URL verification for this referee was performed. P2.2 remains open until the chosen hosting and both matching URLs are exercised. Older INTEGRATIONS and BUILD-PLAN text describes automatic FastFS upload and a GitHub mirror; it conflicts with D28's current blocked status and this no-upload helper.

## Token contract dry run

The intended pinned contract builder is `sourcescan/cargo-near:0.22.0-rust-1.97.1@sha256:7467038bdddc86484b73b416eeadce926ff59013e128e53dec5a19e1cb4b2234` (Docker Hub digest checked 2026-11-04). Token manifest metadata specifies the image and a locked container build with `--no-abi`; cargo-near's help lists `--no-abi` for `non-reproducible-wasm`, the inner command. Whether this configuration successfully builds the token reproducibly remains unverified.

`cargo near build reproducible-wasm --manifest-path contracts/token/Cargo.toml` clones committed Git sources, unlike a non-reproducible local build, and embeds reproducible-build metadata. On the observed HEAD it failed before Docker: `Cargo.lock is absent or not up-to-date` because the committed workspace lockfile did not cover that committed workspace. The current working tree has a different lockfile. WSL Docker integration is disabled: `docker version` in WSL reports that Docker could not be found and recommends enabling WSL integration; the Windows Docker CLI can reach the running engine, but cargo-near invokes Docker inside WSL. Neither two token hashes nor a byte comparison against a non-reproducible build was obtained.

The local comparison command `cargo near build non-reproducible-wasm --locked --no-abi --manifest-path contracts/token/Cargo.toml --out-dir scratch/repro/token-local` succeeded on the working tree: 194,542 bytes, SHA-256 `84a1a8d94dd020d04f7b2c7822b2a13b87a11d91c920514464bd3dfdde3bbe9b`. This demonstrates `--no-abi` on the local build only; it does not establish that cargo-near's reproducible flow accepts that inner command or that its output differs.

After the lead commits a coherent workspace lockfile and the token metadata, and enables a usable WSL Docker client/engine, run twice from that same clean commit:

```sh
export CARGO_TARGET_DIR="$HOME/target-the-rule-repro" CARGO_BUILD_JOBS=2
export XDG_CONFIG_HOME="$HOME/.config-the-rule"
bash scripts/build/token-reproducible.sh scratch/repro/token-1
bash scripts/build/token-reproducible.sh scratch/repro/token-2
sha256sum scratch/repro/token-{1,2}/token.wasm
```

Compare hashes and inspect the resulting metadata and ABI behavior against a separately built local non-reproducible token. Do not deploy these dry-run bytes. The lead owns committing the workspace lockfile and resolving WSL integration; no Docker settings were changed here.
