import * as cdk from '@aws-cdk/core';

import { KeyPair } from '../../lib';

export class TestStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    cdk.Tags.of(scope).add('Hello', 'Wrold');

    new KeyPair(this, 'Test-Key-Pair', {
      name: 'test-key-pair',
      description: 'A test Key Pair',
      tags: {
        a: 'b',
        c: 'd',
      },
      removePrivateKeyAfterDays: 0,
    });
  }
}
