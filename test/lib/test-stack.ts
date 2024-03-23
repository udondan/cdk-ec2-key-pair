import {
  Tags,
  StackProps,
  Stack,
  CfnOutput,
  aws_iam,
  aws_ec2,
} from 'aws-cdk-lib';
import cloudfront = require('aws-cdk-lib/aws-cloudfront');
import { Construct } from 'constructs';
import { KeyType, LogLevel, PublicKeyFormat } from '../../lambda/types';
import { KeyPair } from '../../lib';

interface Props extends StackProps {
  currentUserName: string;
}

const logLevel = LogLevel.DEBUG;

export class TestStack extends Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    Tags.of(scope).add('Hello', 'World');
    Tags.of(scope).add('Test', process.env.TAG_VALUE ?? 'default');

    const keyPair = new KeyPair(this, 'Test-Key-Pair', {
      keyPairName: 'test-key-pair',
      description: 'A test Key Pair',
      removeKeySecretsAfterDays: 0,
      storePublicKey: false,
      exposePublicKey: true,
    });

    Tags.of(keyPair).add('a', 'b');
    Tags.of(keyPair).add('c', 'd');

    new CfnOutput(this, 'Test-Public-Key', {
      exportName: 'TestPublicKey',
      value: keyPair.publicKeyValue,
    });

    // import public key

    const keyPairImport = new KeyPair(this, 'Test-Key-Pair-Import', {
      keyPairName: 'test-key-pair-import',
      description: 'A test Key Pair, imported via public key',
      removeKeySecretsAfterDays: 0,
      storePublicKey: false,
      exposePublicKey: true,
      publicKey: keyPair.publicKeyValue,
      logLevel,
    });

    if (process.env.with_ec2 === 'true') {
      new aws_ec2.Instance(this, 'Test-Instance', {
        vpc: aws_ec2.Vpc.fromLookup(this, 'VPC', {
          vpcName: 'default',
        }),
        instanceType: aws_ec2.InstanceType.of(
          aws_ec2.InstanceClass.T2,
          aws_ec2.InstanceSize.MICRO,
        ),
        machineImage: aws_ec2.MachineImage.latestAmazonLinux2(),
        keyPair: keyPairImport,
      });
    }

    new CfnOutput(this, 'Test-Public-Key-Import', {
      exportName: 'TestPublicKeyImport',
      value: keyPairImport.publicKeyValue,
    });

    // PEM && CloudFront

    const keyPairPem = new KeyPair(this, 'Test-Key-Pair-PEM', {
      keyPairName: 'CFN-signing-key',
      exposePublicKey: true,
      storePublicKey: true,
      publicKeyFormat: PublicKeyFormat.PEM,
      legacyLambdaName: true,
      logLevel,
    });

    const currentUser = aws_iam.User.fromUserName(
      this,
      'Current-User',
      props.currentUserName,
    );

    keyPairPem.grantReadOnPrivateKey(currentUser);
    keyPairPem.grantReadOnPublicKey(currentUser);

    new CfnOutput(this, 'Test-Public-Key-PEM', {
      exportName: 'TestPublicKeyPEM',
      value: keyPairPem.publicKeyValue,
    });

    const pubKey = new cloudfront.PublicKey(this, 'Signing-Public-Key', {
      encodedKey: keyPairPem.publicKeyValue,
    });

    new cloudfront.KeyGroup(this, 'Signing-Key-Group', {
      items: [pubKey],
    });

    for (const [_key, publicKeyFormat] of Object.entries(PublicKeyFormat)) {
      for (const [_key, keyType] of Object.entries(KeyType)) {
        if (
          keyType === KeyType.ED25519 &&
          publicKeyFormat == PublicKeyFormat.PKCS1
        ) {
          // combination not supported
          continue;
        }

        const keyPairName = `Test-Key-Pair-${keyType}-${publicKeyFormat}`;
        const keyPair = new KeyPair(this, keyPairName, {
          keyPairName,
          keyType,
          publicKeyFormat,
          exposePublicKey: true,
          storePublicKey: true,
          logLevel,
        });
        new CfnOutput(this, `${keyPairName}-Public-Key`, {
          exportName: `${keyPairName}-Public-Key`,
          value: keyPair.publicKeyValue,
        });
      }
    }
  }
}
