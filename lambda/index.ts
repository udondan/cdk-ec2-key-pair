import { CustomResource, Event, LambdaEvent, StandardLogger } from 'aws-cloudformation-custom-resource';
import { Callback, Context } from 'aws-lambda';
import AWS = require('aws-sdk');
import forge = require('node-forge');

const ec2 = new AWS.EC2();
const secretsmanager = new AWS.SecretsManager();
const logger = new StandardLogger();

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

function Create(event: Event): Promise<Event | AWS.AWSError> {
  logger.info(
    `Attempting to create EC2 Key Pair ${event.ResourceProperties.Name}`
  );
  return new Promise(function (resolve, reject) {
    createKeyPair(event)
      .then(createPrivateKeySecret)
      .then(createPublicKeySecret)
      .then(function (data) {
        resolve(data);
      })
      .catch(function (err: Error) {
        reject(err);
      });
  });
}

function Update(event: Event): Promise<Event | AWS.AWSError> {
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
    }

    if (
      event.ResourceProperties.StorePublicKey !==
      event.OldResourceProperties.StorePublicKey
    ) {
      reject(
        new Error(
          'Once created, a key cannot be modified or accessed. Therefore the public key can only be stored, when the key is created.'
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
      .then(function (data) {
        resolve(data);
      })
      .catch(function (err: Error) {
        reject(err);
      });
  });
}

function Delete(event: any): Promise<Event | AWS.AWSError> {
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
    const params: AWS.EC2.CreateKeyPairRequest = {
      KeyName: event.ResourceProperties.Name,
      TagSpecifications: [
        {
          ResourceType: 'key-pair',
          Tags: makeTags(event, event.ResourceProperties) as AWS.EC2.TagList,
        },
      ],
    };
    logger.debug(`ec2.createKeyPair: ${JSON.stringify(params)}`);
    ec2.createKeyPair(
      params,
      function (err: AWS.AWSError, data: AWS.EC2.KeyPair) {
        if (err) return reject(err);
        event.addResponseValue('KeyPairName', data.KeyName);
        event.addResponseValue('KeyPairID', data.KeyPairId);
        event.KeyFingerprint = data.KeyFingerprint;
        event.KeyMaterial = data.KeyMaterial;
        event.KeyID = data.KeyPairId;
        resolve(event);
      }
    );
  });
}

function updateKeyPair(event: Event): Promise<Event> {
  return new Promise(function (resolve, reject) {
    // there is nothing to update. a key cannot be changed
    // though we use this step to enrich the event with the keyId
    const params: AWS.EC2.DescribeKeyPairsRequest = {
      KeyNames: [event.ResourceProperties.Name],
    };
    logger.debug(`ec2.describeKeyPairs: ${JSON.stringify(params)}`);
    ec2.describeKeyPairs(
      params,
      (err: any, data: AWS.EC2.DescribeKeyPairsResult) => {
        if (err) return reject(err);
        if (data.KeyPairs?.length != 1)
          return reject(new Error('Key pair was not found'));

        const id = data.KeyPairs![0].KeyPairId!;
        const name = data.KeyPairs![0].KeyName!;
        event.KeyID = id;

        console.log(`the KEY ID IS ${event.KeyID}`);

        event.addResponseValue('KeyPairName', name);
        event.addResponseValue('KeyPairID', id);
        resolve(event);
      }
    );
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

    const params: AWS.EC2.CreateTagsRequest = {
      Resources: [event.KeyID],
      Tags: newTags,
    };
    logger.debug(`ec2.createTags: ${JSON.stringify(params)}`);
    ec2.createTags(params, function (err: AWS.AWSError, _: {}) {
      if (err) return reject(err);
      resolve(event);
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
    const params: AWS.EC2.DeleteTagsRequest = {
      Resources: [event.KeyID],
      Tags: tagsToRemove.map((key) => {
        return {
          Key: key,
          Value: event.OldResourceProperties.Tags[key],
        } as AWS.EC2.Tag;
      }),
    };
    logger.debug(`ec2.deleteTags: ${JSON.stringify(params)}`);
    ec2.deleteTags(params, function (err: AWS.AWSError, _: {}) {
      if (err) reject(err);
      else resolve(event);
    });
  });
}

function deleteKeyPair(event: Event): Promise<Event> {
  return new Promise(function (resolve, reject) {
    const params: AWS.EC2.DeleteKeyPairRequest = {
      KeyName: event.ResourceProperties.Name,
    };
    logger.debug(`ec2.deleteKeyPair: ${JSON.stringify(params)}`);
    ec2.deleteKeyPair(params, function (err: AWS.AWSError, data: {}) {
      if (err) return reject(err);
      event.addResponseValue('KeyPairName', event.ResourceProperties.Name);
      resolve(event);
    });
  });
}

function createPrivateKeySecret(event: Event): Promise<Event> {
  return new Promise(function (resolve, reject) {
    const params: AWS.SecretsManager.CreateSecretRequest = {
      Name: `${event.ResourceProperties.SecretPrefix}${event.ResourceProperties.Name}/private`,
      Description: `${event.ResourceProperties.Description} (Private Key)`,
      SecretString: event.KeyMaterial,
      KmsKeyId: event.ResourceProperties.KmsPrivate,
      Tags: makeTags(event, event.ResourceProperties),
    };
    logger.debug(`secretsmanager.createSecret: ${JSON.stringify(params)}`);
    secretsmanager.createSecret(
      params,
      function (
        err: AWS.AWSError,
        data: AWS.SecretsManager.CreateSecretResponse
      ) {
        if (err) return reject(err);
        event.addResponseValue('PrivateKeyARN', data.ARN);
        resolve(event);
      }
    );
  });
}

function createPublicKeySecret(event: Event): Promise<Event> {
  return new Promise(function (resolve, reject) {
    if (event.ResourceProperties.StorePublicKey !== 'true') {
      return resolve(event);
    }

    const privateKey = forge.pki.privateKeyFromPem(event.KeyMaterial);
    const forgePublicKey = forge.pki.rsa.setPublicKey(
      privateKey.n,
      privateKey.e
    );
    const publicKey = forge.ssh.publicKeyToOpenSSH(forgePublicKey);

    const params: AWS.SecretsManager.CreateSecretRequest = {
      Name: `${event.ResourceProperties.SecretPrefix}${event.ResourceProperties.Name}/public`,
      Description: `${event.ResourceProperties.Description} (Public Key)`,
      SecretString: publicKey,
      KmsKeyId: event.ResourceProperties.KmsPublic,
      Tags: makeTags(event, event.ResourceProperties),
    };
    logger.debug(`secretsmanager.createSecret: ${JSON.stringify(params)}`);
    secretsmanager.createSecret(
      params,
      function (
        err: AWS.AWSError,
        data: AWS.SecretsManager.CreateSecretResponse
      ) {
        if (err) return reject(err);
        event.addResponseValue('PublicKeyARN', data.ARN);
        resolve(event);
      }
    );
  });
}

function updatePrivateKeySecret(event: Event): Promise<Event> {
  return new Promise(function (resolve, reject) {
    const params: AWS.SecretsManager.UpdateSecretRequest = {
      SecretId: `${event.ResourceProperties.SecretPrefix}${event.ResourceProperties.Name}/private`,
      Description: `${event.ResourceProperties.Description} (Private key)`,
      KmsKeyId: event.ResourceProperties.KmsPrivate,
    };
    logger.debug(`secretsmanager.updateSecret: ${JSON.stringify(params)}`);
    secretsmanager.updateSecret(
      params,
      function (
        err: AWS.AWSError,
        data: AWS.SecretsManager.UpdateSecretResponse
      ) {
        if (err) return reject(err);
        event.addResponseValue('PrivateKeyARN', data.ARN);
        resolve(event);
      }
    );
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
      const params: AWS.SecretsManager.UpdateSecretRequest = {
        SecretId: arn,
        Description: `${event.ResourceProperties.Description} (Public Key)`,
        KmsKeyId: event.ResourceProperties.KmsPublic,
      };
      logger.debug(`secretsmanager.updateSecret: ${JSON.stringify(params)}`);
      secretsmanager.updateSecret(
        params,
        function (
          err: AWS.AWSError,
          data: AWS.SecretsManager.UpdateSecretResponse
        ) {
          if (err) return reject(err);
          event.addResponseValue('PublicKeyARN', data.ARN);
          resolve(event);
        }
      );
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
    const params: AWS.SecretsManager.TagResourceRequest = {
      SecretId: secretId,
      Tags: newTags,
    };
    logger.debug(`secretsmanager.tagResource: ${JSON.stringify(params)}`);
    secretsmanager.tagResource(params, function (err: AWS.AWSError, _: {}) {
      if (err) return reject(err);
      resolve(event);
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
    const params: AWS.SecretsManager.UntagResourceRequest = {
      SecretId: secretId,
      TagKeys: tagsToRemove,
    };
    logger.debug(`secretsmanager.untagResource: ${JSON.stringify(params)}`);
    secretsmanager.untagResource(params, function (err: AWS.AWSError, _: {}) {
      if (err) reject(err);
      else resolve(event);
    });
  });
}

function deletePrivateKeySecret(event: Event): Promise<Event> {
  return new Promise(async function (resolve, reject) {
    deleteSecret(
      `${event.ResourceProperties.SecretPrefix}${event.ResourceProperties.Name}/private`,
      event
    )
      .then((data) => {
        event.addResponseValue('PrivateKeyARN', data.ARN);
        resolve(event);
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
    const params: AWS.SecretsManager.ListSecretsRequest = {
      Filters: [
        {
          Key: 'name',
          Values: [name],
        },
      ],
    };
    logger.debug(`secretsmanager.listSecrets: ${JSON.stringify(params)}`);
    return secretsmanager.listSecrets(
      params,
      (err: AWS.AWSError, data: AWS.SecretsManager.ListSecretsResponse) => {
        if (err) return reject(err);
        resolve(data.SecretList.length > 0);
      }
    );
  });
}

function deleteSecret(
  secretId: string,
  event: Event
): Promise<AWS.SecretsManager.DeleteSecretResponse> {
  const params: any = {
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
  return secretsmanager.deleteSecret(params).promise();
}

function makeTags(
  event: Event,
  properties: any
): AWS.SecretsManager.TagListType {
  const tags: AWS.SecretsManager.TagListType = [
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
  oldTags: AWS.SecretsManager.TagListType,
  newTags: AWS.SecretsManager.TagListType
): string[] {
  var missing = oldTags.filter(missingTags(newTags));
  return missing.map(function (tag: AWS.SecretsManager.Tag) {
    return tag.Key;
  });
}

function missingTags(newTags: AWS.SecretsManager.TagListType) {
  return (currentTag: AWS.SecretsManager.Tag) => {
    return (
      newTags.filter((newTag: any) => {
        return newTag.Key == currentTag.Key;
      }).length == 0
    );
  };
}
