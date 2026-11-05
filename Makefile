# THE RULE targets. Run inside WSL from the repo root. Unfinished targets fail loudly.
.PHONY: vectors sandbox gas storage balance verify build-contracts build-referee
GAME_ACCOUNT ?= game-r1.therule.testnet
NEAR_RPC_URL ?= https://rpc.testnet.near.org
export ROUND GAME_ACCOUNT NEAR_RPC_URL
define NOT_IMPLEMENTED
	@echo "make $@: not implemented (see docs/BUILD-PLAN.md)"; exit 1
endef
vectors:
	$(NOT_IMPLEMENTED)
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
verify:
	@case "$$ROUND" in solo/*|team/*) ;; *) echo "Usage: make verify ROUND=solo/<id> (or team/<id>)" >&2; exit 1;; esac
	CARGO_TARGET_DIR=$${CARGO_TARGET_DIR:-$$HOME/target-the-rule} cargo run -p verifier-cli --profile fast -- verify --network testnet --game "$$GAME_ACCOUNT" --mode "$${ROUND%%/*}" --round "$${ROUND#*/}" --rpc-url "$$NEAR_RPC_URL"
build-contracts:
	$(NOT_IMPLEMENTED)
build-referee:
	scripts/referee/build-reproducible.sh
