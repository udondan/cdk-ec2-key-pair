# Changelog

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
