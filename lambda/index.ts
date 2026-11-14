import { CreateKeyPairCommandOutput, KeyPairInfo } from '@aws-sdk/client-ec2';
import {
  Context,
  CustomResource,
  Event,
  LogLevel,
  Logger,
  StandardLogger,
} from 'aws-cloudformation-custom-resource';
import { parsePrivateKey } from 'sshpk';
import {
  createKeyPair,
  deleteKeyPair,
  updateKeyPair,
  updateKeyPairTags,
} from './key-pair';
import {
  createPrivateKeySecret,
  createPublicKeySecret,
  deleteKeySecret,
  getPrivateKey,
  updateKeySecret,
} from './secrets';
import { Resource } from './tags';
import { PublicKeyFormat, ResourceProperties } from './types';

type KeyPair = CreateKeyPairCommandOutput | KeyPairInfo;

export const handler = async function (
  event: Event<ResourceProperties>,
  context: Context,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const resource = new CustomResource<ResourceProperties>(
      event,
      context,
      (error) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(error));
        } else {
          resolve();
        }
      },
      createResource,
      updateResource,
      deleteResource,
    );

    if (event.ResourceProperties.LogLevel) {
      resource.setLogger(
        new StandardLogger(
          // because jsii is forcing us to expose enums with all capitals and the enum in aws-cloudformation-custom-resource is all lowercase, we need to cast here. Other than the capitalization, the enums are identical
          event.ResourceProperties.LogLevel as unknown as LogLevel,
        ),
      );
    }
  });
};

async function createResource(resource: Resource, log: Logger): Promise<void> {
  log.debug('called function createResource');
  log.info(
    `Attempting to create EC2 Key Pair ${resource.properties.Name.value}`,
  );

  const keyPair = await createKeyPair(resource, log);
  await createPrivateKeySecret(resource, log, keyPair.KeyMaterial);
  await createPublicKeySecret(resource, log, () =>
    publicKey(resource, log, keyPair),
  );
  await exposePublicKey(resource, log, keyPair);
}

async function updateResource(resource: Resource, log: Logger): Promise<void> {
  log.debug('called function updateResource');
  log.info(
    `Attempting to update EC2 Key Pair ${resource.properties.Name.value}`,
  );
  assertUpdatable(resource);

  const keyPair = await updateKeyPair(resource, log);
  await updateKeyPairTags(resource, log, keyPair.KeyPairId!);
  if (!resource.properties.PublicKey.value.length) {
    // in case we imported a public key, there is no private key secret
    await updateKeySecret(resource, log, 'private');
  }
  if (resource.properties.StorePublicKey?.value === 'true') {
    // in case user did not want to store the public key, there is no public key secret
    await updateKeySecret(resource, log, 'public');
  }
  await exposePublicKey(resource, log, keyPair);
}

/**
 * Throws if the update changes a property that a key pair can't change
 */
function assertUpdatable(resource: Resource): void {
  const properties = resource.properties;
  if (properties.Name.changed) {
    throw new Error(
      'A Key Pair cannot be renamed. Please create a new Key Pair instead',
    );
  }
  if (properties.StorePublicKey?.changed) {
    throw new Error(
      'Once created, a key cannot be modified or accessed. Therefore the public key can only be stored, when the key is created.',
    );
  }
  if (properties.PublicKey.changed) {
    throw new Error(
      'You cannot change the public key of an exiting key pair. Please delete the key pair and create a new one.',
    );
  }
  const oldKeyType = resource.event.OldResourceProperties?.KeyType ?? 'rsa'; // we added this feature later, so there might be keys w/o a stored type
  if (resource.event.ResourceProperties.KeyType !== oldKeyType) {
    throw new Error(
      'The type of a key pair cannot be changed. Please create a new key pair instead',
    );
  }
}

async function deleteResource(resource: Resource, log: Logger): Promise<void> {
  log.debug('called function deleteResource');
  log.info(
    `Attempting to delete EC2 Key Pair ${resource.properties.Name.value}`,
  );

  await deleteKeyPair(resource, log);
  await deleteKeySecret(resource, log, 'private');
  await deleteKeySecret(resource, log, 'public');
}

/**
 * The imported public key, or the public key derived from the private key
 */
async function publicKey(
  resource: Resource,
  log: Logger,
  keyPair: KeyPair,
): Promise<string> {
  if (resource.properties.PublicKey.value.length) {
    return resource.properties.PublicKey.value;
  }
  log.debug('called function makePublicKey');
  const keyMaterial =
    (keyPair as CreateKeyPairCommandOutput).KeyMaterial ??
    (await getPrivateKey(resource, log));

  const privateKey = parsePrivateKey(keyMaterial);
  privateKey.comment = resource.properties.Name.value;
  return privateKey
    .toPublic()
    .toString(resource.properties.PublicKeyFormat.value);
}

async function exposePublicKey(
  resource: Resource,
  log: Logger,
  keyPair: KeyPair,
): Promise<void> {
  log.debug('called function exposePublicKey');
  if (resource.properties.ExposePublicKey?.value != 'true') {
    resource.addResponseValue(
      'PublicKeyValue',
      'Not requested - Set ExposePublicKey to true',
    );
    return;
  }
  let value = await publicKey(resource, log, keyPair);
  if (resource.properties.PublicKeyFormat.value === PublicKeyFormat.RFC4253) {
    // CloudFormation cannot deal with binary data, so we need to encode the public key
    value = Buffer.from(value).toString('base64');
  }
  resource.addResponseValue('PublicKeyValue', value);
}
