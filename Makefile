SHELL := /bin/bash
VERSION := $(shell cat VERSION)

build:
	@npm run build

package: build
	@npm run package

clean:
	@rm -rf node_modules package-lock.json

install: clean
	@npm i

test: build
	npm run test

test-update:
	npm run test -- -u

tag:
	@git tag -a "v$(VERSION)" -m 'Creates tag "v$(VERSION)"'
	@git push --tags

untag:
	@git push --delete origin "v$(VERSION)"
	@git tag --delete "v$(VERSION)"

release: tag

re-release: untag tag
