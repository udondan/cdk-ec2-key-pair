import {
  CreateSecretCommand,
  CreateSecretCommandInput,
  DeleteSecretCommand,
  DeleteSecretCommandInput,
  GetSecretValueCommand,
  GetSecretValueCommandInput,
  ListSecretsCommand,
  ListSecretsCommandInput,
  ResourceNotFoundException,
  SecretsManagerClient,
  TagResourceCommand,
  TagResourceCommandInput,
  UntagResourceCommand,
  UntagResourceCommandInput,
  UpdateSecretCommand,
  UpdateSecretCommandInput,
} from '@aws-sdk/client-secrets-manager';
import { Logger } from 'aws-cloudformation-custom-resource';
import { Resource, makeTags, removedTags, tagsChanged } from './tags';

const secretsManagerClient = new SecretsManagerClient({});

export type SecretKind = 'private' | 'public';

const secretKinds = {
  private: {
    createLabel: 'Private Key',
    // Updates have always written this spelling to existing secrets.
    updateLabel: 'Private key',
    kms: 'KmsPrivate',
    arnAttribute: 'PrivateKeyARN',
  },
  public: {
    createLabel: 'Public Key',
    updateLabel: 'Public Key',
    kms: 'KmsPublic',
    arnAttribute: 'PublicKeyARN',
  },
} as const;

/**
 * Name of the secret that holds the private or public key
 */
export function secretId(resource: Resource, kind: SecretKind): string {
  return `${resource.properties.SecretPrefix.value}${resource.properties.Name.value}/${kind}`;
}

/**
 * Stores the private key of a created key pair. Imported key pairs have no
 * private key.
 */
export async function createPrivateKeySecret(
  resource: Resource,
  log: Logger,
  keyMaterial: string | undefined,
): Promise<void> {
  log.debug('called function createPrivateKeySecret');
  if (resource.properties.PublicKey.value.length) {
    resource.addResponseValue(secretKinds.private.arnAttribute, '');
    return;
  }
  try {
    await createSecret(resource, log, 'private', keyMaterial);
  } catch (error) {
    log.error('FAILED TO CREATE PRIVATE KEY', error);
    throw error;
  }
}

/**
 * Stores the public key, if requested
 */
export async function createPublicKeySecret(
  resource: Resource,
  log: Logger,
  publicKey: () => Promise<string>,
): Promise<void> {
  log.debug('called function createPublicKeySecret');
  if (resource.properties.StorePublicKey?.value !== 'true') {
    return;
  }
  await createSecret(resource, log, 'public', await publicKey());
}

async function createSecret(
  resource: Resource,
  log: Logger,
  kind: SecretKind,
  secretString: string | undefined,
): Promise<void> {
  const config = secretKinds[kind];
  const params: CreateSecretCommandInput = {
    /* eslint-disable @typescript-eslint/naming-convention */
    Name: secretId(resource, kind),
    Description: `${resource.properties.Description.value} (${config.createLabel})`,
    SecretString: secretString,
    KmsKeyId: resource.properties[config.kms].value,
    Tags: makeTags(resource, resource.properties.Tags.value),
    /* eslint-enable @typescript-eslint/naming-convention */
  };
  log.debug('secretsmanager.createSecret:', JSON.stringify(params, null, 2));
  const result = await secretsManagerClient.send(
    new CreateSecretCommand(params),
  );
  resource.addResponseValue(config.arnAttribute, result.ARN!);
}

/**
 * Updates description, KMS key and tags of the secret
 */
export async function updateKeySecret(
  resource: Resource,
  log: Logger,
  kind: SecretKind,
): Promise<void> {
  const id = secretId(resource, kind);
  await updateSecret(resource, log, kind, id);
  await updateSecretTags(resource, log, id);
}

async function updateSecret(
  resource: Resource,
  log: Logger,
  kind: SecretKind,
  id: string,
): Promise<void> {
  log.debug(`called function updateSecret (${kind})`);
  if (kind === 'public' && !(await secretExists(id, log))) {
    return;
  }
  const config = secretKinds[kind];
  const params: UpdateSecretCommandInput = {
    /* eslint-disable @typescript-eslint/naming-convention */
    SecretId: id,
    Description: `${resource.properties.Description.value} (${config.updateLabel})`,
    KmsKeyId: resource.properties[config.kms].value,
    /* eslint-enable @typescript-eslint/naming-convention */
  };
  log.debug('secretsmanager.updateSecret:', JSON.stringify(params, null, 2));
  const result = await secretsManagerClient.send(
    new UpdateSecretCommand(params),
  );
  resource.addResponseValue(config.arnAttribute, result.ARN!);
}

async function updateSecretTags(
  resource: Resource,
  log: Logger,
  id: string,
): Promise<void> {
  const target = `secret ${id}`;

  log.info(`Attempting to update tags for ${target}`);
  if (!tagsChanged(resource, log, target)) {
    return;
  }
  const tagParams: TagResourceCommandInput = {
    /* eslint-disable @typescript-eslint/naming-convention */
    SecretId: id,
    Tags: makeTags(resource, resource.properties.Tags.value),
    /* eslint-enable @typescript-eslint/naming-convention */
  };
  log.debug('secretsmanager.tagResource:', JSON.stringify(tagParams, null, 2));
  await secretsManagerClient.send(new TagResourceCommand(tagParams));

  log.info(`Attempting to remove some tags for ${target}`);
  const tagsToRemove = removedTags(resource, log, target);
  if (!tagsToRemove.length) {
    return;
  }
  const untagParams: UntagResourceCommandInput = {
    /* eslint-disable @typescript-eslint/naming-convention */
    SecretId: id,
    TagKeys: tagsToRemove.map((tag) => tag.Key),
    /* eslint-enable @typescript-eslint/naming-convention */
  };
  log.debug(
    'secretsmanager.untagResource:',
    JSON.stringify(untagParams, null, 2),
  );
  await secretsManagerClient.send(new UntagResourceCommand(untagParams));
}

export async function getPrivateKey(
  resource: Resource,
  log: Logger,
): Promise<string> {
  log.debug('called function getPrivateKey');
  const params: GetSecretValueCommandInput = {
    /* eslint-disable-next-line @typescript-eslint/naming-convention */
    SecretId: secretId(resource, 'private'),
  };
  log.debug('secretsmanager.getSecretValue:', JSON.stringify(params, null, 2));
  const result = await secretsManagerClient.send(
    new GetSecretValueCommand(params),
  );
  return result.SecretString!;
}

/**
 * Deletes the secret, if it exists
 */
export async function deleteKeySecret(
  resource: Resource,
  log: Logger,
  kind: SecretKind,
): Promise<void> {
  log.debug(`called function deleteKeySecret (${kind})`);
  const id = secretId(resource, kind);
  if (!(await secretExists(id, log))) {
    log.warn(`Secret "${id}" does not exist. Nothing to delete`);
    return;
  }

  const params: DeleteSecretCommandInput = {
    /* eslint-disable-next-line @typescript-eslint/naming-convention */
    SecretId: id,
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
  const result = await secretsManagerClient.send(
    new DeleteSecretCommand(params),
  );
  resource.addResponseValue(secretKinds[kind].arnAttribute, result.ARN!);
}

async function secretExists(name: string, log: Logger): Promise<boolean> {
  log.debug('called function secretExists');
  const params: ListSecretsCommandInput = {
    /* eslint-disable-next-line @typescript-eslint/naming-convention */
    Filters: [{ Key: 'name', Values: [name] }],
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
    }
    throw error;
  }
}
