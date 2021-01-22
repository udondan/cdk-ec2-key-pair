import iam = require('@aws-cdk/aws-iam');
import kms = require('@aws-cdk/aws-kms');
import lambda = require('@aws-cdk/aws-lambda');
import cdk = require('@aws-cdk/core');
import * as statement from 'cdk-iam-floyd';
import path = require('path');

const resourceType = 'Custom::EC2-Key-Pair';
const ID = `CFN::Resource::${resourceType}`;
const createdByTag = 'CreatedByCfnCustomResource';
const cleanID = ID.replace(/:+/g, '-');
const lambdaTimeout = 3; // minutes

/**
 * Definition of EC2 Key Pair
 */
export interface KeyPairProps extends cdk.ResourceProps {
  /**
   * Name of the Key Pair
   *
   * In AWS Secrets Manager the key will be prefixed with `ec2-ssh-key/`.
   *
   * The name can be up to 255 characters long. Valid characters include _, -, a-z, A-Z, and 0-9.
   */
  readonly name: string;

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
  readonly kms?: kms.Key;

  /**
   * The KMS key to use to encrypt the private key with
   *
   * This needs to be a key created in the same stack. You cannot use a key imported via ARN, because the keys access policy will need to be modified.
   *
   * If no value is provided, the property `kms` will be used instead.
   *
   * @default - `this.kms`
   */
  readonly kmsPrivateKey?: kms.Key;

  /**
   * The KMS key to use to encrypt the public key with
   *
   * This needs to be a key created in the same stack. You cannot use a key imported via ARN, because the keys access policy will need to be modified.
   *
   * If no value is provided, the property `kms` will be used instead.
   *
   * @default - `this.kms`
   */
  readonly kmsPublicKey?: kms.Key;

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
}

/**
 * An EC2 Key Pair
 */
export class KeyPair extends cdk.Construct implements cdk.ITaggable {
  /**
   * The lambda function that is created
   */
  public readonly lambda: lambda.IFunction;

  /**
   * ARN of the private key in AWS Secrets Manager
   */
  public readonly privateKeyArn: string = '';

  /**
   * ARN of the public key in AWS Secrets Manager
   */
  public readonly publicKeyArn: string = '';

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
   * Resource tags
   */
  public readonly tags: cdk.TagManager;

  public readonly prefix: string = '';

  /**
   * Defines a new EC2 Key Pair. The private key will be stored in AWS Secrets Manager
   */
  constructor(scope: cdk.Construct, id: string, props: KeyPairProps) {
    super(scope, id);

    if (
      props.removeKeySecretsAfterDays &&
      (props.removeKeySecretsAfterDays < 0 ||
        (props.removeKeySecretsAfterDays > 0 &&
          props.removeKeySecretsAfterDays < 7) ||
        props.removeKeySecretsAfterDays > 30)
    ) {
      cdk.Annotations.of(this).addError(
        `Parameter removeKeySecretsAfterDays must be 0 or between 7 and 30. Got ${props.removeKeySecretsAfterDays}`
      );
    }

    const stack = cdk.Stack.of(this).stackName;
    this.prefix = props.resourcePrefix || stack;

    this.lambda = this.ensureLambda();

    this.tags = new cdk.TagManager(cdk.TagType.MAP, 'Custom::EC2-Key-Pair');
    this.tags.setTag(createdByTag, ID);

    const kmsPrivate = props.kmsPrivateKey || props.kms;
    const kmsPublic = props.kmsPublicKey || props.kms;

    const key = new cdk.CustomResource(this, `EC2-Key-Pair-${props.name}`, {
      serviceToken: this.lambda.functionArn,
      resourceType: resourceType,
      properties: {
        Name: props.name,
        Description: props.description || '',
        KmsPrivate: kmsPrivate?.keyArn || 'alias/aws/secretsmanager',
        KmsPublic: kmsPublic?.keyArn || 'alias/aws/secretsmanager',
        StorePublicKey: props.storePublicKey || false,
        ExposePublicKey: props.exposePublicKey || false,
        RemoveKeySecretsAfterDays: props.removeKeySecretsAfterDays || 0,
        SecretPrefix: props.secretPrefix || 'ec2-ssh-key/',
        StackName: stack,
        Tags: cdk.Lazy.any({
          produce: () => this.tags.renderTags(),
        }),
      },
    });

    if (typeof props.kms !== 'undefined') {
      props.kms.grantEncryptDecrypt(this.lambda.role!);
      key.node.addDependency(props.kms);
      key.node.addDependency(this.lambda.role!);
    }

    if (typeof props.kmsPrivateKey !== 'undefined') {
      props.kmsPrivateKey.grantEncryptDecrypt(this.lambda.role!);
      key.node.addDependency(props.kmsPrivateKey);
      key.node.addDependency(this.lambda.role!);
    }

    if (typeof props.kmsPublicKey !== 'undefined') {
      props.kmsPublicKey.grantEncryptDecrypt(this.lambda.role!);
      key.node.addDependency(props.kmsPublicKey);
      key.node.addDependency(this.lambda.role!);
    }

    this.privateKeyArn = key.getAttString('PrivateKeyARN');
    this.publicKeyArn = key.getAttString('PublicKeyARN');
    this.publicKeyValue = key.getAttString('PublicKeyValue');
    this.keyPairName = key.getAttString('KeyPairName');
    this.keyPairID = key.getAttString('KeyPairID');
  }

  private ensureLambda(): lambda.Function {
    const stack = cdk.Stack.of(this);
    const constructName = 'EC2-Key-Name-Manager-Lambda';
    const existing = stack.node.tryFindChild(constructName);
    if (existing) {
      return existing as lambda.Function;
    }

    const policy = new iam.ManagedPolicy(stack, 'EC2-Key-Pair-Manager-Policy', {
      managedPolicyName: `${this.prefix}-${cleanID}`,
      description: `Used by Lambda ${cleanID}, which is a custom CFN resource, managing EC2 Key Pairs`,
      statements: [
        new statement.Ec2() // generally allow to inspect key pairs
          .allow()
          .toDescribeKeyPairs(),
        new statement.Ec2() // allow creation, only if createdByTag is set
          .allow()
          .toCreateKeyPair()
          .toCreateTags()
          .onKeyPair('*')
          .ifAwsRequestTag(createdByTag, ID),
        new statement.Ec2() // allow delete/update, only if createdByTag is set
          .allow()
          .toDeleteKeyPair()
          .toCreateTags()
          .toDeleteTags()
          .onKeyPair('*')
          .ifResourceTag(createdByTag, ID),
        new statement.Secretsmanager() // generally allow to list secrets. we need this to check if a secret exists before attempting to delete it
          .allow()
          .toListSecrets(),
        new statement.Secretsmanager() // allow creation, only if createdByTag is set
          .allow()
          .toCreateSecret()
          .toTagResource()
          .ifAwsRequestTag(createdByTag, ID),
        new statement.Secretsmanager() // allow delete/update, only if createdByTag is set
          .allow()
          .allMatchingActions('/^(Describe|Delete|Put|Update)/')
          .toGetSecretValue()
          .toGetResourcePolicy()
          .toRestoreSecret()
          .toListSecretVersionIds()
          .toUntagResource()
          .ifResourceTag(createdByTag, ID),
      ],
    });

    const role = new iam.Role(stack, 'EC2-Key-Pair-Manager-Role', {
      roleName: `${this.prefix}-${cleanID}`,
      description: `Used by Lambda ${cleanID}, which is a custom CFN resource, managing EC2 Key Pairs`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        policy,
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
      ],
    });

    const fn = new lambda.Function(stack, constructName, {
      functionName: `${this.prefix}-${cleanID}`,
      role: role,
      description: 'Custom CFN resource: Manage EC2 Key Pairs',
      runtime: lambda.Runtime.NODEJS_10_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/code.zip')),
      timeout: cdk.Duration.minutes(lambdaTimeout),
    });

    return fn;
  }

  /**
   * Grants read access to the private key in AWS Secrets Manager
   */
  grantReadOnPrivateKey(grantee: iam.IGrantable) {
    return this.grantRead(this.privateKeyArn, grantee);
  }

  /**
   * Grants read access to the public key in AWS Secrets Manager
   */
  grantReadOnPublicKey(grantee: iam.IGrantable) {
    return this.grantRead(this.publicKeyArn, grantee);
  }

  private grantRead(arn: string, grantee: iam.IGrantable) {
    const result = iam.Grant.addToPrincipal({
      grantee,
      actions: [
        'secretsmanager:DescribeSecret',
        'secretsmanager:GetResourcePolicy',
        'secretsmanager:GetSecretValue',
        'secretsmanager:ListSecretVersionIds',
      ],
      resourceArns: [arn],
      scope: this,
    });
    return result;
  }
}
