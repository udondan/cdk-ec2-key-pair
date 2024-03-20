import { Tags, StackProps, Stack, CfnOutput, aws_iam } from 'aws-cdk-lib';
import cloudfront = require('aws-cdk-lib/aws-cloudfront');
import { Construct } from 'constructs';
import { PublicKeyFormat } from '../../lambda/types';
import { KeyPair } from '../../lib';

interface Props extends StackProps {
  currentUserName: string;
}

export class TestStack extends Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    Tags.of(scope).add('Hello', 'World');

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
    });

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
  }
}
