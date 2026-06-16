SHELL := /bin/bash -euo pipefail

NO_COLOR=\x1b[0m
TARGET_COLOR=\x1b[96m

build:
	@echo -e "$(TARGET_COLOR)Running build$(NO_COLOR)"
	@npm run build

package: build
	@echo -e "$(TARGET_COLOR)Running package$(NO_COLOR)"
	@npm run package

clean:
	@echo -e "$(TARGET_COLOR)Running clean$(NO_COLOR)"
	@rm -rf node_modules package-lock.json

install:
	@echo -e "$(TARGET_COLOR)Running install$(NO_COLOR)"
	@npm clean-install --prefer-offline --cache .npm
	@npm list

eslint:
	@echo -e "$(TARGET_COLOR)Running eslint $$(npx eslint --version)$(NO_COLOR)"
	@npx eslint .; \
	echo "Passed"

validate-package:
	@echo -e "$(TARGET_COLOR)Checking package content$(NO_COLOR)"
	@\
	TARBALL=$$(npm pack --quiet 2>/dev/null); \
	CONTENTS=$$(tar -tf $$TARBALL); \
	echo "$$CONTENTS"; \
	rm $$TARBALL; \
	FILES_TO_CHECK="lambda/code.zip lib/index.d.ts lib/index.js lib/types.d.ts lib/types.js"; \
	MISSING_FILES=""; \
	for file in $$FILES_TO_CHECK; do \
		if ! printf "%s\n" "$$CONTENTS" | grep -q "^package/$$file$$"; then \
			MISSING_FILES="$$MISSING_FILES $$file"; \
		fi; \
	done; \
	if [ -n "$$MISSING_FILES" ]; then \
		echo "❌ The following files are NOT included in the package:$$MISSING_FILES"; \
		exit 1; \
	fi
