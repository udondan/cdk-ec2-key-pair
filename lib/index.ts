import cfn = require('@aws-cdk/aws-cloudformation');
import iam = require('@aws-cdk/aws-iam');
import kms = require('@aws-cdk/aws-kms');
import lambda = require('@aws-cdk/aws-lambda');
import cdk = require('@aws-cdk/core');
import path = require('path');

const resourceType = 'Custom::EC2-Key-Pair';
const ID = `CFN::Resource::${resourceType}`;
const cleanID = ID.replace(/:+/g, '-');
const lambdaTimeout = 3; // minutes

export enum KeyLength {
    L2048 = 2048,
    L4096 = 4096,
}

/**
* Definition of EC2 Key Pair
*/
export interface KeyPairProps extends cdk.ResourceProps {

    /**
    * Name of the Key Pair
    *
    * In AWS Secrets Manager the key will be prefixed with `ec2-private-key/`.
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
    * Number of bits in the key. Valid options are 2048 and 4096
    *
    * @default - 2048
    */
    readonly keyLength?: KeyLength;

    /**
    * The KMS key to use to encrypt the private key with
    *
    * This needs to be a key created in the same stack. You cannot use a key imported via ARN.
    *
    * @default - `alias/aws/secretsmanager`
    */
    readonly kms?: kms.Key;

    /**
    * Tags that will be applied to the private key in the AWS Secrets Manager
    *
    * EC2 Key Pairs themselves don't support tags
    *
    * @default - `alias/aws/secretsmanager`
    */
    readonly tags?: {
        [key: string]: string;
    };

    /**
    * When the resource is destroyed, after how many days the private key in the AWS Secrets Manager should be deleted.
    *
    * Valid values are 0 and 7 to 30
    *
    * @default 0
    */
    readonly removePrivateKeyAfterDays?: number;

    /**
    * Prefix for the secret in AWS Secrets Manager.
    *
    * @default `ec2-private-key/`
    */
    readonly secretPrefix?: string;
}

/**
* An EC2 Key Pair
*/
export class KeyPair extends cdk.Construct {

    /**
    * ARN of the private key in AWS Secrets Manager
    */
    public readonly arn: string = '';

    /**
    * Name of the Key Pair
    */
    public readonly name: string = '';

    /**
    * Defines a new EC2 Key Pair. The private key will be stored in AWS Secrets Manager
    */
    constructor(scope: cdk.Construct, id: string, props: KeyPairProps) {
        super(scope, id);

        if (props.removePrivateKeyAfterDays && (
            props.removePrivateKeyAfterDays < 0 ||
            props.removePrivateKeyAfterDays > 0 && props.removePrivateKeyAfterDays < 7 ||
            props.removePrivateKeyAfterDays > 30)) {
            scope.node.addError(`Parameter removePrivateKeyAfterDays must be 0 or between 7 and 30. Got ${props.removePrivateKeyAfterDays}`);
        }

        const stack = cdk.Stack.of(this).stackName;
        const fn = this.ensureLambda();

        const tags = props.tags || {};
        tags.CreatedBy = ID;

        const key = new cfn.CustomResource(this, `EC2-Key-Pair-${props.name}`, {
            provider: cfn.CustomResourceProvider.fromLambda(fn),
            resourceType: resourceType,
            properties: {
                Name: props.name,
                Description: props.description || '',
                KeyLength: props.keyLength || KeyLength.L2048,
                Kms: props.kms?.keyArn || 'alias/aws/secretsmanager',
                RemovePrivateKeyAfterDays: props.removePrivateKeyAfterDays || 0,
                SecretPrefix: props.secretPrefix || 'ec2-private-key/',
                StackName: stack,
                Tags: tags,
            },
        });

        if (typeof props.kms !== 'undefined') {
            props.kms.grantEncryptDecrypt(fn.role!);
            key.node.addDependency(props.kms);
            key.node.addDependency(fn.role!);
        }

        this.arn = key.getAttString('PrivateKeyARN');
        this.name = key.getAttString('KeyPairName');
    }

    private ensureLambda(): lambda.Function {
        const stack = cdk.Stack.of(this);
        const constructName = 'EC2-Key-Name-Manager-Lambda';
        const existing = stack.node.tryFindChild(constructName);
        if (existing) {
            return existing as lambda.Function;
        }

        const policy = new iam.ManagedPolicy(stack, 'EC2-Key-Pair-Manager-Policy', {
            managedPolicyName: `${stack.stackName}-${cleanID}`,
            description: `Used by Lambda ${cleanID}, which is a custom CFN resource, managing EC2 Key Pairs`,
            statements: [
                new iam.PolicyStatement({
                    actions: [
                        'ec2:CreateKeyPair',
                        'ec2:DeleteKeyPair',
                        'ec2:DescribeKeyPairs',
                        'secretsmanager:ListSecrets',
                    ],
                    resources: ['*'],
                }),
                new iam.PolicyStatement({
                    actions: [
                        'secretsmanager:CreateSecret',
                        'secretsmanager:TagResource',
                    ],
                    resources: ['*'],
                    conditions: {
                        StringEquals: {
                            'aws:RequestTag/CreatedBy': ID,
                        }
                    },
                }),
                new iam.PolicyStatement({
                    actions: [
                        'secretsmanager:DeleteResourcePolicy',
                        'secretsmanager:DeleteSecret',
                        'secretsmanager:DescribeSecret',
                        'secretsmanager:GetResourcePolicy',
                        'secretsmanager:ListSecretVersionIds',
                        'secretsmanager:PutResourcePolicy',
                        'secretsmanager:PutSecretValue',
                        'secretsmanager:RestoreSecret',
                        'secretsmanager:UntagResource',
                        'secretsmanager:UpdateSecret',
                        'secretsmanager:UpdateSecretVersionStage',
                    ],
                    resources: ['*'],
                    conditions: {
                        StringEquals: {
                            'aws:ResourceTag/CreatedBy': ID,
                        }
                    },
                }),
            ],
        });

        const role = new iam.Role(stack, 'EC2-Key-Pair-Manager-Role', {
            roleName: `${stack.stackName}-${cleanID}`,
            description: `Used by Lambda ${cleanID}, which is a custom CFN resource, managing EC2 Key Pairs`,
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                policy,
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            ]
        });

        const fn = new lambda.Function(stack, constructName, {
            functionName: `${stack.stackName}-${cleanID}`,
            role: role,
            description: 'Custom CFN resource: Manage EC2 Key Pairs',
            runtime: lambda.Runtime.NODEJS_10_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/code.zip')),
            timeout: cdk.Duration.minutes(lambdaTimeout)
        });

        return fn;
    }

    /**
    * Grants read access to the private key in AWS Secrets Manager
    */
    grantRead(grantee: iam.IGrantable) {
        const result = iam.Grant.addToPrincipal({
            grantee,
            actions: [
                'secretsmanager:DescribeSecret',
                'secretsmanager:GetResourcePolicy',
                'secretsmanager:GetSecretValue',
                'secretsmanager:ListSecretVersionIds',
            ],
            resourceArns: [this.arn],
            scope: this
        });
        return result;
    }
}
