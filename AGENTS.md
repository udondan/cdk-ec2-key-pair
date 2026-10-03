# Agent Guidelines for cdk-ec2-key-pair

## Build/Test Commands

- **Build**: `make build` (uses jsii compiler)
- **Lint**: `make eslint`
- **Package**: `make package` (builds + runs jsii-pacmak for multi-language support)
- **Test (full)**: `cd test && make deploy && make DESTROY` (deploys to AWS and destroys)
- **Lambda build**: `lambda/build` (must run before jsii)

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
