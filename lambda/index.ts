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

function createResource(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<void> {
  log.debug('called function createResource');
  log.info(`Attempting to create EC2 Key Pair ${resource.properties.Name}`);
  return new Promise(async function (resolve, reject) {
    try {
      const keyPair = await createKeyPair(resource, log);
      await createPrivateKeySecret(resource, keyPair, log);
      await createPublicKeySecret(resource, log, keyPair);
      await exposePublicKey(resource, log, keyPair);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

function updateResource(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<void> {
  log.debug('called function updateResource');
  log.info(
    `Attempting to update EC2 Key Pair ${resource.properties.Name.value}`,
  );
  return new Promise(async function (resolve, reject) {
    if (resource.properties.Name.changed) {
      reject(
        new Error(
          'A Key Pair cannot be renamed. Please create a new Key Pair instead',
        ),
      );
    } else if (resource.properties.StorePublicKey?.changed) {
      reject(
        new Error(
          'Once created, a key cannot be modified or accessed. Therefore the public key can only be stored, when the key is created.',
        ),
      );
    } else if (resource.properties.PublicKey.changed) {
      reject(
        new Error(
          'You cannot change the public key of an exiting key pair. Please delete the key pair and create a new one.',
        ),
      );
    }

    try {
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
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

function deleteResource(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<void> {
  log.debug('called function deleteResource');
  log.info(`Attempting to delete EC2 Key Pair ${resource.properties.Name}`);
  return new Promise(async function (resolve, reject) {
    try {
      await deleteKeyPair(resource, log);
      await deletePrivateKeySecret(resource, log);
      await deletePublicKeySecret(resource, log);
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

function createKeyPair(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<CreateKeyPairCommandOutput> {
  log.debug('called function createKeyPair');
  return new Promise(function (resolve, reject) {
    if (
      // public key provided, let's import
      resource.properties.PublicKey &&
      resource.properties.PublicKey.value.length
    ) {
      const params: ImportKeyPairCommandInput = {
        KeyName: resource.properties.Name.value,
        PublicKeyMaterial: Buffer.from(resource.properties.PublicKey.value),
        TagSpecifications: [
          {
            ResourceType: 'key-pair',
            Tags: makeTags(
              resource,
              resource.properties.Tags.value,
            ) as Ec2Tag[],
          },
        ],
      };
      log.debug(`ec2.importKeyPair: ${JSON.stringify(params)}`);
      ec2Client
        .send(new ImportKeyPairCommand(params))
        .then((data) => {
          log.debug('Import successful', JSON.stringify(data, null, 2));
          resource.addResponseValue('KeyPairName', data.KeyName!);
          resource.addResponseValue('KeyPairID', data.KeyPairId!);
          resolve(data);
        })
        .catch((err) => {
          log.error('Import failed', err);
          reject(err);
        });
    } else {
      // no public key provided. create new key
      const params: CreateKeyPairCommandInput = {
        KeyName: resource.properties.Name.value,
        TagSpecifications: [
          {
            ResourceType: 'key-pair',
            Tags: makeTags(
              resource,
              resource.properties.Tags.value,
            ) as Ec2Tag[],
          },
        ],
      };
      log.debug(`ec2.createKeyPair: ${JSON.stringify(params)}`);
      ec2Client
        .send(new CreateKeyPairCommand(params))
        .then((data) => {
          resource.addResponseValue('KeyPairName', data.KeyName!);
          resource.addResponseValue('KeyPairID', data.KeyPairId!);
          resolve(data);
        })
        .catch((err) => {
          reject(err);
        });
    }
  });
}

function updateKeyPair(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<KeyPairInfo> {
  log.debug('called function updateKeyPair');
  return new Promise(function (resolve, reject) {
    // there is nothing to update. a key cannot be changed
    // though we use this step to enrich the event with the keyId
    const params: DescribeKeyPairsCommandInput = {
      KeyNames: [resource.properties.Name.value],
    };
    log.debug(`ec2.describeKeyPairs: ${JSON.stringify(params)}`);
    ec2Client
      .send(new DescribeKeyPairsCommand(params))
      .then((data) => {
        if (data.KeyPairs?.length != 1)
          return reject(new Error('Key pair was not found'));
        const keyPair = data.KeyPairs[0];
        const keyPairId = keyPair.KeyPairId!;
        const keyPairName = keyPair.KeyName!;

        resource.addResponseValue('KeyPairName', keyPairName);
        resource.addResponseValue('KeyPairID', keyPairId);
        resolve(keyPair);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

function updateKeyPairAddTags(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
  keyPairId: string,
): Promise<void> {
  log.debug('called function updateKeyPairAddTags');
  log.info(
    `Attempting to update tags for Key Pair ${resource.properties.Name}`,
  );
  return new Promise(function (resolve, reject) {
    if (!resource.properties.Tags.changed) {
      log.info(
        `No changes of tags detected for Key Pair ${resource.properties.Name}. Not attempting any update`,
      );
      return resolve();
    }

    const params: CreateTagsCommandInput = {
      Resources: [keyPairId],
      Tags: makeTags(resource, resource.properties.Tags.value),
    };
    log.debug(`ec2.createTags: ${JSON.stringify(params)}`);
    ec2Client
      .send(new CreateTagsCommand(params))
      .then((_data) => {
        resolve();
      })
      .catch((err) => {
        reject(err);
      });
  });
}

function updateKeyPairRemoveTags(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
  keyPairId: string,
): Promise<void> {
  log.debug('called function updateKeyPairRemoveTags');
  log.info(
    `Attempting to remove some tags for Key Pair ${resource.properties.Name}`,
  );
  return new Promise(function (resolve, reject) {
    if (!resource.properties.Tags.changed) {
      log.info(
        `No changes of tags detected for Key Pair ${resource.properties.Name}. Not attempting any update`,
      );
      return resolve();
    }

    const oldTags = makeTags(resource, resource.properties.Tags.before);
    const newTags = makeTags(resource, resource.properties.Tags.value);
    const tagsToRemove = getMissingTags(oldTags, newTags);
    if (!tagsToRemove.length) {
      log.info(
        `No changes of tags detected for Key Pair ${resource.properties.Name}. Not attempting any update`,
      );
      return resolve();
    }

    log.info(`Will remove the following tags: ${JSON.stringify(tagsToRemove)}`);
    const params: DeleteTagsCommandInput = {
      Resources: [keyPairId],
      Tags: tagsToRemove.map((key) => {
        return {
          Key: key,
          Value: resource.properties.Tags.before![key],
        } as Ec2Tag;
      }),
    };
    log.debug(`ec2.deleteTags: ${JSON.stringify(params)}`);
    ec2Client
      .send(new DeleteTagsCommand(params))
      .then((_data) => {
        resolve();
      })
      .catch((err) => {
        reject(err);
      });
  });
}

function deleteKeyPair(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<void> {
  log.debug('called function deleteKeyPair');
  return new Promise(function (resolve, reject) {
    const params: DeleteKeyPairCommandInput = {
      KeyName: resource.properties.Name.value,
    };
    log.debug(`ec2.deleteKeyPair: ${JSON.stringify(params)}`);
    ec2Client
      .send(new DeleteKeyPairCommand(params))
      .then((_data) => {
        resource.addResponseValue(
          'KeyPairName',
          resource.properties.Name.value,
        );
        resolve();
      })
      .catch((err) => {
        reject(err);
      });
  });
}

function createPrivateKeySecret(
  resource: CustomResource<ResourceProperties>,
  keyPair: CreateKeyPairCommandOutput,
  log: Logger,
): Promise<void> {
  log.debug('called function createPrivateKeySecret');
  return new Promise(function (resolve, reject) {
    if (resource.properties.PublicKey.value.length) {
      resource.addResponseValue('PrivateKeyARN', '');
      return resolve();
    }
    const params: CreateSecretCommandInput = {
      Name: `${resource.properties.SecretPrefix}${resource.properties.Name}/private`,
      Description: `${resource.properties.Description} (Private Key)`,
      SecretString: keyPair.KeyMaterial,
      KmsKeyId: resource.properties.KmsPrivate.value,
      Tags: makeTags(resource, resource.properties.Tags.value),
    };
    log.debug(`secretsmanager.createSecret: ${JSON.stringify(params)}`);
    secretsManagerClient
      .send(new CreateSecretCommand(params))
      .then((data) => {
        resource.addResponseValue('PrivateKeyARN', data.ARN!);
        resolve();
      })
      .catch((err) => {
        log.error('FAILED TO CREATE PRIVATE KEY', err);
        reject(err);
      });
  });
}

function createPublicKeySecret(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
  keyPair: CreateKeyPairCommandOutput,
): Promise<void> {
  log.debug('called function createPublicKeySecret');
  return new Promise(async function (resolve, reject) {
    let publicKey: string;
    if (resource.properties.PublicKey.value.length)
      publicKey = resource.properties.PublicKey.value;
    else {
      try {
        publicKey = await makePublicKey(resource, log, keyPair);
      } catch (err) {
        return reject(err);
      }
    }

    if (resource.properties.StorePublicKey?.value !== 'true') {
      return resolve();
    }

    const params: CreateSecretCommandInput = {
      Name: `${resource.properties.SecretPrefix}${resource.properties.Name}/public`,
      Description: `${resource.properties.Description} (Public Key)`,
      SecretString: publicKey,
      KmsKeyId: resource.properties.KmsPublic.value,
      Tags: makeTags(resource, resource.properties.Tags.value),
    };
    log.debug(`secretsmanager.createSecret: ${JSON.stringify(params)}`);
    secretsManagerClient
      .send(new CreateSecretCommand(params))
      .then((data) => {
        resource.addResponseValue('PublicKeyARN', data.ARN!);
        resolve();
      })
      .catch((err) => {
        reject(err);
      });
  });
}

function updatePrivateKeySecret(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<void> {
  log.debug('called function updatePrivateKeySecret');
  return new Promise(function (resolve, reject) {
    const params: UpdateSecretCommandInput = {
      SecretId: `${resource.properties.SecretPrefix.value}${resource.properties.Name.value}/private`,
      Description: `${resource.properties.Description.value} (Private key)`,
      KmsKeyId: resource.properties.KmsPrivate.value,
    };
    log.debug('secretsmanager.updateSecret:', JSON.stringify(params));
    secretsManagerClient
      .send(new UpdateSecretCommand(params))
      .then((data) => {
        resource.addResponseValue('PrivateKeyARN', data.ARN!);
        resolve();
      })
      .catch((err) => {
        reject(err);
      });
  });
}

function updatePublicKeySecret(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<void> {
  log.debug('called function updatePublicKeySecret');
  return new Promise(function (resolve, reject) {
    const arn = `${resource.properties.SecretPrefix.value}${resource.properties.Name.value}/public`;
    secretExists(arn, log).then((exists) => {
      if (!exists) {
        // no public key stored. nothing to do
        return resolve();
      }
      const params: UpdateSecretCommandInput = {
        SecretId: arn,
        Description: `${resource.properties.Description.value} (Public Key)`,
        KmsKeyId: resource.properties.KmsPublic.value,
      };
      log.debug('secretsmanager.updateSecret:', JSON.stringify(params));
      secretsManagerClient
        .send(new UpdateSecretCommand(params))
        .then((data) => {
          resource.addResponseValue('PublicKeyARN', data.ARN!);
          resolve();
        })
        .catch((err) => {
          reject(err);
        });
    });
  });
}

function updateSecretAddTags(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
  secretId: string,
): Promise<void> {
  log.debug('called function updateSecretAddTags');
  log.info(`Attempting to update tags for secret ${secretId}`);
  return new Promise(function (resolve, reject) {
    if (!resource.properties.Tags.changed) {
      log.info(
        `No changes of tags detected for secret ${secretId}. Not attempting any update`,
      );
      return resolve();
    }
    const params: TagResourceCommandInput = {
      SecretId: secretId,
      Tags: makeTags(resource, resource.properties.Tags.value),
    };
    log.debug(`secretsmanager.tagResource: ${JSON.stringify(params)}`);
    secretsManagerClient
      .send(new TagResourceCommand(params))
      .then((_data) => {
        resolve();
      })
      .catch((err) => {
        reject(err);
      });
  });
}

function getPrivateKey(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<string> {
  log.debug('called function getPrivateKey');
  return new Promise(function (resolve, reject) {
    const params: GetSecretValueCommandInput = {
      SecretId: `${resource.properties.SecretPrefix.value}${resource.properties.Name.value}/private`,
    };
    log.debug(`secretsmanager.getSecretValue: ${JSON.stringify(params)}`);
    secretsManagerClient
      .send(new GetSecretValueCommand(params))
      .then((data) => {
        resolve(data.SecretString!);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

async function makePublicKey(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
  keyPair: CreateKeyPairCommandOutput | KeyPairInfo,
): Promise<string> {
  log.debug('called function makePublicKey');

  const keyMaterial =
    (keyPair as CreateKeyPairCommandOutput).KeyMaterial ||
    (await getPrivateKey(resource, log));

  const privateKey = forge.pki.privateKeyFromPem(keyMaterial);
  const forgePublicKey = forge.pki.rsa.setPublicKey(privateKey.n, privateKey.e);

  const publicKeyFormat = resource.properties.PublicKeyFormat.value;
  switch (publicKeyFormat) {
    case 'PEM':
      return forge.pki.publicKeyToPem(forgePublicKey);
    case 'OPENSSH':
      return forge.ssh.publicKeyToOpenSSH(forgePublicKey);
    default:
      throw new Error(`Unsupported public key format ${publicKeyFormat}`);
  }
}

function exposePublicKey(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
  keyPair: CreateKeyPairCommandOutput | KeyPairInfo,
): Promise<void> {
  log.debug('called function exposePublicKey');
  return new Promise(async function (resolve, reject) {
    if (resource.properties.ExposePublicKey?.value == 'true') {
      try {
        let publicKey: string;
        if (resource.properties.PublicKey.value.length) {
          publicKey = resource.properties.PublicKey.value;
        } else {
          publicKey = await makePublicKey(resource, log, keyPair);
        }
        resource.addResponseValue('PublicKeyValue', publicKey);
      } catch (err) {
        return reject(err);
      }
    } else {
      resource.addResponseValue(
        'PublicKeyValue',
        'Not requested - Set ExposePublicKey to true',
      );
    }
    resolve();
  });
}

function updateSecretRemoveTags(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
  secretId: string,
): Promise<void> {
  log.debug('called function updateSecretRemoveTags');
  log.info(`Attempting to remove some tags for secret ${secretId}`);
  return new Promise(function (resolve, reject) {
    if (!resource.properties.Tags.changed) {
      log.info(
        `No changes of tags detected for secret ${secretId}. Not attempting any update`,
      );
      return resolve();
    }

    const oldTags = makeTags(resource, resource.properties.Tags.before);
    const newTags = makeTags(resource, resource.properties.Tags.value);
    const tagsToRemove = getMissingTags(oldTags, newTags);
    if (!tagsToRemove.length) {
      log.info(
        `No changes of tags detected for secret ${secretId}. Not attempting any update`,
      );
      return resolve();
    }

    log.info(`Will remove the following tags: ${JSON.stringify(tagsToRemove)}`);
    const params: UntagResourceCommandInput = {
      SecretId: secretId,
      TagKeys: tagsToRemove,
    };
    log.debug(`secretsmanager.untagResource: ${JSON.stringify(params)}`);
    secretsManagerClient
      .send(new UntagResourceCommand(params))
      .then((_data) => {
        resolve();
      })
      .catch((err) => {
        reject(err);
      });
  });
}

function deletePrivateKeySecret(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<void> {
  log.debug('called function deletePrivateKeySecret');
  return new Promise(async function (resolve, reject) {
    const arn = `${resource.properties.SecretPrefix.value}${resource.properties.Name.value}/private`;
    secretExists(arn, log)
      .then((exists) => {
        if (!exists) {
          // no private key stored. nothing to do
          return resolve();
        }
        deleteSecret(resource, log, arn)
          .then((data) => {
            resource.addResponseValue('PrivateKeyARN', data.ARN!);
            resolve();
          })
          .catch((err) => {
            reject(err);
          });
      })
      .catch((err) => {
        reject(err);
      });
  });
}

function deletePublicKeySecret(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
): Promise<void> {
  log.debug('called function deletePublicKeySecret');
  return new Promise(async function (resolve, reject) {
    const arn = `${resource.properties.SecretPrefix.value}${resource.properties.Name.value}/public`;
    secretExists(arn, log)
      .then((exists) => {
        if (!exists) {
          // no public key stored. nothing to do
          return resolve();
        }
        deleteSecret(resource, log, arn)
          .then((data) => {
            resource.addResponseValue('PublicKeyARN', data.ARN!);
            resolve();
          })
          .catch((err) => {
            reject(err);
          });
      })
      .catch((err) => {
        reject(err);
      });
  });
}

async function secretExists(name: string, log: Logger): Promise<boolean> {
  log.debug('called function secretExists');
  return new Promise(async function (resolve, reject) {
    const params: ListSecretsCommandInput = {
      Filters: [
        {
          Key: 'name',
          Values: [name],
        },
      ],
    };
    log.debug(`secretsmanager.listSecrets: ${JSON.stringify(params)}`);
    return secretsManagerClient
      .send(new ListSecretsCommand(params))
      .then((data) => {
        resolve((data.SecretList?.length || 0) > 0);
      })
      .catch((err) => {
        if (err.name === 'ResourceNotFoundException') {
          resolve(false);
        } else {
          reject(err);
        }
      });
  });
}

function deleteSecret(
  resource: CustomResource<ResourceProperties>,
  log: Logger,
  secretId: string,
): Promise<DeleteSecretCommandOutput> {
  log.debug('called function deleteSecret');
  const params: DeleteSecretCommandInput = {
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

  log.debug(`secretsmanager.deleteSecret: ${JSON.stringify(params)}`);
  return secretsManagerClient.send(new DeleteSecretCommand(params));
}

function makeTags(
  resource: CustomResource<ResourceProperties>,
  eventTags?: Record<string, string>,
): SecretManagerTag[] {
  const tags: SecretManagerTag[] = [
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
  ];
  if (eventTags && Object.keys(eventTags).length) {
    Object.keys(eventTags).forEach(function (key: string) {
      tags.push({
        Key: key,
        Value: eventTags[key],
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
