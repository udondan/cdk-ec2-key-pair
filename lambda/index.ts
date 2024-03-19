import {
  CreateKeyPairCommand,
  CreateKeyPairCommandInput,
  CreateTagsCommand,
  CreateTagsCommandInput,
  DeleteKeyPairCommand,
  DeleteKeyPairCommandInput,
  DeleteTagsCommand,
  DeleteTagsCommandInput,
  DescribeKeyPairsCommand,
  DescribeKeyPairsCommandInput,
  EC2Client,
  ImportKeyPairCommand,
  ImportKeyPairCommandInput,
  Tag as Ec2Tag,
  CreateKeyPairCommandOutput,
  KeyPairInfo,
} from '@aws-sdk/client-ec2';
import {
  CreateSecretCommand,
  CreateSecretCommandInput,
  DeleteSecretCommand,
  DeleteSecretCommandInput,
  DeleteSecretCommandOutput,
  GetSecretValueCommand,
  GetSecretValueCommandInput,
  ListSecretsCommand,
  ListSecretsCommandInput,
  ResourceNotFoundException,
  SecretsManagerClient,
  Tag as SecretManagerTag,
  TagResourceCommand,
  TagResourceCommandInput,
  UntagResourceCommand,
  UntagResourceCommandInput,
  UpdateSecretCommand,
  UpdateSecretCommandInput,
} from '@aws-sdk/client-secrets-manager';
import {
  Context,
  Callback,
  CustomResource,
  Event,
  Logger,
} from 'aws-cloudformation-custom-resource';
import * as forge from 'node-forge';
import { PublicKeyFormat } from '../lib/index';

export interface ResourceProperties {
  /* eslint-disable @typescript-eslint/naming-convention */
  Name: string;
  StorePublicKey?: 'true' | 'false'; // props passed via lambda always are of type string
  ExposePublicKey?: 'true' | 'false';
  PublicKey: string;
  SecretPrefix: string;
  Description: string;
  KmsPrivate: string;
  KmsPublic: string;
  PublicKeyFormat: PublicKeyFormat;
  RemoveKeySecretsAfterDays: number;
  StackName: string;
  Tags: Record<string, string>;
  /* eslint-enable @typescript-eslint/naming-convention */
}

const ec2Client = new EC2Client({});
const secretsManagerClient = new SecretsManagerClient({});
export const handler = function (
  event: Event<ResourceProperties>,
  context: Context,
  callback: Callback,
) {
  new CustomResource<ResourceProperties>(
    event,
    context,
    callback,
    createResource,
    updateResource,
    deleteResource,
  );
};

async function createResource(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<void> {
  log.debug('called function createResource');
  log.info(
    `Attempting to create EC2 Key Pair ${resource.properties.Name.value}`,
  );

  const keyPair = await createKeyPair(resource, log);
  await createPrivateKeySecret(resource, keyPair, log);
  await createPublicKeySecret(resource, log, keyPair);
  await exposePublicKey(resource, log, keyPair);
}

async function updateResource(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<void> {
  log.debug('called function updateResource');
  log.info(
    `Attempting to update EC2 Key Pair ${resource.properties.Name.value}`,
  );

  if (resource.properties.Name.changed) {
    throw new Error(
      'A Key Pair cannot be renamed. Please create a new Key Pair instead',
    );
  } else if (resource.properties.StorePublicKey?.changed) {
    throw new Error(
      'Once created, a key cannot be modified or accessed. Therefore the public key can only be stored, when the key is created.',
    );
  } else if (resource.properties.PublicKey.changed) {
    throw new Error(
      'You cannot change the public key of an exiting key pair. Please delete the key pair and create a new one.',
    );
  }

  const keyPair = await updateKeyPair(resource, log);
  await updateKeyPairAddTags(resource, log, keyPair.KeyPairId!);
  await updateKeyPairRemoveTags(resource, log, keyPair.KeyPairId!);
  if (!resource.properties.PublicKey.value.length) {
    // in case we imported a public key, there is no private key secret
    const secretId = `${resource.properties.SecretPrefix.value}${resource.properties.Name.value}/private`;
    await updatePrivateKeySecret(resource, log);
    await updateSecretAddTags(resource, log, secretId);
    await updateSecretRemoveTags(resource, log, secretId);
  }
  if (resource.properties.StorePublicKey?.value === 'true') {
    // in case user did not want to store the public key, there is no public key secret
    const secretId = `${resource.properties.SecretPrefix.value}${resource.properties.Name.value}/public`;
    await updatePublicKeySecret(resource, log);
    await updateSecretAddTags(resource, log, secretId);
    await updateSecretRemoveTags(resource, log, secretId);
  }
  await exposePublicKey(resource, log, keyPair);
}

async function deleteResource(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<void> {
  log.debug('called function deleteResource');
  log.info(
    `Attempting to delete EC2 Key Pair ${resource.properties.Name.value}`,
  );

  await deleteKeyPair(resource, log);
  await deletePrivateKeySecret(resource, log);
  await deletePublicKeySecret(resource, log);
}

async function createKeyPair(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<CreateKeyPairCommandOutput> {
  log.debug('called function createKeyPair');
  if (
    // public key provided, let's import
    resource.properties.PublicKey?.value.length
  ) {
    const params: ImportKeyPairCommandInput = {
      /* eslint-disable @typescript-eslint/naming-convention */
      KeyName: resource.properties.Name.value,
      PublicKeyMaterial: Buffer.from(resource.properties.PublicKey.value),
      TagSpecifications: [
        {
          ResourceType: 'key-pair',
          Tags: makeTags(resource, resource.properties.Tags.value) as Ec2Tag[],
        },
      ],
      /* eslint-enable @typescript-eslint/naming-convention */
    };
    log.debug('ec2.importKeyPair:', JSON.stringify(params, null, 2));
    try {
      const result = await ec2Client.send(new ImportKeyPairCommand(params));
      log.debug('Import successful', JSON.stringify(result, null, 2));
      resource.addResponseValue('KeyPairName', result.KeyName!);
      resource.addResponseValue('KeyPairID', result.KeyPairId!);
      return result;
    } catch (error) {
      log.error('Import failed', error);
      throw error;
    }
  } else {
    // no public key provided. create new key
    const params: CreateKeyPairCommandInput = {
      /* eslint-disable @typescript-eslint/naming-convention */
      KeyName: resource.properties.Name.value,
      TagSpecifications: [
        {
          ResourceType: 'key-pair',
          Tags: makeTags(resource, resource.properties.Tags.value) as Ec2Tag[],
        },
      ],
      /* eslint-enable @typescript-eslint/naming-convention */
    };
    log.debug('ec2.createKeyPair:', JSON.stringify(params, null, 2));
    const result = await ec2Client.send(new CreateKeyPairCommand(params));
    resource.addResponseValue('KeyPairName', result.KeyName!);
    resource.addResponseValue('KeyPairID', result.KeyPairId!);
    return result;
  }
}

async function updateKeyPair(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<KeyPairInfo> {
  log.debug('called function updateKeyPair');

  // there is nothing to update. a key cannot be changed
  // though we use this step to enrich the event with the keyId
  const params: DescribeKeyPairsCommandInput = {
    /* eslint-disable-next-line @typescript-eslint/naming-convention */
    KeyNames: [resource.properties.Name.value],
  };
  log.debug('ec2.describeKeyPairs:', JSON.stringify(params, null, 2));
  const result = await ec2Client.send(new DescribeKeyPairsCommand(params));

  if (result.KeyPairs?.length != 1) {
    throw new Error('Key pair was not found');
  }

  const keyPair = result.KeyPairs[0];
  const keyPairId = keyPair.KeyPairId!;
  const keyPairName = keyPair.KeyName!;

  resource.addResponseValue('KeyPairName', keyPairName);
  resource.addResponseValue('KeyPairID', keyPairId);
  return keyPair;
}

async function updateKeyPairAddTags(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
  keyPairId: string,
): Promise<void> {
  log.debug('called function updateKeyPairAddTags');
  log.info(
    `Attempting to update tags for Key Pair ${resource.properties.Name.value}`,
  );

  if (!resource.properties.Tags.changed) {
    log.info(
      `No changes of tags detected for Key Pair ${resource.properties.Name.value}. Not attempting any update`,
    );
    return;
  }

  const params: CreateTagsCommandInput = {
    /* eslint-disable @typescript-eslint/naming-convention */
    Resources: [keyPairId],
    Tags: makeTags(resource, resource.properties.Tags.value),
    /* eslint-enable @typescript-eslint/naming-convention */
  };
  log.debug('ec2.createTags:', JSON.stringify(params, null, 2));
  await ec2Client.send(new CreateTagsCommand(params));
}

async function updateKeyPairRemoveTags(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
  keyPairId: string,
): Promise<void> {
  log.debug('called function updateKeyPairRemoveTags');
  log.info(
    `Attempting to remove some tags for Key Pair ${resource.properties.Name.value}`,
  );

  if (!resource.properties.Tags.changed) {
    log.info(
      `No changes of tags detected for Key Pair ${resource.properties.Name.value}. Not attempting any update`,
    );
    return;
  }

  const oldTags = makeTags(resource, resource.properties.Tags.before);
  const newTags = makeTags(resource, resource.properties.Tags.value);
  const tagsToRemove = getMissingTags(oldTags, newTags);
  if (!tagsToRemove.length) {
    log.info(
      `No changes of tags detected for Key Pair ${resource.properties.Name.value}. Not attempting any update`,
    );
    return;
  }

  log.info(
    'Will remove the following tags:',
    JSON.stringify(tagsToRemove, null, 2),
  );
  const params: DeleteTagsCommandInput = {
    /* eslint-disable @typescript-eslint/naming-convention */
    Resources: [keyPairId],
    Tags: tagsToRemove.map((key) => {
      return {
        Key: key,
        Value: resource.properties.Tags.before![key],
      } as Ec2Tag;
    }),
    /* eslint-enable @typescript-eslint/naming-convention */
  };
  log.debug('ec2.deleteTags:', JSON.stringify(params, null, 2));
  await ec2Client.send(new DeleteTagsCommand(params));
}

async function deleteKeyPair(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<void> {
  log.debug('called function deleteKeyPair');
  const params: DeleteKeyPairCommandInput = {
    /* eslint-disable-next-line @typescript-eslint/naming-convention */
    KeyName: resource.properties.Name.value,
  };
  log.debug('ec2.deleteKeyPair:', JSON.stringify(params, null, 2));
  await ec2Client.send(new DeleteKeyPairCommand(params));
  resource.addResponseValue('KeyPairName', resource.properties.Name.value);
}

async function createPrivateKeySecret(
  resource: CustomResource<ResourceProperties>,
  keyPair: CreateKeyPairCommandOutput,
  log: Logger,
): Promise<void> {
  log.debug('called function createPrivateKeySecret');
  if (resource.properties.PublicKey.value.length) {
    resource.addResponseValue('PrivateKeyARN', '');
    return;
  }

  try {
    const params: CreateSecretCommandInput = {
      /* eslint-disable @typescript-eslint/naming-convention */
      Name: `${resource.properties.SecretPrefix.value}${resource.properties.Name.value}/private`,
      Description: `${resource.properties.Description.value} (Private Key)`,
      SecretString: keyPair.KeyMaterial,
      KmsKeyId: resource.properties.KmsPrivate.value,
      Tags: makeTags(resource, resource.properties.Tags.value),
      /* eslint-enable @typescript-eslint/naming-convention */
    };
    log.debug('secretsmanager.createSecret:', JSON.stringify(params, null, 2));
    const result = await secretsManagerClient.send(
      new CreateSecretCommand(params),
    );
    resource.addResponseValue('PrivateKeyARN', result.ARN!);
  } catch (error) {
    log.error('FAILED TO CREATE PRIVATE KEY', error);
    throw error;
  }
}

async function createPublicKeySecret(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
  keyPair: CreateKeyPairCommandOutput,
): Promise<void> {
  log.debug('called function createPublicKeySecret');

  let publicKey: string;
  if (resource.properties.PublicKey.value.length)
    publicKey = resource.properties.PublicKey.value;
  else {
    publicKey = await makePublicKey(resource, log, keyPair);
  }

  if (resource.properties.StorePublicKey?.value !== 'true') {
    return;
  }

  const params: CreateSecretCommandInput = {
    /* eslint-disable @typescript-eslint/naming-convention */
    Name: `${resource.properties.SecretPrefix.value}${resource.properties.Name.value}/public`,
    Description: `${resource.properties.Description.value} (Public Key)`,
    SecretString: publicKey,
    KmsKeyId: resource.properties.KmsPublic.value,
    Tags: makeTags(resource, resource.properties.Tags.value),
    /* eslint-enable @typescript-eslint/naming-convention */
  };
  log.debug('secretsmanager.createSecret:', JSON.stringify(params, null, 2));
  const result = await secretsManagerClient.send(
    new CreateSecretCommand(params),
  );
  resource.addResponseValue('PublicKeyARN', result.ARN!);
}

async function updatePrivateKeySecret(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<void> {
  log.debug('called function updatePrivateKeySecret');
  const params: UpdateSecretCommandInput = {
    /* eslint-disable @typescript-eslint/naming-convention */
    SecretId: `${resource.properties.SecretPrefix.value}${resource.properties.Name.value}/private`,
    Description: `${resource.properties.Description.value} (Private key)`,
    KmsKeyId: resource.properties.KmsPrivate.value,
    /* eslint-enable @typescript-eslint/naming-convention */
  };
  log.debug('secretsmanager.updateSecret:', JSON.stringify(params, null, 2));
  const result = await secretsManagerClient.send(
    new UpdateSecretCommand(params),
  );
  resource.addResponseValue('PrivateKeyARN', result.ARN!);
}

async function updatePublicKeySecret(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<void> {
  log.debug('called function updatePublicKeySecret');
  const arn = `${resource.properties.SecretPrefix.value}${resource.properties.Name.value}/public`;
  if (!(await secretExists(arn, log))) {
    return;
  }

  const params: UpdateSecretCommandInput = {
    /* eslint-disable @typescript-eslint/naming-convention */
    SecretId: arn,
    Description: `${resource.properties.Description.value} (Public Key)`,
    KmsKeyId: resource.properties.KmsPublic.value,
    /* eslint-enable @typescript-eslint/naming-convention */
  };
  log.debug('secretsmanager.updateSecret:', JSON.stringify(params, null, 2));
  const data = await secretsManagerClient.send(new UpdateSecretCommand(params));
  resource.addResponseValue('PublicKeyARN', data.ARN!);
}

async function updateSecretAddTags(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
  secretId: string,
): Promise<void> {
  log.debug('called function updateSecretAddTags');
  log.info(`Attempting to update tags for secret ${secretId}`);
  if (!resource.properties.Tags.changed) {
    log.info(
      `No changes of tags detected for secret ${secretId}. Not attempting any update`,
    );
    return;
  }
  const params: TagResourceCommandInput = {
    /* eslint-disable @typescript-eslint/naming-convention */
    SecretId: secretId,
    Tags: makeTags(resource, resource.properties.Tags.value),
    /* eslint-enable @typescript-eslint/naming-convention */
  };
  log.debug('secretsmanager.tagResource:', JSON.stringify(params, null, 2));
  await secretsManagerClient.send(new TagResourceCommand(params));
}

async function getPrivateKey(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<string> {
  log.debug('called function getPrivateKey');
  const params: GetSecretValueCommandInput = {
    /* eslint-disable-next-line @typescript-eslint/naming-convention */
    SecretId: `${resource.properties.SecretPrefix.value}${resource.properties.Name.value}/private`,
  };
  log.debug('secretsmanager.getSecretValue:', JSON.stringify(params, null, 2));
  const result = await secretsManagerClient.send(
    new GetSecretValueCommand(params),
  );
  return result.SecretString!;
}

async function makePublicKey(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
  keyPair: CreateKeyPairCommandOutput | KeyPairInfo,
): Promise<string> {
  log.debug('called function makePublicKey');

  const keyMaterial =
    (keyPair as CreateKeyPairCommandOutput).KeyMaterial ??
    (await getPrivateKey(resource, log));

  const privateKey = forge.pki.privateKeyFromPem(keyMaterial);
  const forgePublicKey = forge.pki.rsa.setPublicKey(privateKey.n, privateKey.e);

  const publicKeyFormat = resource.properties.PublicKeyFormat.value;
  switch (publicKeyFormat) {
    case PublicKeyFormat.PEM:
      return forge.pki.publicKeyToPem(forgePublicKey);
    case PublicKeyFormat.OPENSSH:
      return forge.ssh.publicKeyToOpenSSH(forgePublicKey);
    default:
      throw new Error(
        `Unsupported public key format ${publicKeyFormat as string}`,
      );
  }
}

async function exposePublicKey(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
  keyPair: CreateKeyPairCommandOutput | KeyPairInfo,
): Promise<void> {
  log.debug('called function exposePublicKey');
  if (resource.properties.ExposePublicKey?.value == 'true') {
    let publicKey: string;
    if (resource.properties.PublicKey.value.length) {
      publicKey = resource.properties.PublicKey.value;
    } else {
      publicKey = await makePublicKey(resource, log, keyPair);
    }
    resource.addResponseValue('PublicKeyValue', publicKey);
  } else {
    resource.addResponseValue(
      'PublicKeyValue',
      'Not requested - Set ExposePublicKey to true',
    );
  }
}

async function updateSecretRemoveTags(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
  secretId: string,
): Promise<void> {
  log.debug('called function updateSecretRemoveTags');
  log.info(`Attempting to remove some tags for secret ${secretId}`);
  if (!resource.properties.Tags.changed) {
    log.info(
      `No changes of tags detected for secret ${secretId}. Not attempting any update`,
    );
    return;
  }

  const oldTags = makeTags(resource, resource.properties.Tags.before);
  const newTags = makeTags(resource, resource.properties.Tags.value);
  const tagsToRemove = getMissingTags(oldTags, newTags);
  if (!tagsToRemove.length) {
    log.info(
      `No changes of tags detected for secret ${secretId}. Not attempting any update`,
    );
    return;
  }

  log.info(
    'Will remove the following tags:',
    JSON.stringify(tagsToRemove, null, 2),
  );
  const params: UntagResourceCommandInput = {
    /* eslint-disable @typescript-eslint/naming-convention */
    SecretId: secretId,
    TagKeys: tagsToRemove,
    /* eslint-enable @typescript-eslint/naming-convention */
  };
  log.debug('secretsmanager.untagResource:', JSON.stringify(params, null, 2));
  await secretsManagerClient.send(new UntagResourceCommand(params));
}

async function deletePrivateKeySecret(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<void> {
  log.debug('called function deletePrivateKeySecret');
  const arn = `${resource.properties.SecretPrefix.value}${resource.properties.Name.value}/private`;
  if (!(await secretExists(arn, log))) {
    return;
  }
  const result = await deleteSecret(resource, log, arn);
  resource.addResponseValue('PrivateKeyARN', result.ARN!);
}

async function deletePublicKeySecret(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<void> {
  log.debug('called function deletePublicKeySecret');
  const arn = `${resource.properties.SecretPrefix.value}${resource.properties.Name.value}/public`;
  if (!(await secretExists(arn, log))) {
    return;
  }
  const result = await deleteSecret(resource, log, arn);
  resource.addResponseValue('PublicKeyARN', result.ARN!);
}

async function secretExists(name: string, log: Logger): Promise<boolean> {
  log.debug('called function secretExists');
  const params: ListSecretsCommandInput = {
    /* eslint-disable @typescript-eslint/naming-convention */
    Filters: [
      {
        Key: 'name',
        Values: [name],
      },
    ],
    /* eslint-enable @typescript-eslint/naming-convention */
  };
  log.debug('secretsmanager.listSecrets:', JSON.stringify(params, null, 2));
  try {
    const result = await secretsManagerClient.send(
      new ListSecretsCommand(params),
    );
    return (result.SecretList?.length ?? 0) > 0;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      return false;
    } else {
      throw error;
    }
  }
}

function deleteSecret(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
  secretId: string,
): Promise<DeleteSecretCommandOutput> {
  log.debug('called function deleteSecret');
  const params: DeleteSecretCommandInput = {
    /* eslint-disable-next-line @typescript-eslint/naming-convention */
    SecretId: secretId,
  };

  const removeKeySecretsAfterDays = parseInt(
    String(resource.properties.RemoveKeySecretsAfterDays.value),
  );

  if (removeKeySecretsAfterDays > 0) {
    params.RecoveryWindowInDays = removeKeySecretsAfterDays;
  } else {
    params.ForceDeleteWithoutRecovery = true;
  }

  log.debug('secretsmanager.deleteSecret:', JSON.stringify(params, null, 2));
  return secretsManagerClient.send(new DeleteSecretCommand(params));
}

function makeTags(
  resource: CustomResource<ResourceProperties>,
  eventTags?: Record<string, string>,
): SecretManagerTag[] {
  const tags: SecretManagerTag[] = [
    /* eslint-disable @typescript-eslint/naming-convention */
    {
      Key: 'aws-cloudformation:stack-id',
      Value: resource.event.StackId,
    },
    {
      Key: 'aws-cloudformation:stack-name',
      Value: resource.properties.StackName.value,
    },
    {
      Key: 'aws-cloudformation:logical-id',
      Value: resource.event.LogicalResourceId,
    },
    /* eslint-enable @typescript-eslint/naming-convention */
  ];
  if (eventTags && Object.keys(eventTags).length) {
    Object.keys(eventTags).forEach(function (key: string) {
      tags.push({
        /* eslint-disable @typescript-eslint/naming-convention */
        Key: key,
        Value: eventTags[key],
        /* eslint-enable @typescript-eslint/naming-convention */
      });
    });
  }
  return tags;
}

function getMissingTags(
  oldTags: SecretManagerTag[],
  newTags: SecretManagerTag[],
): string[] {
  const missing = oldTags.filter(missingTags(newTags));
  return missing.map(function (tag: SecretManagerTag) {
    return tag.Key!;
  });
}

function missingTags(newTags: SecretManagerTag[]) {
  return (currentTag: SecretManagerTag) => {
    return (
      newTags.filter((newTag: SecretManagerTag) => {
        return newTag.Key == currentTag.Key;
      }).length == 0
    );
  };
}
