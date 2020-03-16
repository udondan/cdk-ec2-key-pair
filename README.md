# CDK SSM Document

[![Source](https://img.shields.io/badge/Source-GitHub-blue)][source]
[![Docs](https://img.shields.io/badge/Docs-awscdk.io-orange)][docs]
[![npm version](https://badge.fury.io/js/cdk-ec2-key-pair.svg)][npm]
[![PyPI version](https://badge.fury.io/py/cdk-ec2-key-pair.svg)][PyPI]
[![NuGet version](https://badge.fury.io/nu/CDK.EC2.KeyPair.svg)][NuGet]
[![GitHub](https://img.shields.io/github/license/udondan/cdk-ec2-key-pair)][license]

[AWS CDK] L3 construct for managing [EC2 Key Pairs].

CloudFormation does not directly support creation of EC2 Key Pairs. This construct provides an easy interface for creating Key Pairs through a [custom CloudFormation resource]. The private key is stored in [AWS Secrets Manager].

## Usage

```typescript
import cdk = require('@aws-cdk/core');
import { KeyPair } from 'cdk-ec2-key-pair';

// Create the Private Key
const key = new KeyPair(this, 'A-Key-Pair', {
    name: 'a-key-pair',
    description: 'This is a Key Pair',
});

// Grant read access to a role or user
key.grantRead(someRole)
```

The private key will be stored in AWS Secrets Manager. The secret name is prefixed with `ec2-private-key/`, so in this example it will be saved as `ec2-private-key/a-key-pair`.

## Roadmap

- Automated Tests
- Tagging support in a more standard way

   [AWS CDK]: https://aws.amazon.com/cdk/
   [custom CloudFormation resource]: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-custom-resources.html
   [EC2 Key Pairs]: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-key-pairs.html
   [AWS Secrets Manager]: https://aws.amazon.com/secrets-manager/
   [npm]: https://www.npmjs.com/package/cdk-ec2-key-pair
   [PyPI]: https://pypi.org/project/cdk-ec2-key-pair/
   [NuGet]: https://www.nuget.org/packages/CDK.EC2.KeyPair/
   [docs]: https://awscdk.io/packages/cdk-ec2-key-pair@1.0.0
   [source]: https://github.com/udondan/cdk-ec2-key-pair
   [license]: https://github.com/udondan/cdk-ec2-key-pair/blob/master/LICENSE
