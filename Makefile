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

test: build
	@echo -e "$(TARGET_COLOR)Running test$(NO_COLOR)"
	@npm run test

test-update:
	@echo -e "$(TARGET_COLOR)Running test-update$(NO_COLOR)"
	@npm run test -- -u
