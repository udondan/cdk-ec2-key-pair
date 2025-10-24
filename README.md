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

Manages RSA and ED25519 Key Pairs in EC2 through a Lambda function.

Support for public key format in:

- OpenSSH
- ssh
- PEM
- PKCS#1
- PKCS#8
- RFC4253 (Base64 encoded)
- PuTTY ppk

> [!NOTE]
> Please be aware, CloudFormation now natively supports creating EC2 Key Pairs via [AWS::EC2::KeyPair](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-ec2-keypair.html), so you can generally use [CDK's own KeyPair construct](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.KeyPair.html). There are a few differences, though, and this is why the custom construct remains valuable:
>
> - Instead of SSM Parameter Store, keys are stored in [AWS Secrets Manager]
> - Secrets can be **KMS encrypted** - even different KMS keys for the private and public keys. Of course, SSM parameters _can_ be encrypted too, CloudFormation just doesn't do it
> - Optionally, this construct can store and expose the public key, enabling the user to directly use it as input for other resources, e.g. for CloudFront signed urls

## Installation

This package has peer dependencies, which need to be installed along in the expected version.

For TypeScript/NodeJS, add these to your `dependencies` in `package.json`. For Python, add these to your `requirements.txt`:

- cdk-ec2-key-pair
- aws-cdk-lib (^2.116.0)
- constructs (^10.0.0)

## Usage

```typescript
import cdk = require('aws-cdk-lib');
import { Construct } from 'constructs';
import { KeyPair } from 'cdk-ec2-key-pair';

// ...

// Create the Key Pair
const key = new KeyPair(this, 'A-Key-Pair', {
  keyPairName: 'a-key-pair',
  description: 'This is a Key Pair',
  storePublicKey: true, // by default the public key will not be stored in Secrets Manager
});

// Grant read access to the private key secret
key.privateKeySecret.grantRead(someRole);

// Grant read access to the public key secret (if stored)
key.publicKeySecret?.grantRead(anotherRole);

// Access the secret ARN
const privateKeyArn = key.privateKeySecret.secretArn;

// Use Key Pair on an EC2 instance
new ec2.Instance(this, 'An-Instance', {
  keyPair: key,
  // ...
});
```

The private (and optionally the public) key will be stored in AWS Secrets Manager. The secret names by default are prefixed with `ec2-ssh-key/`. The private key is suffixed with `/private`, the public key is suffixed with `/public`. So in this example they will be stored as `ec2-ssh-key/a-key-pair/private` and `ec2-ssh-key/a-key-pair/public`.

### Accessing Secrets

The construct exposes the secrets as `ISecret` objects:

```typescript
// Access the private key secret
const privateKeySecret = key.privateKeySecret;

// Access the public key secret (if storePublicKey was enabled)
const publicKeySecret = key.publicKeySecret;

// Get the secret ARN
const secretArn = key.privateKeySecret.secretArn;

// Use the secret value in CloudFormation (e.g., for custom resources)
const secretValue = key.privateKeySecret.secretValue;
```

To download the private key via AWS CLI you can run:

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
  keyPairName: 'a-key-pair',
  kms: kmsKey,
});
```

This KMS key needs to be created in the same stack. You cannot use a key imported via ARN, because the keys access policy will need to be modified.

To use different KMS keys for the private and public key, use the `kmsPrivateKey` and `kmsPublicKey` instead:

```typescript
const kmsKeyPrivate = new kms.Key(this, 'KMS-key-private');
const kmsKeyPublic = new kms.Key(this, 'KMS-key-public');

const keyPair = new KeyPair(this, 'A-Key-Pair', {
  keyPairName: 'a-key-pair',
  kmsPrivateKey: kmsKeyPrivate,
  kmsPublicKey: kmsKeyPublic,
});
```

### Importing public key

You can create a key pair by importing the public key. Obviously, in this case the private key won't be available in secrets manager.

The public key has to be in OpenSSH format.

```typescript
new KeyPair(this, 'Test-Key-Pair', {
  keyPairName: 'imported-key-pair',
  publicKey: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCuMmbK...',
});
```

### Using the key pair for CloudFront signed url/cookies

You can use this library for generating keys for CloudFront signed url/cookies.

Make sure to set `publicKeyFormat` to `PublicKeyFormat.PEM` as that is the format required for CloudFront.
You also have to set `exposePublicKey` to `true` so you can actually get the public key.

```typescript
const key = new KeyPair(this, 'Signing-Key-Pair', {
  keyPairName: 'CFN-signing-key',
  exposePublicKey: true,
  storePublicKey: true,
  publicKeyFormat: PublicKeyFormat.PEM,
});

const pubKey = new cloudfront.PublicKey(this, 'Signing-Public-Key', {
  encodedKey: key.publicKeyValue,
});
const trustedKeyGroupForCF = new cloudfront.KeyGroup(
  this,
  'Signing-Key-Group',
  {
    items: [pubKey],
  },
);
```

[AWS CDK]: https://aws.amazon.com/cdk/
[EC2 Key Pairs]: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-key-pairs.html
[AWS Secrets Manager]: https://aws.amazon.com/secrets-manager/
[npm]: https://www.npmjs.com/package/cdk-ec2-key-pair
[PyPI]: https://pypi.org/project/cdk-ec2-key-pair/
[docs]: https://constructs.dev/packages/cdk-ec2-key-pair
[source]: https://github.com/udondan/cdk-ec2-key-pair
[license]: https://github.com/udondan/cdk-ec2-key-pair/blob/main/LICENSE
