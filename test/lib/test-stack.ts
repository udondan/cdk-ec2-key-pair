import ec2 = require('@aws-cdk/aws-ec2');
import * as cdk from '@aws-cdk/core';

import { KeyPair } from '../../lib';

export class TestStack extends cdk.Stack {
    constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const key = new KeyPair(this, 'A-Test-Key', {
            name: 'a-test-key',
            description: 'A test Key',
            tags: {
                a: 'b',
                c: 'd',
            },
        });
    }
}
