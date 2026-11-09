/* eslint-disable @typescript-eslint/naming-convention */
import { App, Stack, aws_kms, aws_lambda } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { OperatingSystemType } from 'aws-cdk-lib/aws-ec2';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KeyPair,
  KeyPairProps,
  KeyType,
  LogLevel,
  PublicKeyFormat,
} from '../lib';

const resourceType = 'Custom::EC2-Key-Pair';
const createdBy = 'CFN::Resource::Custom::EC2-Key-Pair';

function makeStack(stackName = 'TestStack'): Stack {
  return new Stack(new App(), stackName);
}

function makeKeyPair(
  props: Partial<KeyPairProps> = {},
  stack = makeStack(),
): { stack: Stack; keyPair: KeyPair } {
  const keyPair = new KeyPair(stack, 'Key', {
    keyPairName: 'test-key',
    ...props,
  });
  return { stack, keyPair };
}

function errors(stack: Stack) {
  return Annotations.fromStack(stack).findError('*', Match.anyValue());
}

beforeEach(() => {
  // The real asset only exists after lambda/build ran.
  vi.spyOn(aws_lambda.Code, 'fromAsset').mockReturnValue(
    aws_lambda.Code.fromInline('exports.handler = () => {};'),
  );
});

describe('KeyPair', () => {
  it('creates the custom resource with default properties', () => {
    const { stack, keyPair } = makeKeyPair();
    const template = Template.fromStack(stack);

    template.hasResourceProperties(resourceType, {
      Name: 'test-key',
      Description: '',
      KmsPrivate: 'alias/aws/secretsmanager',
      KmsPublic: 'alias/aws/secretsmanager',
      PublicKey: '',
      StorePublicKey: 'false',
      ExposePublicKey: 'false',
      KeyType: 'rsa',
      PublicKeyFormat: 'ssh',
      RemoveKeySecretsAfterDays: 0,
      SecretPrefix: 'ec2-ssh-key/',
      StackName: 'TestStack',
      Tags: { CreatedByCfnCustomResource: createdBy },
      LogLevel: Match.absent(),
    });
    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: aws_lambda.Runtime.NODEJS_24_X.name,
      Handler: 'index.handler',
      Timeout: 180,
      FunctionName: Match.absent(),
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ec2:DescribeKeyPairs',
            Resource: '*',
          }),
          Match.objectLike({
            Action: [
              'ec2:CreateKeyPair',
              'ec2:CreateTags',
              'ec2:ImportKeyPair',
            ],
            Condition: {
              StringLike: {
                'aws:RequestTag/CreatedByCfnCustomResource': createdBy,
              },
            },
          }),
          Match.objectLike({
            Action: 'secretsmanager:ListSecrets',
            Resource: '*',
          }),
        ]),
      },
    });

    expect(errors(stack)).toHaveLength(0);
    expect(keyPair.keyType).toBe(KeyType.RSA);
    expect(keyPair.publicKeyFormat).toBe(PublicKeyFormat.SSH);
    expect(keyPair.publicKeySecret).toBeUndefined();
    expect(keyPair.privateKeySecret).toBeDefined();
    expect(keyPair.prefix).toBe('');
    expect(keyPair.keyPairRef).toEqual({ keyName: keyPair.keyPairName });
  });

  it('passes all optional properties to the custom resource', () => {
    const { stack, keyPair } = makeKeyPair({
      description: 'my key',
      publicKey: 'ssh-rsa AAAA',
      publicKeyFormat: PublicKeyFormat.OPENSSH,
      storePublicKey: true,
      exposePublicKey: true,
      keyType: KeyType.ED25519,
      removeKeySecretsAfterDays: 7,
      secretPrefix: 'custom/',
      logLevel: LogLevel.DEBUG,
      lambdaRuntime: aws_lambda.Runtime.NODEJS_22_X,
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties(resourceType, {
      Description: 'my key',
      PublicKey: 'ssh-rsa AAAA',
      PublicKeyFormat: 'openssh',
      StorePublicKey: 'true',
      ExposePublicKey: 'true',
      KeyType: 'ed25519',
      RemoveKeySecretsAfterDays: 7,
      SecretPrefix: 'custom/',
      LogLevel: LogLevel.DEBUG,
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: aws_lambda.Runtime.NODEJS_22_X.name,
    });
    expect(errors(stack)).toHaveLength(0);
    expect(keyPair.publicKeySecret).toBeDefined();
    expect(keyPair.publicKeyFormat).toBe(PublicKeyFormat.OPENSSH);
  });

  it('renders added tags', () => {
    const { stack, keyPair } = makeKeyPair();
    keyPair.tags.setTag('Foo', 'bar');
    Template.fromStack(stack).hasResourceProperties(resourceType, {
      Tags: { CreatedByCfnCustomResource: createdBy, Foo: 'bar' },
    });
  });

  it.each([0, 7, 30])('accepts removeKeySecretsAfterDays %d', (days) => {
    const { stack } = makeKeyPair({ removeKeySecretsAfterDays: days });
    expect(errors(stack)).toHaveLength(0);
  });

  it.each([-1, 3, 31])('rejects removeKeySecretsAfterDays %d', (days) => {
    const { stack } = makeKeyPair({ removeKeySecretsAfterDays: days });
    Annotations.fromStack(stack).hasError(
      '*',
      `Parameter removeKeySecretsAfterDays must be 0 or between 7 and 30. Got ${days}`,
    );
  });

  it('rejects a non-OpenSSH format for imported keys', () => {
    const { stack } = makeKeyPair({
      publicKey: 'ssh-rsa AAAA',
      publicKeyFormat: PublicKeyFormat.PEM,
    });
    Annotations.fromStack(stack).hasError(
      '*',
      'When importing a key, the format has to be of type OpenSSH',
    );
  });

  it('accepts imported keys without a format', () => {
    const { stack } = makeKeyPair({ publicKey: 'ssh-rsa AAAA' });
    expect(errors(stack)).toHaveLength(0);
  });

  it('accepts a format when no key is imported', () => {
    const { stack } = makeKeyPair({ publicKeyFormat: PublicKeyFormat.PEM });
    expect(errors(stack)).toHaveLength(0);
  });

  it('rejects a non-Node.js runtime', () => {
    const { stack } = makeKeyPair({
      lambdaRuntime: aws_lambda.Runtime.PYTHON_3_12,
    });
    Annotations.fromStack(stack).hasError(
      '*',
      'Parameter lambdaRuntime must be a Node.js runtime. Got python3.12',
    );
  });

  it('rejects PKCS1 for ED25519 keys', () => {
    const { stack } = makeKeyPair({
      keyType: KeyType.ED25519,
      publicKeyFormat: PublicKeyFormat.PKCS1,
    });
    Annotations.fromStack(stack).hasError(
      '*',
      'The public key format PKCS1 is not supported for key type ED25519',
    );
  });

  it('accepts PKCS1 for RSA keys', () => {
    const { stack } = makeKeyPair({
      keyType: KeyType.RSA,
      publicKeyFormat: PublicKeyFormat.PKCS1,
    });
    expect(errors(stack)).toHaveLength(0);
  });

  describe('legacyLambdaName', () => {
    it('names the Lambda function after the stack', () => {
      const { stack, keyPair } = makeKeyPair({ legacyLambdaName: true });
      expect(keyPair.prefix).toBe('TestStack');
      expect(
        stack.node.tryFindChild('EC2-Key-Name-Manager-Lambda'),
      ).toBeDefined();
      Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'TestStack-CFN-Resource-Custom-EC2-Key-Pair',
      });
      expect(errors(stack)).toHaveLength(0);
    });

    it('names the Lambda function after resourcePrefix', () => {
      const { stack, keyPair } = makeKeyPair({
        legacyLambdaName: true,
        resourcePrefix: 'Prefix',
      });
      expect(keyPair.prefix).toBe('Prefix');
      Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'Prefix-CFN-Resource-Custom-EC2-Key-Pair',
      });
    });

    it('rejects a prefix that is too long', () => {
      // Long enough for the check, short enough for the Lambda function name limit of 64.
      const { stack } = makeKeyPair({
        legacyLambdaName: true,
        resourcePrefix: 'x'.repeat(31),
      });
      Annotations.fromStack(stack).hasError(
        '*',
        Match.stringLikeRegexp('Cloudformation limits names to 63 characters'),
      );
    });
  });

  it('shares one Lambda function between key pairs of a stack', () => {
    const stack = makeStack();
    const first = makeKeyPair({}, stack).keyPair;
    const second = new KeyPair(stack, 'Key2', { keyPairName: 'other' });
    expect(second.lambdaFunction).toBe(first.lambdaFunction);
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.resourceCountIs(resourceType, 2);
  });

  it('uses and grants the kms key for both secrets', () => {
    const stack = makeStack();
    const kms = new aws_kms.Key(stack, 'Kms');
    makeKeyPair({ kms }, stack);
    const template = Template.fromStack(stack);
    const kmsArn = { 'Fn::GetAtt': [Match.stringLikeRegexp('^Kms'), 'Arn'] };

    template.hasResourceProperties(resourceType, {
      KmsPrivate: kmsArn,
      KmsPublic: kmsArn,
    });
    template.hasResource(resourceType, {
      DependsOn: Match.arrayWith([Match.stringLikeRegexp('^Kms')]),
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['kms:Decrypt', 'kms:Encrypt']),
            Resource: kmsArn,
          }),
        ]),
      },
    });
  });

  it('uses separate kms keys for private and public key', () => {
    const stack = makeStack();
    const kmsPrivateKey = new aws_kms.Key(stack, 'KmsPrivate');
    const kmsPublicKey = new aws_kms.Key(stack, 'KmsPublic');
    makeKeyPair({ kmsPrivateKey, kmsPublicKey }, stack);
    const template = Template.fromStack(stack);

    template.hasResourceProperties(resourceType, {
      KmsPrivate: {
        'Fn::GetAtt': [Match.stringLikeRegexp('^KmsPrivate'), 'Arn'],
      },
      KmsPublic: {
        'Fn::GetAtt': [Match.stringLikeRegexp('^KmsPublic'), 'Arn'],
      },
    });
    template.hasResource(resourceType, {
      DependsOn: Match.arrayWith([
        Match.stringLikeRegexp('^KmsPrivate'),
        Match.stringLikeRegexp('^KmsPublic'),
      ]),
    });
  });

  describe('_isOsCompatible', () => {
    it('allows RSA keys on every OS', () => {
      const { keyPair } = makeKeyPair();
      expect(keyPair._isOsCompatible(OperatingSystemType.WINDOWS)).toBe(true);
      expect(keyPair._isOsCompatible(OperatingSystemType.LINUX)).toBe(true);
    });

    it('rejects ED25519 keys on Windows', () => {
      const { keyPair } = makeKeyPair({ keyType: KeyType.ED25519 });
      expect(keyPair._isOsCompatible(OperatingSystemType.WINDOWS)).toBe(false);
      expect(keyPair._isOsCompatible(OperatingSystemType.LINUX)).toBe(true);
    });
  });
});
