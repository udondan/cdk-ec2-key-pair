import { CustomResource, Event, LambdaEvent, StandardLogger } from 'aws-cloudformation-custom-resource';
import { Callback, Context } from 'aws-lambda';
import AWS = require('aws-sdk');

const ec2 = new AWS.EC2();
const secretsmanager = new AWS.SecretsManager();
const logger = new StandardLogger();

export const handler = function (
    event: LambdaEvent,
    context: Context,
    callback: Callback
) {
    new CustomResource(event, context, callback, logger)
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
            .then(savePrivaterKey)
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
        if (
            event.ResourceProperties.Name !== event.OldResourceProperties.Name
        ) {
            reject(
                new Error(
                    'A Key Pair cannot be renamed. Please create a new Key Pair instead'
                )
            );
        }

        updateKeyPair(event)
            .then(updatePrivaterKey)
            .then(updatePrivaterKeyAddTags)
            .then(updatePrivaterKeyRemoveTags)
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
            .then(deletePrivaterKey)
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
        ec2.createKeyPair(
            {
                KeyName: event.ResourceProperties.Name,
            },
            function (err: AWS.AWSError, data: AWS.EC2.KeyPair) {
                if (err) return reject(err);
                event.addResponseValue('KeyPairName', data.KeyName);
                event.KeyFingerprint = data.KeyFingerprint;
                event.KeyMaterial = data.KeyMaterial;
                resolve(event);
            }
        );
    });
}

function updateKeyPair(event: Event): Promise<Event> {
    return new Promise(function (resolve, reject) {
        // there is nothing to update. a key cannot be changed
        event.addResponseValue('KeyPairName', event.ResourceProperties.Name);
        resolve(event);
    });
}

function deleteKeyPair(event: Event): Promise<Event> {
    return new Promise(function (resolve, reject) {
        ec2.deleteKeyPair(
            {
                KeyName: event.ResourceProperties.Name,
            },
            function (err: AWS.AWSError, data: {}) {
                if (err) return reject(err);
                event.addResponseValue(
                    'KeyPairName',
                    event.ResourceProperties.Name
                );
                resolve(event);
            }
        );
    });
}

function savePrivaterKey(event: Event): Promise<Event> {
    return new Promise(function (resolve, reject) {
        secretsmanager.createSecret(
            {
                Name: `${event.ResourceProperties.SecretPrefix}${event.ResourceProperties.Name}`,
                Description: event.ResourceProperties.Description,
                SecretString: event.KeyMaterial,
                KmsKeyId: event.ResourceProperties.Kms,
                Tags: makeTags(event, event.ResourceProperties),
            },
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

function updatePrivaterKey(event: Event): Promise<Event> {
    return new Promise(function (resolve, reject) {
        secretsmanager.updateSecret(
            {
                SecretId: `${event.ResourceProperties.SecretPrefix}${event.ResourceProperties.Name}`,
                Description: event.ResourceProperties.Description,
                KmsKeyId: event.ResourceProperties.Kms,
            },
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

function updatePrivaterKeyAddTags(event: Event): Promise<Event> {
    logger.info(
        `Attempting to update tags for EC2 private key ${event.ResourceProperties.Name}`
    );
    return new Promise(function (resolve, reject) {
        const oldTags = makeTags(event, event.OldResourceProperties);
        const newTags = makeTags(event, event.ResourceProperties);
        if (JSON.stringify(oldTags) == JSON.stringify(newTags)) {
            logger.info(
                `No changes of tags detected for EC2 private key ${event.ResourceProperties.Name}. Not attempting any update`
            );
            return resolve(event);
        }

        secretsmanager.tagResource(
            {
                SecretId: `${event.ResourceProperties.SecretPrefix}${event.ResourceProperties.Name}`,
                Tags: newTags,
            },
            function (err: AWS.AWSError, data: {}) {
                if (err) return reject(err);
                resolve(event);
            }
        );
    });
}

function updatePrivaterKeyRemoveTags(event: Event): Promise<Event> {
    logger.info(
        `Attempting to remove some tags for EC2 private key ${event.ResourceProperties.Name}`
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
                `No changes of tags detected for EC2 private key ${event.ResourceProperties.Name}. Not attempting any update`
            );
            return resolve(event);
        }

        logger.info(
            `Will remove the following tags: ${JSON.stringify(tagsToRemove)}`
        );
        secretsmanager.untagResource(
            {
                SecretId: `${event.ResourceProperties.SecretPrefix}${event.ResourceProperties.Name}`,
                TagKeys: tagsToRemove,
            },
            function (err: AWS.AWSError, data: {}) {
                event.results.push({ data: data, error: err });
                if (err) reject(err);
                else resolve(event);
            }
        );
    });
}

function deletePrivaterKey(event: Event): Promise<Event> {
    return new Promise(function (resolve, reject) {
        const options: any = {
            SecretId: `${event.ResourceProperties.SecretPrefix}${event.ResourceProperties.Name}`,
        };

        const removePrivateKeyAfterDays = event.ResourceProperties
            .RemovePrivateKeyAfterDays as number;

        if (removePrivateKeyAfterDays > 0) {
            options.RecoveryWindowInDays =
                event.ResourceProperties.RemovePrivateKeyAfterDays;
        } else {
            options.ForceDeleteWithoutRecovery = true;
        }

        secretsmanager.deleteSecret(options, function (
            err: AWS.AWSError,
            data: AWS.SecretsManager.DeleteSecretResponse
        ) {
            if (err) return reject(err);
            event.addResponseValue('PrivateKeyARN', data.ARN);
            resolve(event);
        });
    });
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
