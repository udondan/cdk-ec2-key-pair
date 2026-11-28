# Agent Guidelines for cdk-ec2-key-pair

## Build/Test Commands

Bun is the package manager. Node, Bun and the workflow linters are pinned only in `mise.toml`; the workflows install them with `jdx/mise-action`. Node still runs jsii, vitest, the CDK CLI and the Lambda, and npm is only used for `npm pack` (`make validate-package`, jsii-pacmak) and `npm publish`.

- **Install**: `make install` (`bun install --frozen-lockfile`). The root package and the CDK app in `test/` (a Bun workspace) share the root `bun.lock`. `make install-root` installs only the root package's dependencies (`--filter`), which is enough for the unit tests
- **Build**: `make build` (uses jsii compiler)
- **Lint**: `make eslint`
- **Package**: `make package` (builds + runs jsii-pacmak for multi-language support)
- **Unit tests**: `make test` (vitest with coverage, tests in `tests/`). Coverage of `lib/` and `lambda/` must stay at 100 %; vitest and Codecov both fail below that.
- **Test (full)**: `cd test && make deploy && make DESTROY` (deploys to AWS and destroys)
- **Lambda build**: `lambda/build` (must run before jsii). `lambda/` is not a workspace: it has its own `bun.lock`, and `lambda/build` installs its dependencies hoisted into `lambda/node_modules` and zips them with the compiled code into `lambda/code.zip`, which ships in the package. It uses `tsc` from the root, so run `make install` first
- **Test app**: `test/cdk.json` runs the CDK app with `bun bin/test.ts`, no ts-node
- **CI** (`.github/workflows/test.yml`): every job waits for boarding-gate (job name `Queue`) and fails if it failed. On pull requests, `Unit tests` only runs if the `changes` job (`dorny/paths-filter`) found a changed code or build file, and the AWS deploy test (`test`) only runs if the unit tests passed. When the code or the deployment starts depending on another file, add it to that filter, or the tests silently skip

## Code Style

- **TypeScript**: Strict mode enabled (noImplicitAny, strictNullChecks, noUnusedLocals, noUnusedParameters)
- **Formatting**: Prettier with single quotes (singleQuote: true)
- **Naming**: Use @typescript-eslint/naming-convention rules, prefer template literals (prefer-template)
- **Unused vars**: Prefix with underscore (`_variable`) to ignore
- **Imports**: Group by external (aws-cdk-lib, constructs) then local, use named imports
- **Types**: Always explicit return types for public methods, use strict typing
- **Comments**: JSDoc for all public APIs with @default for optional parameters
- **Error handling**: Use Annotations.of(this).addError() for validation errors in constructs

## Git Workflow

- Conventional commits required (feat:, fix:, refactor:, etc.)
