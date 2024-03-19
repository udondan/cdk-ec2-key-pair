#!/usr/bin/env node
import {
  GetCallerIdentityCommand,
  STSClient,
  STSClientConfig,
} from '@aws-sdk/client-sts';
import cdk = require('aws-cdk-lib');

import { TestStack } from '../lib/test-stack';

const region = 'us-east-1';

const clientConfig: STSClientConfig = {
  region,
};
if (
  process.env.AWS_ACCESS_KEY_ID &&
  process.env.AWS_SECRET_ACCESS_KEY &&
  process.env.AWS_SESSION_TOKEN
) {
  clientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  };
}

async function getIdentity() {
  const stsClient = new STSClient(clientConfig);
  const callerIdentity = await stsClient.send(new GetCallerIdentityCommand({}));
  return callerIdentity.Arn?.split('/')[1]!;
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
