#!/usr/bin/env node
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import cdk = require('aws-cdk-lib');

import { TestStack } from '../lib/test-stack';

async function getIdentity() {
  const stsClient = new STSClient({});
  const callerIdentity = await stsClient.send(new GetCallerIdentityCommand({}));
  return callerIdentity.Arn?.split('/')[1] as string;
}

async function main() {
  const userName = await getIdentity();
  const app = new cdk.App();
  new TestStack(app, 'EC2KeyPair', {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
    currentUserName: userName,
  });
}

main();
