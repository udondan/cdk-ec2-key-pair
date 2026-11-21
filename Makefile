SHELL := /bin/bash -euo pipefail

NO_COLOR=\x1b[0m
TARGET_COLOR=\x1b[96m

build:
	@echo -e "$(TARGET_COLOR)Running build$(NO_COLOR)"
	@bun run build

package: build
	@echo -e "$(TARGET_COLOR)Running package$(NO_COLOR)"
	@bun run package

clean:
	@echo -e "$(TARGET_COLOR)Running clean$(NO_COLOR)"
	@rm -rf node_modules test/node_modules lambda/node_modules

# The root package and the CDK app in test/ (a Bun workspace) share one bun.lock.
install:
	@echo -e "$(TARGET_COLOR)Running install$(NO_COLOR)"
	@bun install --frozen-lockfile

# Only the root package's dependencies, without the CDK app in test/.
# Enough for the unit tests.
install-root:
	@echo -e "$(TARGET_COLOR)Running install-root$(NO_COLOR)"
	@bun install --frozen-lockfile --filter cdk-ec2-key-pair

# A directory named test exists, so make must not treat the target as a file.
.PHONY: test
test:
	@echo -e "$(TARGET_COLOR)Running unit tests$(NO_COLOR)"
	@bun run test:coverage

eslint:
	@echo -e "$(TARGET_COLOR)Running eslint $$(bunx eslint --version)$(NO_COLOR)"
	@bunx eslint .; \
	echo "Passed"

validate-package:
	@echo -e "$(TARGET_COLOR)Checking package content$(NO_COLOR)"
	@\
	if ! TARBALL=$$(npm pack --quiet) || [ -z "$$TARBALL" ]; then \
		echo "❌ npm pack failed"; \
		exit 1; \
	fi; \
	TARBALL=$$(printf '%s\n' "$$TARBALL" | tail -n 1); \
	if [ ! -f "$$TARBALL" ]; then \
		echo "❌ npm pack package file not found: $$TARBALL"; \
		exit 1; \
	fi; \
	trap 'rm -f "$$TARBALL"' EXIT; \
	if ! tar -tf "$$TARBALL" >/dev/null; then \
		echo "❌ Failed to list tarball contents"; \
		exit 1; \
	fi; \
	FILES_TO_CHECK="lambda/code.zip lib/index.d.ts lib/index.js lib/types.d.ts lib/types.js"; \
	MISSING_FILES=""; \
	for file in $$FILES_TO_CHECK; do \
		if ! tar -tf "$$TARBALL" "package/$$file" >/dev/null 2>&1; then \
			MISSING_FILES="$$MISSING_FILES $$file"; \
		fi; \
	done; \
	if [ -n "$$MISSING_FILES" ]; then \
		echo "❌ The following files are NOT included in the package:$$MISSING_FILES"; \
		exit 1; \
	fi
