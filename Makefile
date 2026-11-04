# THE RULE targets. Each prints "not implemented" until its BUILD-PLAN task lands.
.PHONY: vectors sandbox verify build-contracts build-referee
define NOT_IMPLEMENTED
	@echo "make $@: not implemented (see docs/BUILD-PLAN.md)"; exit 1
endef
vectors:
	$(NOT_IMPLEMENTED)
sandbox:
	$(NOT_IMPLEMENTED)
verify:
	$(NOT_IMPLEMENTED)
build-contracts:
	$(NOT_IMPLEMENTED)
build-referee:
	$(NOT_IMPLEMENTED)
