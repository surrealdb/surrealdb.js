.PHONY: default
default:
	@echo "Choose a Makefile target:"
	@$(MAKE) -pRrq -f $(lastword $(MAKEFILE_LIST)) : 2>/dev/null | awk -v RS= -F: '/^# File/,/^# Finished Make data base/ {if ($$1 !~ "^[#.]") {print "  - " $$1}}' | sort

.PHONY: setup
setup:
	cargo update
	cargo upgrade --pinned

.PHONY: check
check:
	cargo check
	cargo fmt --all -- --check
	cargo clippy -- -W warnings

.PHONY: test
test:
	wasm-pack test --node

.PHONY: clean
clean:
	cargo clean
	rm -rf compiled/ dist/ target/ lib/

.PHONY: serve
serve:
	pnpm run build
	pnpm run serve

.PHONY: build
build:
	pnpm run build
