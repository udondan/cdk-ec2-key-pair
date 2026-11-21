import {
  CreateKeyPairCommand,
  CreateKeyPairCommandInput,
  CreateKeyPairCommandOutput,
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
  KeyPairInfo,
  TagSpecification,
} from '@aws-sdk/client-ec2';
import { ResourceNotFoundException } from '@aws-sdk/client-secrets-manager';
import { Logger } from 'aws-cloudformation-custom-resource';
import { Resource, makeTags, removedTags, tagsChanged } from './tags';

const ec2Client = new EC2Client({});

type KeyPairAttributes = Pick<
  KeyPairInfo,
  'KeyName' | 'KeyPairId' | 'KeyFingerprint'
>;

/**
 * Returns name, ID and fingerprint of the key pair to CloudFormation
 */
function addKeyPairResponse(
  resource: Resource,
  keyPair: KeyPairAttributes,
  fingerprintAttribute: 'KeyFingerprint' | 'KeyPairFingerprint',
): void {
  resource.addResponseValue('KeyPairName', keyPair.KeyName!);
  resource.addResponseValue('KeyPairID', keyPair.KeyPairId!);
  resource.addResponseValue(fingerprintAttribute, keyPair.KeyFingerprint!);
}

/**
 * Imports the given public key or, if there is none, creates a new key pair
 */
export async function createKeyPair(
  resource: Resource,
  log: Logger,
): Promise<CreateKeyPairCommandOutput> {
  log.debug('called function createKeyPair');
  const tagSpecifications: TagSpecification[] = [
    {
      /* eslint-disable @typescript-eslint/naming-convention */
      ResourceType: 'key-pair',
      Tags: makeTags(resource, resource.properties.Tags.value),
      /* eslint-enable @typescript-eslint/naming-convention */
    },
  ];
  if (resource.properties.PublicKey?.value.length) {
    return importKeyPair(resource, log, tagSpecifications);
  }

  const params: CreateKeyPairCommandInput = {
    /* eslint-disable @typescript-eslint/naming-convention */
    KeyName: resource.properties.Name.value,
    KeyType: resource.properties.KeyType.value,
    TagSpecifications: tagSpecifications,
    /* eslint-enable @typescript-eslint/naming-convention */
  };
  log.debug('ec2.createKeyPair:', JSON.stringify(params, null, 2));
  const result = await ec2Client.send(new CreateKeyPairCommand(params));
  addKeyPairResponse(resource, result, 'KeyPairFingerprint');
  return result;
}

async function importKeyPair(
  resource: Resource,
  log: Logger,
  tagSpecifications: TagSpecification[],
): Promise<CreateKeyPairCommandOutput> {
  const params: ImportKeyPairCommandInput = {
    /* eslint-disable @typescript-eslint/naming-convention */
    KeyName: resource.properties.Name.value,
    PublicKeyMaterial: Buffer.from(resource.properties.PublicKey.value),
    TagSpecifications: tagSpecifications,
    /* eslint-enable @typescript-eslint/naming-convention */
  };
  log.debug('ec2.importKeyPair:', JSON.stringify(params, null, 2));
  try {
    const result = await ec2Client.send(new ImportKeyPairCommand(params));
    log.debug('Import successful', JSON.stringify(result, null, 2));
    addKeyPairResponse(resource, result, 'KeyFingerprint');
    return result;
  } catch (error) {
    log.error('Import failed', error);
    throw error;
  }
}

/**
 * A key pair can't be changed. This only looks up the key pair to return its
 * attributes.
 */
export async function updateKeyPair(
  resource: Resource,
  log: Logger,
): Promise<KeyPairInfo> {
  log.debug('called function updateKeyPair');
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
  addKeyPairResponse(resource, keyPair, 'KeyPairFingerprint');
  return keyPair;
}

/**
 * Adds and removes tags of the key pair to match the resource properties
 */
export async function updateKeyPairTags(
  resource: Resource,
  log: Logger,
  keyPairId: string,
): Promise<void> {
  const target = `Key Pair ${resource.properties.Name.value}`;

  log.info(`Attempting to update tags for ${target}`);
  if (!tagsChanged(resource, log, target)) {
    return;
  }
  const createParams: CreateTagsCommandInput = {
    /* eslint-disable @typescript-eslint/naming-convention */
    Resources: [keyPairId],
    Tags: makeTags(resource, resource.properties.Tags.value),
    /* eslint-enable @typescript-eslint/naming-convention */
  };
  log.debug('ec2.createTags:', JSON.stringify(createParams, null, 2));
  await ec2Client.send(new CreateTagsCommand(createParams));

  log.info(`Attempting to remove some tags for ${target}`);
  const tagsToRemove = removedTags(resource, log, target);
  if (!tagsToRemove.length) {
    return;
  }
  const deleteParams: DeleteTagsCommandInput = {
    /* eslint-disable @typescript-eslint/naming-convention */
    Resources: [keyPairId],
    Tags: tagsToRemove,
    /* eslint-enable @typescript-eslint/naming-convention */
  };
  log.debug('ec2.deleteTags:', JSON.stringify(deleteParams, null, 2));
  await ec2Client.send(new DeleteTagsCommand(deleteParams));
}

export async function deleteKeyPair(
  resource: Resource,
  log: Logger,
): Promise<void> {
  log.debug('called function deleteKeyPair');
  const keyPairName = resource.properties.Name.value;
  if (!(await keyPairExists(keyPairName, log))) {
    log.warn(`Key Pair "${keyPairName}" does not exist. Nothing to delete`);
    return;
  }
  const params: DeleteKeyPairCommandInput = {
    /* eslint-disable-next-line @typescript-eslint/naming-convention */
    KeyName: keyPairName,
  };
  log.debug('ec2.deleteKeyPair:', JSON.stringify(params, null, 2));
  await ec2Client.send(new DeleteKeyPairCommand(params));
}

async function keyPairExists(name: string, log: Logger): Promise<boolean> {
  log.debug('called function keyPairExists');
  const params: DescribeKeyPairsCommandInput = {
    /* eslint-disable-next-line @typescript-eslint/naming-convention */
    KeyNames: [name],
  };
  log.debug('ec2.describeKeyPairs:', JSON.stringify(params, null, 2));
  try {
    const result = await ec2Client.send(new DescribeKeyPairsCommand(params));
    return (result.KeyPairs?.length ?? 0) > 0;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'InvalidKeyPair.NotFound') ||
    error instanceof ResourceNotFoundException
  );
}
