# THE RULE targets. Run inside WSL from the repo root.
.PHONY: vectors sandbox gas storage balance token-failure token-recovery b6 verify build-contracts build-referee
GAME_ACCOUNT ?= game-r2.therule.testnet
NEAR_RPC_URL ?= https://rpc.testnet.near.org
CONTRACTS_OUT ?= scratch/repro/contracts
export ROUND GAME_ACCOUNT NEAR_RPC_URL CONTRACTS_OUT
vectors:
	bash scripts/build/vectors.sh
# Sandbox tests use MOCK OutLayer contracts and are never testnet evidence.
sandbox:
	scripts/build/sandbox-artifacts.sh
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo test -p token -p game -p sandbox-tests --profile fast
gas:
	scripts/build/sandbox-artifacts.sh
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo run -p sandbox-tests --profile fast --example gas
storage:
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo run -p game --profile fast --example storage-bounds
	scripts/build/sandbox-artifacts.sh
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo run -p sandbox-tests --profile fast --example storage
balance:
	scripts/build/sandbox-artifacts.sh
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo run -p sandbox-tests --profile fast --example balance
token-failure:
	scripts/build/sandbox-artifacts.sh
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo run -p sandbox-tests --profile fast --example token-failure
token-recovery:
	scripts/build/sandbox-artifacts.sh
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo run -p sandbox-tests --profile fast --example token-recovery
# Local B6 evidence only; native NEAR unknown-outcome recovery remains a separate gate.
b6:
	scripts/build/sandbox-artifacts.sh
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo test --workspace --profile fast -- --test-threads=1
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo run -p sandbox-tests --profile fast --example token-recovery
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo run -p sandbox-tests --profile fast --example effect-gas
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo run -p sandbox-tests --profile fast --example multiround
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo run -p sandbox-tests --profile fast --example team-storage
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo run -p sandbox-tests --profile fast --example operator-storage
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo run -p sandbox-tests --profile fast --example storage
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo run -p sandbox-tests --profile fast --example balance
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo run -p sandbox-tests --profile fast --example gas
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} PROPTEST_CASES=10000 cargo test -p game --test invariants --test multiround --profile fast -- --test-threads=1
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo clippy --workspace --all-targets -- -D warnings
	cargo fmt --all --check
	python3 -B -m unittest discover -s scripts/deploy -p 'test_*.py' -v
verify:
	@case "$$ROUND" in solo/*|team/*) ;; *) echo "Usage: make verify ROUND=solo/<id> (or team/<id>)" >&2; exit 1;; esac
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo run -p verifier-cli --profile fast -- verify --network testnet --game "$$GAME_ACCOUNT" --mode "$${ROUND%%/*}" --round "$${ROUND#*/}" --rpc-url "$$NEAR_RPC_URL"
build-contracts:
	XDG_CONFIG_HOME=$${XDG_CONFIG_HOME:-$$HOME/.config-the-rule} CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} bash scripts/build/contracts-reproducible.sh "$$CONTRACTS_OUT"
build-referee:
	scripts/referee/build-reproducible.sh
