# THE RULE targets. Run inside WSL from the repo root.
.PHONY: vectors sandbox gas storage balance token-failure verify build-contracts build-referee
GAME_ACCOUNT ?= game-r1.therule.testnet
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
	scripts/build/sandbox-artifacts.sh
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo run -p sandbox-tests --profile fast --example storage
balance:
	scripts/build/sandbox-artifacts.sh
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo run -p sandbox-tests --profile fast --example balance
token-failure:
	scripts/build/sandbox-artifacts.sh
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo run -p sandbox-tests --profile fast --example token-failure
verify:
	@case "$$ROUND" in solo/*|team/*) ;; *) echo "Usage: make verify ROUND=solo/<id> (or team/<id>)" >&2; exit 1;; esac
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo run -p verifier-cli --profile fast -- verify --network testnet --game "$$GAME_ACCOUNT" --mode "$${ROUND%%/*}" --round "$${ROUND#*/}" --rpc-url "$$NEAR_RPC_URL"
build-contracts:
	XDG_CONFIG_HOME=$${XDG_CONFIG_HOME:-$$HOME/.config-the-rule} CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} bash scripts/build/contracts-reproducible.sh "$$CONTRACTS_OUT"
build-referee:
	scripts/referee/build-reproducible.sh
