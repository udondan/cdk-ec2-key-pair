# Changelog

## [Unreleased]

### Bug Fixes

* remove explicit IKeyPair interface implementation to fix .NET compilation with CDK 2.237.x+ ([#1334](https://github.com/udondan/cdk-ec2-key-pair/issues/1334))
  - Maintains full structural compatibility with IKeyPair
  - Fixes .NET compilation error: "Interfaces namespace not found"
  - Defines KeyPairReference interface inline to avoid aws-cdk-lib/interfaces dependency
  - Works across CDK versions 2.219.0+

## [5.0.0](https://github.com/udondan/cdk-ec2-key-pair/compare/v4.1.0...v5.0.0) (2025-10-24)


### ⚠ BREAKING CHANGES

* The properties `privateKeyArn` and `publicKeyArn` have been removed. Use `privateKeySecret.secretArn` and `publicKeySecret?.secretArn` instead. The methods `grantReadOnPrivateKey()` and `grantReadOnPublicKey()` have been removed. Use `privateKeySecret.grantRead()` and `publicKeySecret?.grantRead()` instead.

### Features

* expose secrets as ISecret instead of ARN strings ([#1247](https://github.com/udondan/cdk-ec2-key-pair/issues/1247)) ([a489529](https://github.com/udondan/cdk-ec2-key-pair/commit/a489529eee6d0f1b2165ccb91dd8b7b18b4c9ef5))

## [4.1.0](https://github.com/udondan/cdk-ec2-key-pair/compare/v4.0.1...v4.1.0) (2025-10-23)


### Features

* update lambda runtime to Node.js 22 ([#1243](https://github.com/udondan/cdk-ec2-key-pair/issues/1243)) ([79d828c](https://github.com/udondan/cdk-ec2-key-pair/commit/79d828c12a588e455386f5c64d6aa6ea55ecc4cd))


### Bug Fixes

* add keyPairRef property to satisfy IKeyPair interface in CDK 2.219.0+ ([#1240](https://github.com/udondan/cdk-ec2-key-pair/issues/1240)) ([3f36420](https://github.com/udondan/cdk-ec2-key-pair/commit/3f36420cc541e28aeb05379d2be35ba6a6ab251b))

## [4.0.1](https://github.com/udondan/cdk-ec2-key-pair/compare/v4.0.0...v4.0.1) (2024-03-25)


### Bug Fixes

* ensure all expected files are included in the resulting package ([#300](https://github.com/udondan/cdk-ec2-key-pair/issues/300)) ([509e42c](https://github.com/udondan/cdk-ec2-key-pair/commit/509e42c4fb9fd3d1667babffd11c3bfce0761b75))

## [4.0.0](https://github.com/udondan/cdk-ec2-key-pair/compare/v3.3.3...v4.0.0) (2024-03-23)


### ⚠ BREAKING CHANGES

* adds support for ED25519 Key Pairs and a wide range of public key formats ([#290](https://github.com/udondan/cdk-ec2-key-pair/issues/290))
* implements IKeyPair interface ([#279](https://github.com/udondan/cdk-ec2-key-pair/issues/279))
* renames lambda property to lambdaFunction ([#277](https://github.com/udondan/cdk-ec2-key-pair/issues/277))
* for consistency, the property name now is renamed to keyPairName ([#258](https://github.com/udondan/cdk-ec2-key-pair/issues/258))
* removes fixed name from lambda function ([#253](https://github.com/udondan/cdk-ec2-key-pair/issues/253))

### Features

* adds fingerprint and public key format as resource properties ([#291](https://github.com/udondan/cdk-ec2-key-pair/issues/291)) ([046e41d](https://github.com/udondan/cdk-ec2-key-pair/commit/046e41da8dd3b55f52f86f665b8857236373bc50))
* adds logLevel option, so users can debug lambda functions ([#286](https://github.com/udondan/cdk-ec2-key-pair/issues/286)) ([6f28d82](https://github.com/udondan/cdk-ec2-key-pair/commit/6f28d8224f1c2810d869c3bf2069a62bf4a6adcb))
* adds support for ED25519 Key Pairs and a wide range of public key formats ([#290](https://github.com/udondan/cdk-ec2-key-pair/issues/290)) ([35ece30](https://github.com/udondan/cdk-ec2-key-pair/commit/35ece30b405ce0d4e39980c328c2308b6218c70e))
* for consistency, the property name now is renamed to keyPairName ([#258](https://github.com/udondan/cdk-ec2-key-pair/issues/258)) ([a39e251](https://github.com/udondan/cdk-ec2-key-pair/commit/a39e2519d1c4b8e4de510f913e9d8464cdb2a480))
* implements IKeyPair interface ([#279](https://github.com/udondan/cdk-ec2-key-pair/issues/279)) ([0457985](https://github.com/udondan/cdk-ec2-key-pair/commit/045798526a71587640fc1e52156a79cc49ddff16))
* removes fixed name from lambda function ([#253](https://github.com/udondan/cdk-ec2-key-pair/issues/253)) ([56e17ef](https://github.com/udondan/cdk-ec2-key-pair/commit/56e17ef736dd174a1732745d484f1bd06731b13a))


### Miscellaneous Chores

* renames lambda property to lambdaFunction ([#277](https://github.com/udondan/cdk-ec2-key-pair/issues/277)) ([e43879a](https://github.com/udondan/cdk-ec2-key-pair/commit/e43879a83595ae9c3d1fa4aa9a64baecd9250af4))
