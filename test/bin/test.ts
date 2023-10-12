#!/usr/bin/env node
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import cdk = require('aws-cdk-lib');

import { TestStack } from '../lib/test-stack';

async function getIdentity() {
  try {
    const stsClient = new STSClient({});
    const callerIdentity = await stsClient.send(
      new GetCallerIdentityCommand({})
    );
    console.log(callerIdentity);
  } catch (error) {
    console.error('Error retrieving identity:', error);
  }
}

async function main() {
  await getIdentity();
  const app = new cdk.App();
  new TestStack(app, 'EC2KeyPair', {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
  });
}

main();
