import {
  Annotations,
  CustomResource,
  Duration,
  ITaggable,
  Lazy,
  Resource,
  ResourceProps,
  Stack,
  TagManager,
  TagType,
  aws_iam,
  aws_kms,
  aws_lambda,
  aws_secretsmanager,
} from 'aws-cdk-lib';
import {
  IKeyPair,
  KeyPairReference,
  OperatingSystemType,
} from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import * as path from 'path';
import {
  KeyType,
  LogLevel,
  PublicKeyFormat,
  ResourceProperties,
} from './types';
export { KeyType, LogLevel, PublicKeyFormat } from './types';

const resourceType = 'Custom::EC2-Key-Pair';
const ID = `CFN::Resource::${resourceType}`;
const createdByTag = 'CreatedByCfnCustomResource';
const cleanID = ID.replace(/:+/g, '-');
const lambdaTimeout = 3; // minutes

/**
 * Definition of EC2 Key Pair
 */
export interface KeyPairProps extends ResourceProps {
  /**
   * Name of the Key Pair
   *
   * In AWS Secrets Manager the key will be prefixed with `ec2-ssh-key/`.
   *
   * The name can be up to 255 characters long. Valid characters include _, -, a-z, A-Z, and 0-9.
   */
  readonly keyPairName: string;

  /**
   * The description for the key in AWS Secrets Manager
   * @default - ''
   */
  readonly description?: string;

  /**
   * The KMS key used to encrypt the Secrets Manager secrets with
   *
   * This needs to be a key created in the same stack. You cannot use a key imported via ARN, because the keys access policy will need to be modified.
   *
   * @default - `alias/aws/secretsmanager`
   */
  readonly kms?: aws_kms.Key;

  /**
   * The KMS key to use to encrypt the private key with
   *
   * This needs to be a key created in the same stack. You cannot use a key imported via ARN, because the keys access policy will need to be modified.
   *
   * If no value is provided, the property `kms` will be used instead.
   *
   * @default - `this.kms`
   */
  readonly kmsPrivateKey?: aws_kms.Key;

  /**
   * The KMS key to use to encrypt the public key with
   *
   * This needs to be a key created in the same stack. You cannot use a key imported via ARN, because the keys access policy will need to be modified.
   *
   * If no value is provided, the property `kms` will be used instead.
   *
   * @default - `this.kms`
   */
  readonly kmsPublicKey?: aws_kms.Key;

  /**
   * Import a public key instead of creating it
   *
   * If no public key is provided, a new key pair will be created.
   */
  readonly publicKey?: string;

  /**
   * Store the public key as a secret
   *
   * @default - false
   */
  readonly storePublicKey?: boolean;

  /**
   * Expose the public key as property `publicKeyValue`
   *
   * @default - false
   */
  readonly exposePublicKey?: boolean;

  /**
   * The type of key pair
   *
   * @default - RSA
   */
  readonly keyType?: KeyType;

  /**
   * Format for public key.
   *
   * Relevant only if the public key is stored and/or exposed.
   *
   * @default - SSH
   */
  readonly publicKeyFormat?: PublicKeyFormat;

  /**
   * When the resource is destroyed, after how many days the private and public key in the AWS Secrets Manager should be deleted.
   *
   * Valid values are 0 and 7 to 30
   *
   * @default 0
   */
  readonly removeKeySecretsAfterDays?: number;

  /**
   * Prefix for the secret in AWS Secrets Manager.
   *
   * @default `ec2-ssh-key/`
   */
  readonly secretPrefix?: string;

  /**
   * A prefix for all resource names.
   *
   * By default all resources are prefixed with the stack name to avoid collisions with other stacks. This might cause problems when you work with long stack names and can be overridden through this parameter.
   *
   * @default Name of the stack
   */
  readonly resourcePrefix?: string;

  /**
   * Whether to use the legacy name for the Lambda function, which backs the custom resource.
   *
   * Starting with v4 of this package, the Lambda function by default has no longer a fixed name.
   *
   * If you migrate from v3 to v4, you need to set this to `true` as CloudFormation does not allow to change the name of the Lambda function used by custom resource.
   *
   * @default false
   */
  readonly legacyLambdaName?: boolean;

  /**
   * The log level of the Lambda function
   *
   * @default LogLevel.warn
   */
  readonly logLevel?: LogLevel;
}

/**
 * An EC2 Key Pair
 */
export class KeyPair extends Resource implements ITaggable, IKeyPair {
  /**
   * The lambda function that is created
   */
  public readonly lambdaFunction: aws_lambda.IFunction;

  /**
   * The public key.
   *
   * Only filled, when `exposePublicKey = true`
   */
  public readonly publicKeyValue: string = '';

  /**
   * Name of the Key Pair
   */
  public readonly keyPairName: string = '';

  /**
   * ID of the Key Pair
   */
  public readonly keyPairID: string = '';

  /**
   * Fingerprint of the Key Pair
   */
  public readonly keyPairFingerprint: string = '';

  /**
   * Format of the public key
   */
  public readonly publicKeyFormat: PublicKeyFormat;

  /**
   * The private key secret in AWS Secrets Manager
   */

  public readonly privateKeySecret: aws_secretsmanager.ISecret;

  /**
   * The public key secret in AWS Secrets Manager
   */
  public readonly publicKeySecret?: aws_secretsmanager.ISecret;

  /**
   * Type of the Key Pair
   */
  public readonly keyType: KeyType;

  /**
   * Resource tags
   */
  public readonly tags: TagManager;

  public readonly prefix: string = '';

  public get keyPairRef(): KeyPairReference {
    return {
      keyName: this.keyPairName,
    };
  }

  /**
   * Defines a new EC2 Key Pair. The private key will be stored in AWS Secrets Manager
   */
  constructor(scope: Construct, id: string, props: KeyPairProps) {
    super(scope, id);

    if (
      props.removeKeySecretsAfterDays &&
      (props.removeKeySecretsAfterDays < 0 ||
        (props.removeKeySecretsAfterDays > 0 &&
          props.removeKeySecretsAfterDays < 7) ||
        props.removeKeySecretsAfterDays > 30)
    ) {
      Annotations.of(this).addError(
        `Parameter removeKeySecretsAfterDays must be 0 or between 7 and 30. Got ${props.removeKeySecretsAfterDays}`,
      );
    }

    if (
      props.publicKey?.length &&
      props.publicKeyFormat !== undefined &&
      props.publicKeyFormat !== PublicKeyFormat.OPENSSH
    ) {
      Annotations.of(this).addError(
        'When importing a key, the format has to be of type OpenSSH',
      );
    }

    if (
      props.keyType == KeyType.ED25519 &&
      props.publicKeyFormat == PublicKeyFormat.PKCS1
    ) {
      Annotations.of(this).addError(
        'The public key format PKCS1 is not supported for key type ED25519',
      );
    }

    const stack = Stack.of(this).stackName;

    if (props.legacyLambdaName) {
      this.prefix = props.resourcePrefix ?? stack;
      if (this.prefix.length + cleanID.length > 62) {
        // Cloudformation limits names to 63 characters.
        Annotations.of(this).addError(
          `Cloudformation limits names to 63 characters.
           Prefix ${this.prefix} is too long to be used as a prefix for your roleName. Define parameter resourcePrefix?:`,
        );
      }
    }
    this.lambdaFunction = this.ensureLambda(props.legacyLambdaName ?? false);

    this.tags = new TagManager(TagType.MAP, 'Custom::EC2-Key-Pair');
    this.tags.setTag(createdByTag, ID);

    this.keyType = props.keyType ?? KeyType.RSA;
    this.publicKeyFormat = props.publicKeyFormat ?? PublicKeyFormat.SSH;

    const kmsPrivate = props.kmsPrivateKey ?? props.kms;
    const kmsPublic = props.kmsPublicKey ?? props.kms;

    const lambdaProperties: ResourceProperties = {
      /* eslint-disable @typescript-eslint/naming-convention */
      Name: props.keyPairName,
      Description: props.description ?? '',
      KmsPrivate: kmsPrivate?.keyArn ?? 'alias/aws/secretsmanager',
      KmsPublic: kmsPublic?.keyArn ?? 'alias/aws/secretsmanager',
      PublicKey: props.publicKey ?? '',
      StorePublicKey: props.storePublicKey ? 'true' : 'false',
      ExposePublicKey: props.exposePublicKey ? 'true' : 'false',
      KeyType: this.keyType,
      PublicKeyFormat: props.publicKeyFormat ?? PublicKeyFormat.SSH,
      RemoveKeySecretsAfterDays: props.removeKeySecretsAfterDays ?? 0,
      SecretPrefix: props.secretPrefix ?? 'ec2-ssh-key/',
      StackName: stack,
      Tags: Lazy.any({
        produce: () => this.tags.renderTags() as Record<string, string>,
      }) as unknown as Record<string, string>,
      LogLevel: props.logLevel,
      /* eslint-enable @typescript-eslint/naming-convention */
    };

    const key = new CustomResource(this, `EC2-Key-Pair-${props.keyPairName}`, {
      serviceToken: this.lambdaFunction.functionArn,
      resourceType: resourceType,
      properties: lambdaProperties,
    });

    this.privateKeySecret = aws_secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'PrivateKeySecret',
      key.getAttString('PrivateKeyARN'),
    );

    if (props.storePublicKey) {
      this.publicKeySecret = aws_secretsmanager.Secret.fromSecretCompleteArn(
        this,
        'PublicKeySecret',
        key.getAttString('PublicKeyARN'),
      );
    }

    if (typeof props.kms !== 'undefined') {
      props.kms.grantEncryptDecrypt(this.lambdaFunction.role!);
      key.node.addDependency(props.kms);
      key.node.addDependency(this.lambdaFunction.role!);
    }

    if (typeof props.kmsPrivateKey !== 'undefined') {
      props.kmsPrivateKey.grantEncryptDecrypt(this.lambdaFunction.role!);
      key.node.addDependency(props.kmsPrivateKey);
      key.node.addDependency(this.lambdaFunction.role!);
    }

    if (typeof props.kmsPublicKey !== 'undefined') {
      props.kmsPublicKey.grantEncryptDecrypt(this.lambdaFunction.role!);
      key.node.addDependency(props.kmsPublicKey);
      key.node.addDependency(this.lambdaFunction.role!);
    }

    this.publicKeyValue = key.getAttString('PublicKeyValue');
    this.keyPairName = key.getAttString('KeyPairName');
    this.keyPairID = key.getAttString('KeyPairID');
    this.keyPairFingerprint = key.getAttString('KeyPairFingerprint');
  }

  private ensureLambda(legacyLambdaName: boolean): aws_lambda.Function {
    const stack = Stack.of(this);
    const constructName = legacyLambdaName
      ? 'EC2-Key-Name-Manager-Lambda' // this name was not intentional but we keep it for legacy resources
      : 'EC2-Key-Pair-Manager-Lambda';
    const existing = stack.node.tryFindChild(constructName);
    if (existing) {
      return existing as aws_lambda.Function;
    }

    const resources = [`arn:${stack.partition}:ec2:*:*:key-pair/*`];

    const statements = [
      new aws_iam.PolicyStatement({
        actions: ['ec2:DescribeKeyPairs'],
        resources: ['*'],
      }),
      new aws_iam.PolicyStatement({
        actions: ['ec2:CreateKeyPair', 'ec2:CreateTags', 'ec2:ImportKeyPair'],
        conditions: {
          /* eslint-disable @typescript-eslint/naming-convention */
          StringLike: {
            'aws:RequestTag/CreatedByCfnCustomResource': ID,
          },
          /* eslint-enable @typescript-eslint/naming-convention */
        },
        resources,
      }),
      new aws_iam.PolicyStatement({
        // allow delete/update, only if createdByTag is set
        actions: ['ec2:CreateTags', 'ec2:DeleteKeyPair', 'ec2:DeleteTags'],
        conditions: {
          /* eslint-disable @typescript-eslint/naming-convention */
          StringLike: {
            'ec2:ResourceTag/CreatedByCfnCustomResource': ID,
          },
          /* eslint-enable @typescript-eslint/naming-convention */
        },
        resources,
      }),

      new aws_iam.PolicyStatement({
        // we need this to check if a secret exists before attempting to delete it
        actions: ['secretsmanager:ListSecrets'],
        resources: ['*'],
      }),
      new aws_iam.PolicyStatement({
        actions: ['secretsmanager:CreateSecret', 'secretsmanager:TagResource'],
        conditions: {
          /* eslint-disable @typescript-eslint/naming-convention */
          StringLike: {
            'aws:RequestTag/CreatedByCfnCustomResource': ID,
          },
          /* eslint-enable @typescript-eslint/naming-convention */
        },
        resources: ['*'],
      }),
      new aws_iam.PolicyStatement({
        // allow delete/update, only if createdByTag is set
        actions: [
          'secretsmanager:DeleteResourcePolicy',
          'secretsmanager:DeleteSecret',
          'secretsmanager:DescribeSecret',
          'secretsmanager:GetResourcePolicy',
          'secretsmanager:GetSecretValue',
          'secretsmanager:ListSecretVersionIds',
          'secretsmanager:PutResourcePolicy',
          'secretsmanager:PutSecretValue',
          'secretsmanager:RestoreSecret',
          'secretsmanager:UntagResource',
          'secretsmanager:UpdateSecret',
          'secretsmanager:UpdateSecretVersionStage',
        ],
        conditions: {
          /* eslint-disable @typescript-eslint/naming-convention */
          StringLike: {
            'secretsmanager:ResourceTag/CreatedByCfnCustomResource': ID,
          },
          /* eslint-enable @typescript-eslint/naming-convention */
        },
        resources: ['*'],
      }),
    ];

    const fn = new aws_lambda.Function(stack, constructName, {
      functionName: legacyLambdaName ? `${this.prefix}-${cleanID}` : undefined,
      description: 'Custom CFN resource: Manage EC2 Key Pairs',
      runtime: aws_lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: aws_lambda.Code.fromAsset(
        path.join(__dirname, '../lambda/code.zip'),
      ),
      timeout: Duration.minutes(lambdaTimeout),
    });
    statements.forEach((statement) => {
      fn.role?.addToPrincipalPolicy(statement);
    });

    return fn;
  }

  /**
   * Used internally to determine whether the key pair is compatible with an OS type.
   *
   * @internal
   */
  public _isOsCompatible(osType: OperatingSystemType): boolean {
    switch (this.keyType) {
      case KeyType.ED25519:
        return osType !== OperatingSystemType.WINDOWS;
      default:
        return true;
    }
  }
}
