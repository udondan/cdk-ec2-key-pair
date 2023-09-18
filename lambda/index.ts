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
  CustomResource,
  Event,
  LambdaEvent,
  LogLevel,
  StandardLogger,
} from 'aws-cloudformation-custom-resource';
import { Callback, Context } from 'aws-lambda';
import * as forge from 'node-forge';

const ec2Client = new EC2Client({});
const secretsManagerClient = new SecretsManagerClient({});
const logger = new StandardLogger(LogLevel.DEBUG);

export const handler = function (
  event: LambdaEvent,
  context: Context,
  callback: Callback
) {
  new CustomResource(context, callback, logger)
    .onCreate(Create)
    .onUpdate(Update)
    .onDelete(Delete)
    .handle(event);
};

function Create(event: Event): Promise<Event> {
  logger.info(
    `Attempting to create EC2 Key Pair ${event.ResourceProperties.Name}`
  );
  return new Promise(function (resolve, reject) {
    createKeyPair(event)
      .then(createPrivateKeySecret)
      .then(createPublicKeySecret)
      .then(exposePublicKey)
      .then(function (data) {
        resolve(data);
      })
      .catch(function (err: Error) {
        reject(err);
      });
  });
}

function Update(event: Event): Promise<Event> {
  logger.info(
    `Attempting to update EC2 Key Pair ${event.OldResourceProperties.Name}`
  );
  return new Promise(function (resolve, reject) {
    if (event.ResourceProperties.Name !== event.OldResourceProperties.Name) {
      reject(
        new Error(
          'A Key Pair cannot be renamed. Please create a new Key Pair instead'
        )
      );
    } else if (
      event.ResourceProperties.StorePublicKey !==
      event.OldResourceProperties.StorePublicKey
    ) {
      reject(
        new Error(
          'Once created, a key cannot be modified or accessed. Therefore the public key can only be stored, when the key is created.'
        )
      );
    } else if (
      event.ResourceProperties.PublicKey !==
      (event.OldResourceProperties.PublicKey || '')
    ) {
      reject(
        new Error(
          'You cannot change the public key of an exiting key pair. Please delete the key pair and create a new one.'
        )
      );
    }

    updateKeyPair(event)
      .then(updateKeyPairAddTags)
      .then(updateKeyPairRemoveTags)
      .then(updatePrivateKeySecret)
      .then(updatePublicKeySecret)
      .then(updateSecretsAddTags)
      .then(updateSecretsRemoveTags)
      .then(exposePublicKey)
      .then(function (data) {
        resolve(data);
      })
      .catch(function (err: Error) {
        reject(err);
      });
  });
}

function Delete(event: any): Promise<Event> {
  logger.info(
    `Attempting to delete EC2 Key Pair ${event.ResourceProperties.Name}`
  );
  return new Promise(function (resolve, reject) {
    deleteKeyPair(event)
      .then(deletePrivateKeySecret)
      .then(deletePublicKeySecret)
      .then(function (data) {
        resolve(data);
      })
      .catch(function (err: Error) {
        reject(err);
      });
  });
}

function createKeyPair(event: Event): Promise<Event> {
  return new Promise(function (resolve, reject) {
    if (
      // public key provided, let's import
      event.ResourceProperties.PublicKey &&
      event.ResourceProperties.PublicKey.length
    ) {
      const params: ImportKeyPairCommandInput = {
        KeyName: event.ResourceProperties.Name,
        PublicKeyMaterial: event.ResourceProperties.PublicKey,
        TagSpecifications: [
          {
            ResourceType: 'key-pair',
            Tags: makeTags(event, event.ResourceProperties) as Ec2Tag[],
          },
        ],
      };
      logger.debug(`ec2.importKeyPair: ${JSON.stringify(params)}`);
      ec2Client
        .send(new ImportKeyPairCommand(params))
        .then((data) => {
          logger.debug(`ec2.importKeyPair result: ${JSON.stringify(data)}`);
          event.addResponseValue('KeyPairName', data.KeyName);
          event.addResponseValue('KeyPairID', data.KeyPairId);
          event.KeyFingerprint = data.KeyFingerprint;
          event.KeyMaterial = '';
          event.KeyID = data.KeyPairId;
          resolve(event);
        })
        .catch((err) => {
          reject(err);
        });
    } else {
      // no public key provided. create new key
      const params: CreateKeyPairCommandInput = {
        KeyName: event.ResourceProperties.Name,
        TagSpecifications: [
          {
            ResourceType: 'key-pair',
            Tags: makeTags(event, event.ResourceProperties) as Ec2Tag[],
          },
        ],
      };
      logger.debug(`ec2.createKeyPair: ${JSON.stringify(params)}`);

      ec2Client
        .send(new CreateKeyPairCommand(params))
        .then((data) => {
          event.addResponseValue('KeyPairName', data.KeyName);
          event.addResponseValue('KeyPairID', data.KeyPairId);
          event.KeyFingerprint = data.KeyFingerprint;
          event.KeyMaterial = data.KeyMaterial;
          event.KeyID = data.KeyPairId;
          resolve(event);
        })
        .catch((err) => {
          reject(err);
        });
    }
  });
}

function updateKeyPair(event: Event): Promise<Event> {
  return new Promise(function (resolve, reject) {
    // there is nothing to update. a key cannot be changed
    // though we use this step to enrich the event with the keyId
    const params: DescribeKeyPairsCommandInput = {
      KeyNames: [event.ResourceProperties.Name],
    };
    logger.debug(`ec2.describeKeyPairs: ${JSON.stringify(params)}`);
    ec2Client
      .send(new DescribeKeyPairsCommand(params))
      .then((data) => {
        if (data.KeyPairs?.length != 1)
          return reject(new Error('Key pair was not found'));

        const id = data.KeyPairs![0].KeyPairId!;
        const name = data.KeyPairs![0].KeyName!;
        event.KeyID = id;

        console.log(`the KEY ID IS ${event.KeyID}`);

        event.addResponseValue('KeyPairName', name);
        event.addResponseValue('KeyPairID', id);
        resolve(event);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

function updateKeyPairAddTags(event: Event): Promise<Event> {
  logger.info(
    `Attempting to update tags for Key Pair ${event.ResourceProperties.Name}`
  );
  return new Promise(function (resolve, reject) {
    const oldTags = makeTags(event, event.OldResourceProperties);
    const newTags = makeTags(event, event.ResourceProperties);
    if (JSON.stringify(oldTags) == JSON.stringify(newTags)) {
      logger.info(
        `No changes of tags detected for Key Pair ${event.ResourceProperties.Name}. Not attempting any update`
      );
      return resolve(event);
    }

    const params: CreateTagsCommandInput = {
      Resources: [event.KeyID],
      Tags: newTags,
    };
    logger.debug(`ec2.createTags: ${JSON.stringify(params)}`);
    ec2Client
      .send(new CreateTagsCommand(params))
      .then((data) => {
        resolve(event);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

function updateKeyPairRemoveTags(event: Event): Promise<Event> {
  logger.info(
    `Attempting to remove some tags for Key Pair ${event.ResourceProperties.Name}`
  );
  return new Promise(function (resolve, reject) {
    const oldTags = makeTags(event, event.OldResourceProperties);

    const newTags = makeTags(event, event.ResourceProperties);
    const tagsToRemove = getMissingTags(oldTags, newTags);
    if (
      JSON.stringify(oldTags) == JSON.stringify(newTags) ||
      !tagsToRemove.length
    ) {
      logger.info(
        `No changes of tags detected for Key Pair ${event.ResourceProperties.Name}. Not attempting any update`
      );
      return resolve(event);
    }

    logger.info(
      `Will remove the following tags: ${JSON.stringify(tagsToRemove)}`
    );
    const params: DeleteTagsCommandInput = {
      Resources: [event.KeyID],
      Tags: tagsToRemove.map((key) => {
        return {
          Key: key,
          Value: event.OldResourceProperties.Tags[key],
        } as Ec2Tag;
      }),
    };
    logger.debug(`ec2.deleteTags: ${JSON.stringify(params)}`);
    ec2Client
      .send(new DeleteTagsCommand(params))
      .then((data) => {
        resolve(event);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

function deleteKeyPair(event: Event): Promise<Event> {
  return new Promise(function (resolve, reject) {
    const params: DeleteKeyPairCommandInput = {
      KeyName: event.ResourceProperties.Name,
    };
    logger.debug(`ec2.deleteKeyPair: ${JSON.stringify(params)}`);
    ec2Client
      .send(new DeleteKeyPairCommand(params))
      .then((data) => {
        event.addResponseValue('KeyPairName', event.ResourceProperties.Name);
        resolve(event);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

function createPrivateKeySecret(event: Event): Promise<Event> {
  return new Promise(function (resolve, reject) {
    if (event.ResourceProperties.PublicKey) {
      event.addResponseValue('PrivateKeyARN', null);
      return resolve(event);
    }
    const params: CreateSecretCommandInput = {
      Name: `${event.ResourceProperties.SecretPrefix}${event.ResourceProperties.Name}/private`,
      Description: `${event.ResourceProperties.Description} (Private Key)`,
      SecretString: event.KeyMaterial,
      KmsKeyId: event.ResourceProperties.KmsPrivate,
      Tags: makeTags(event, event.ResourceProperties),
    };
    logger.debug(`secretsmanager.createSecret: ${JSON.stringify(params)}`);
    secretsManagerClient
      .send(new CreateSecretCommand(params))
      .then((data) => {
        event.addResponseValue('PrivateKeyARN', data.ARN);
        resolve(event);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

function createPublicKeySecret(event: Event): Promise<Event> {
  return new Promise(async function (resolve, reject) {
    let publicKey: string;
    if (event.ResourceProperties.PublicKey.length)
      publicKey = event.ResourceProperties.PublicKey;
    else {
      try {
        publicKey = await makePublicKey(event);
      } catch (err) {
        return reject(err);
      }
    }

    if (event.ResourceProperties.StorePublicKey !== 'true') {
      return resolve(event);
    }

    const params: CreateSecretCommandInput = {
      Name: `${event.ResourceProperties.SecretPrefix}${event.ResourceProperties.Name}/public`,
      Description: `${event.ResourceProperties.Description} (Public Key)`,
      SecretString: publicKey,
      KmsKeyId: event.ResourceProperties.KmsPublic,
      Tags: makeTags(event, event.ResourceProperties),
    };
    logger.debug(`secretsmanager.createSecret: ${JSON.stringify(params)}`);
    secretsManagerClient
      .send(new CreateSecretCommand(params))
      .then((data) => {
        event.addResponseValue('PublicKeyARN', data.ARN);
        resolve(event);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

function updatePrivateKeySecret(event: Event): Promise<Event> {
  return new Promise(function (resolve, reject) {
    const params: UpdateSecretCommandInput = {
      SecretId: `${event.ResourceProperties.SecretPrefix}${event.ResourceProperties.Name}/private`,
      Description: `${event.ResourceProperties.Description} (Private key)`,
      KmsKeyId: event.ResourceProperties.KmsPrivate,
    };
    logger.debug(`secretsmanager.updateSecret: ${JSON.stringify(params)}`);
    secretsManagerClient
      .send(new UpdateSecretCommand(params))
      .then((data) => {
        event.addResponseValue('PrivateKeyARN', data.ARN);
        resolve(event);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

function updatePublicKeySecret(event: Event): Promise<Event> {
  return new Promise(function (resolve, reject) {
    const arn = `${event.ResourceProperties.SecretPrefix}${event.ResourceProperties.Name}/public`;
    secretExists(arn).then((exists) => {
      if (!exists) {
        // no public key stored. nothing to do
        return resolve(event);
      }
      const params: UpdateSecretCommandInput = {
        SecretId: arn,
        Description: `${event.ResourceProperties.Description} (Public Key)`,
        KmsKeyId: event.ResourceProperties.KmsPublic,
      };
      logger.debug(`secretsmanager.updateSecret: ${JSON.stringify(params)}`);
      secretsManagerClient
        .send(new UpdateSecretCommand(params))
        .then((data) => {
          event.addResponseValue('PublicKeyARN', data.ARN);
          resolve(event);
        })
        .catch((err) => {
          reject(err);
        });
    });
  });
}

function updateSecretsAddTags(event: Event): Promise<Event> {
  const secretPrivateKey = `${event.ResourceProperties.SecretPrefix}${event.ResourceProperties.Name}/private`;
  const secretPublicKey = `${event.ResourceProperties.SecretPrefix}${event.ResourceProperties.Name}/public`;
  return new Promise(function (resolve, reject) {
    updateSecretAddTags(secretPrivateKey, event).then((event) => {
      secretExists(secretPublicKey).then((exists) => {
        if (!exists) {
          // no public key stored. nothing to do
          return resolve(event);
        }
        updateSecretAddTags(secretPublicKey, event)
          .then((event) => {
            resolve(event);
          })
          .catch((err) => {
            reject(err);
          });
      });
    });
  });
}

function updateSecretAddTags(secretId: string, event: Event): Promise<Event> {
  logger.info(`Attempting to update tags for secret ${secretId}`);
  return new Promise(function (resolve, reject) {
    const oldTags = makeTags(event, event.OldResourceProperties);
    const newTags = makeTags(event, event.ResourceProperties);
    if (JSON.stringify(oldTags) == JSON.stringify(newTags)) {
      logger.info(
        `No changes of tags detected for secret ${secretId}. Not attempting any update`
      );
      return resolve(event);
    }
    const params: TagResourceCommandInput = {
      SecretId: secretId,
      Tags: newTags,
    };
    logger.debug(`secretsmanager.tagResource: ${JSON.stringify(params)}`);
    secretsManagerClient
      .send(new TagResourceCommand(params))
      .then((data) => {
        resolve(event);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

function updateSecretsRemoveTags(event: Event): Promise<Event> {
  const secretPrivateKey = `${event.ResourceProperties.SecretPrefix}${event.ResourceProperties.Name}/private`;
  const secretPublicKey = `${event.ResourceProperties.SecretPrefix}${event.ResourceProperties.Name}/public`;
  return new Promise(function (resolve, reject) {
    updateSecretRemoveTags(secretPrivateKey, event).then((event) => {
      secretExists(secretPublicKey).then((exists) => {
        if (!exists) {
          // no public key stored. nothing to do
          return resolve(event);
        }
        updateSecretRemoveTags(secretPublicKey, event)
          .then((event) => {
            resolve(event);
          })
          .catch((err) => {
            reject(err);
          });
      });
    });
  });
}

function getPrivateKey(event: Event): Promise<string> {
  return new Promise(function (resolve, reject) {
    const params: GetSecretValueCommandInput = {
      SecretId: `${event.ResourceProperties.SecretPrefix}${event.ResourceProperties.Name}/private`,
    };
    logger.debug(`secretsmanager.getSecretValue: ${JSON.stringify(params)}`);
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

function makePublicKey(event: Event): Promise<string> {
  return new Promise(async function (resolve, reject) {
    if (typeof event.KeyMaterial == 'undefined') {
      try {
        event.KeyMaterial = await getPrivateKey(event);
      } catch (err) {
        return reject(err);
      }
    }

    const privateKey = forge.pki.privateKeyFromPem(event.KeyMaterial);
    const forgePublicKey = forge.pki.rsa.setPublicKey(
      privateKey.n,
      privateKey.e
    );

    let publicKey = '';
    if (event.ResourceProperties.PublicKeyFormat === 'PEM') {
      publicKey = forge.pki.publicKeyToPem(forgePublicKey);
    } else if (event.ResourceProperties.PublicKeyFormat === 'OPENSSH') {
      publicKey = forge.ssh.publicKeyToOpenSSH(forgePublicKey);
    } else {
      reject(
        new Error(
          `Unsupported public key format ${event.ResourceProperties.PublicKeyFormat}`
        )
      );
    }
    resolve(publicKey);
  });
}

function exposePublicKey(event: Event): Promise<Event> {
  return new Promise(async function (resolve, reject) {
    if (event.ResourceProperties.ExposePublicKey == 'true') {
      try {
        let publicKey: string;
        if (event.ResourceProperties.PublicKey.length) {
          publicKey = event.ResourceProperties.PublicKey;
        } else {
          publicKey = await makePublicKey(event);
        }
        event.addResponseValue('PublicKeyValue', publicKey);
      } catch (err) {
        return reject(err);
      }
    } else {
      event.addResponseValue(
        'PublicKeyValue',
        'Not requested - Set ExposePublicKey to true'
      );
    }
    resolve(event);
  });
}

function updateSecretRemoveTags(
  secretId: string,
  event: Event
): Promise<Event> {
  logger.info(`Attempting to remove some tags for secret ${secretId}`);
  return new Promise(function (resolve, reject) {
    const oldTags = makeTags(event, event.OldResourceProperties);
    const newTags = makeTags(event, event.ResourceProperties);
    const tagsToRemove = getMissingTags(oldTags, newTags);
    if (
      JSON.stringify(oldTags) == JSON.stringify(newTags) ||
      !tagsToRemove.length
    ) {
      logger.info(
        `No changes of tags detected for secret ${secretId}. Not attempting any update`
      );
      return resolve(event);
    }

    logger.info(
      `Will remove the following tags: ${JSON.stringify(tagsToRemove)}`
    );
    const params: UntagResourceCommandInput = {
      SecretId: secretId,
      TagKeys: tagsToRemove,
    };
    logger.debug(`secretsmanager.untagResource: ${JSON.stringify(params)}`);
    secretsManagerClient
      .send(new UntagResourceCommand(params))
      .then((data) => {
        resolve(event);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

function deletePrivateKeySecret(event: Event): Promise<Event> {
  return new Promise(async function (resolve, reject) {
    const arn = `${event.ResourceProperties.SecretPrefix}${event.ResourceProperties.Name}/private`;
    secretExists(arn)
      .then((exists) => {
        if (!exists) {
          // no private key stored. nothing to do
          return resolve(event);
        }
        deleteSecret(arn, event)
          .then((data) => {
            event.addResponseValue('PrivateKeyARN', data.ARN);
            resolve(event);
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

function deletePublicKeySecret(event: Event): Promise<Event> {
  return new Promise(async function (resolve, reject) {
    const arn = `${event.ResourceProperties.SecretPrefix}${event.ResourceProperties.Name}/public`;
    secretExists(arn)
      .then((exists) => {
        if (!exists) {
          // no public key stored. nothing to do
          return resolve(event);
        }
        deleteSecret(arn, event)
          .then((data) => {
            event.addResponseValue('PublicKeyARN', data.ARN);
            resolve(event);
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

async function secretExists(name: string): Promise<boolean> {
  return new Promise(async function (resolve, reject) {
    const params: ListSecretsCommandInput = {
      Filters: [
        {
          Key: 'name',
          Values: [name],
        },
      ],
    };
    logger.debug(`secretsmanager.listSecrets: ${JSON.stringify(params)}`);
    return secretsManagerClient
      .send(new ListSecretsCommand(params))
      .then((data) => {
        resolve((data.SecretList?.length || 0) > 0);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

function deleteSecret(
  secretId: string,
  event: Event
): Promise<DeleteSecretCommandOutput> {
  const params: DeleteSecretCommandInput = {
    SecretId: secretId,
  };

  const removeKeySecretsAfterDays = event.ResourceProperties
    .RemoveKeySecretsAfterDays as number;

  if (removeKeySecretsAfterDays > 0) {
    params.RecoveryWindowInDays =
      event.ResourceProperties.RemoveKeySecretsAfterDays;
  } else {
    params.ForceDeleteWithoutRecovery = true;
  }

  logger.debug(`secretsmanager.deleteSecret: ${JSON.stringify(params)}`);
  return secretsManagerClient.send(new DeleteSecretCommand(params));
}

function makeTags(event: Event, properties: any): SecretManagerTag[] {
  const tags: SecretManagerTag[] = [
    {
      Key: 'aws-cloudformation:stack-id',
      Value: event.StackId,
    },
    {
      Key: 'aws-cloudformation:stack-name',
      Value: properties.StackName,
    },
    {
      Key: 'aws-cloudformation:logical-id',
      Value: event.LogicalResourceId,
    },
  ];
  if ('Tags' in properties) {
    Object.keys(properties.Tags).forEach(function (key: string) {
      tags.push({
        Key: key,
        Value: properties.Tags[key],
      });
    });
  }
  return tags;
}

function getMissingTags(
  oldTags: SecretManagerTag[],
  newTags: SecretManagerTag[]
): string[] {
  var missing = oldTags.filter(missingTags(newTags));
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
