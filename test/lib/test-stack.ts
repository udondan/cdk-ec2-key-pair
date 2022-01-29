import cdk = require('aws-cdk-lib');
import cloudfront = require('aws-cdk-lib/aws-cloudfront');
import { Construct } from 'constructs';

import { KeyPair, PublicKeyFormat } from '../../lib';

export class TestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    cdk.Tags.of(scope).add('Hello', 'World');

    const keyPair = new KeyPair(this, 'Test-Key-Pair', {
      name: 'test-key-pair',
      description: 'A test Key Pair',
      removeKeySecretsAfterDays: 0,
      storePublicKey: false,
      exposePublicKey: true,
    });

    cdk.Tags.of(keyPair).add('a', 'b');
    cdk.Tags.of(keyPair).add('c', 'd');

    new cdk.CfnOutput(this, 'Test-Public-Key', {
      exportName: 'TestPublicKey',
      value: keyPair.publicKeyValue,
    });

    // PEM && CloudFront

    const key = new KeyPair(this, 'Test-Key-Pair-PEM', {
      name: 'CFN-signing-key',
      exposePublicKey: true,
      storePublicKey: true,
      publicKeyFormat: PublicKeyFormat.PEM,
    });

    const pubKey = new cloudfront.PublicKey(this, 'Signing-Public-Key', {
      encodedKey: key.publicKeyValue,
    });

    new cloudfront.KeyGroup(this, 'Signing-Key-Group', {
      items: [pubKey],
    });
  }
}
