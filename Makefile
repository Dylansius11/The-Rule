# THE RULE targets. Run inside WSL from the repo root. Unfinished targets fail loudly.
.PHONY: vectors sandbox gas storage verify build-contracts build-referee
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
verify:
	$(NOT_IMPLEMENTED)
build-contracts:
	$(NOT_IMPLEMENTED)
build-referee:
	scripts/referee/build-reproducible.sh
