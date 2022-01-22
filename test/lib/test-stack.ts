import cdk = require('aws-cdk-lib');
import { Construct } from 'constructs';

import { KeyPair, KeyType } from '../../lib';

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

    new KeyPair(this, 'Test-Key-Pair-ED25519', {
      name: 'test-key-pair-2',
      description: 'A test Key Pair',
      removeKeySecretsAfterDays: 0,
      storePublicKey: false,
      exposePublicKey: true,
      keyType: KeyType.ED25519,
    });

    cdk.Tags.of(keyPair).add('a', 'b');
    cdk.Tags.of(keyPair).add('c', 'd');

    new cdk.CfnOutput(this, 'TestPublicKey', {
      exportName: 'TestPublicKey',
      value: keyPair.publicKeyValue,
    });
  }
}
