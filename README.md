# CDK EC2 Key Pair

[![Source](https://img.shields.io/badge/Source-GitHub-blue?logo=github)][source]
[![Test](https://github.com/udondan/cdk-ec2-key-pair/workflows/Test/badge.svg)](https://github.com/udondan/cdk-ec2-key-pair/actions?query=workflow%3ATest)
[![GitHub](https://img.shields.io/github/license/udondan/cdk-ec2-key-pair)][license]
[![Docs](https://img.shields.io/badge/Construct%20Hub-cdk--ec2--key--pair-orange)][docs]

[![npm package](https://img.shields.io/npm/v/cdk-ec2-key-pair?color=brightgreen)][npm]
[![PyPI package](https://img.shields.io/pypi/v/cdk-ec2-key-pair?color=brightgreen)][PyPI]

![Downloads](https://img.shields.io/badge/-DOWNLOADS:-brightgreen?color=gray)
[![npm](https://img.shields.io/npm/dt/cdk-ec2-key-pair?label=npm&color=blueviolet)][npm]
[![PyPI](https://img.shields.io/pypi/dm/cdk-ec2-key-pair?label=pypi&color=blueviolet)][PyPI]

[AWS CDK] L3 construct for managing [EC2 Key Pairs].

CloudFormation doesn't directly support creation of EC2 Key Pairs. This construct provides an easy interface for creating Key Pairs through a [custom CloudFormation resource]. The private key is stored in [AWS Secrets Manager].

## Installation

This package has peer dependencies, which need to be installed along in the expected version.

For TypeScript/NodeJS, add these to your `dependencies` in `package.json`. For Python, add these to your `requirements.txt`:

- cdk-ec2-key-pair
- aws-cdk-lib (^2.0.0)
- cdk-iam-floyd (^0.300.0)
- constructs (^10.0.0)

## CDK compatibility

- Version 3.x is compatible with the CDK v2.
- Version 2.x is compatible with the CDK v1. There won't be regular updates for this.

## Usage

```typescript
import cdk = require('aws-cdk-lib');
import { Construct } from 'constructs';
import { KeyPair } from 'cdk-ec2-key-pair';

// ...

// Create the Key Pair
const key = new KeyPair(this, 'A-Key-Pair', {
    name: 'a-key-pair',
    description: 'This is a Key Pair',
    storePublicKey: true, // by default the public key will not be stored in Secrets Manager
});

// Grant read access to the private key to a role or user
key.grantReadOnPrivateKey(someRole)

// Grant read access to the public key to another role or user
key.grantReadOnPublicKey(anotherRole)

// Use Key Pair on an EC2 instance
new ec2.Instance(this, 'An-Instance', {
    keyName: key.keyPairName,
    // ...
})
```

The private (and optionally the public) key will be stored in AWS Secrets Manager. The secret names by default are prefixed with `ec2-ssh-key/`. The private key is suffixed with `/private`, the public key is suffixed with `/public`. So in this example they will be stored as `ec2-ssh-key/a-key-pair/private` and `ec2-ssh-key/a-key-pair/public`.

To download the private key via AWS cli you can run:

```bash
aws secretsmanager get-secret-value \
  --secret-id ec2-ssh-key/a-key-pair/private \
  --query SecretString \
  --output text
```

### Tag support

The construct supports tagging:

```typescript
cdk.Tags.of(key).add('someTag', 'some value');
```

We also use tags to restrict update/delete actions to those, the construct created itself. The Lambda function, which backs the custom CFN resource, is not able to manipulate other keys/secrets. The tag we use for identifying these resources is `CreatedByCfnCustomResource` with value `CFN::Resource::Custom::EC2-Key-Pair`.

### Updates

Since an EC2 KeyPair cannot be updated, you cannot change any property related to the KeyPair. The code has checks in place which will prevent any attempt to do so. If you try, the stack will end in a failed state. In that case you can safely continue the rollback in the AWS console and ignore the key resource.

You can, however, change properties that only relate to the secrets. These are the KMS keys used for encryption, the `secretPrefix`, `description` and `removeKeySecretsAfterDays`.

### Encryption

Secrets in the AWS Secrets Manager by default are encrypted with the key `alias/aws/secretsmanager`.

To use a custom KMS key you can pass it to the Key Pair:

```typescript
const kmsKey = new kms.Key(this, 'KMS-key');

const keyPair = new KeyPair(this, 'A-Key-Pair', {
    name: 'a-key-pair',
    kms: kmsKey,
});
```

This KMS key needs to be created in the same stack. You cannot use a key imported via ARN, because the keys access policy will need to be modified.

To use different KMS keys for the private and public key, use the `kmsPrivateKey` and `kmsPublicKey` instead:

```typescript
const kmsKeyPrivate = new kms.Key(this, 'KMS-key-private');
const kmsKeyPublic = new kms.Key(this, 'KMS-key-public');

const keyPair = new KeyPair(this, 'A-Key-Pair', {
    name: 'a-key-pair',
    kmsPrivateKey: kmsKeyPrivate,
    kmsPublicKey: kmsKeyPublic
});
```

### Importing public key

You can create a key pair by importing the public key. Obviously, in this case the secret key won't be available in secrets manager.

The public key has to be in OpenSSH format.

```typescript
new KeyPair(this, 'Test-Key-Pair', {
  name: 'imported-key-pair',
  publicKey: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCuMmbK...'
});
```

### Using the key pair for CloudFront signed url/cookies

You can use this library for generating keys for CloudFront signed url/cookies.

Make sure to set `publicKeyFormat` to `PublicKeyFormat.PEM` as that is the format required for CloudFront.
You also have to set `exposePublicKey` to `true` so you can actually get the public key.

```typescript
  const key = new KeyPair(this, 'Signing-Key-Pair', {
      name: 'CFN-signing-key',
      exposePublicKey: true,
      storePublicKey: true,
      publicKeyFormat: PublicKeyFormat.PEM
  });

  const pubKey = new cloudfront.PublicKey(this, 'Signing-Public-Key', {
    encodedKey: key.publicKeyValue,
  });
  const trustedKeyGroupForCF = new cloudfront.KeyGroup(this, 'Signing-Key-Group', {
    items: [ pubKey ]
  });
```

   [AWS CDK]: https://aws.amazon.com/cdk/
   [custom CloudFormation resource]: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-custom-resources.html
   [EC2 Key Pairs]: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-key-pairs.html
   [AWS Secrets Manager]: https://aws.amazon.com/secrets-manager/
   [npm]: https://www.npmjs.com/package/cdk-ec2-key-pair
   [PyPI]: https://pypi.org/project/cdk-ec2-key-pair/
   [docs]: https://constructs.dev/packages/cdk-ec2-key-pair
   [source]: https://github.com/udondan/cdk-ec2-key-pair
   [license]: https://github.com/udondan/cdk-ec2-key-pair/blob/master/LICENSE
