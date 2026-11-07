#!/usr/bin/env node
import {
  GetCallerIdentityCommand,
  STSClient,
  STSClientConfig,
} from '@aws-sdk/client-sts';
import * as cdk from 'aws-cdk-lib';

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
  const arn = callerIdentity.Arn;
  if (!arn) {
    throw new Error('Unable to get caller identity');
  }
  // arn:aws:iam::<account>:user/<name> or
  // arn:aws:sts::<account>:assumed-role/<name>/<session>
  const [resource, name] = arn.split(':')[5].split('/');
  return {
    type: resource === 'assumed-role' ? ('role' as const) : ('user' as const),
    name,
  };
}

async function main() {
  const identity = await getIdentity();
  const app = new cdk.App();
  new TestStack(app, 'EC2KeyPair', {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
    currentIdentity: identity,
  });
}

main().catch((error) => {
  console.error('An error occurred:', error);
});
