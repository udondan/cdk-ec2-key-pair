import * as cdk from '@aws-cdk/core';

import { KeyPair } from '../../lib';

export class TestStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    cdk.Tags.of(scope).add('Hello', 'World');

    const keyPair = new KeyPair(this, 'Test-Key-Pair', {
      name: 'test-key-pair',
      description: 'A test Key Pair',
      removeKeySecretsAfterDays: 0,
      storePublicKey: true,
    });

    cdk.Tags.of(keyPair).add('a', 'b');
    cdk.Tags.of(keyPair).add('c', 'd');
  }
}
