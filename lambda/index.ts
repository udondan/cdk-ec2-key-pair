import { Callback, Context } from 'aws-lambda';
import AWS = require('aws-sdk');
import https = require('https');
import URL = require('url');

const secretPrefix = 'ec2-private-key/';

var ec2 = new AWS.EC2();
var secretsmanager = new AWS.SecretsManager();

interface Event {
    [key: string]: any;
}

export const handler = function (event: Event = {}, context: Context, callback: Callback) {

    if (typeof event.ResponseURL === 'undefined') {
        throw new Error('ResponseURL missing');
    }

    try {
        timeout(event, context, callback);
        console.log('REQUEST RECEIVED:\n' + JSON.stringify(event));

        event.results = [];

        let func: (event: Event) => Promise<Event>;

        if (event.RequestType == 'Create') func = Create;
        else if (event.RequestType == 'Update') func = Update;
        else if (event.RequestType == 'Delete') func = Delete;
        else return sendResponse(event, context, 'FAILED', `Unexpected request type: ${event.RequestType}`);

        func(event).then(function (response) {
            console.log(response);
            sendResponse(event, context, 'SUCCESS', `${event.RequestType} completed successfully`);
        }).catch(function (err: AWS.AWSError) {
            console.log(err, err.stack);
            sendResponse(event, context, 'FAILED', err.message || err.code);
        });
    } catch (err) {
        sendResponse(event, context, 'FAILED', (err as Error).message);
    }
};

function Create(event: Event): Promise<Event | AWS.AWSError> {
    console.log(`Attempting to create EC2 Key Pair ${event.ResourceProperties.Name}`);
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
    console.log(`Attempting to update EC2 Key Pair ${event.OldResourceProperties.Name}`);
    return new Promise(function (resolve, reject) {
        if (event.ResourceProperties.Name !== event.OldResourceProperties.Name) {
            reject(new Error('A Key Pair cannot be renamed. Please create a new Key Pair instead'));
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
    console.log(`Attempting to delete EC2 Key Pair ${event.ResourceProperties.Name}`);
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
        ec2.createKeyPair({
            KeyName: event.ResourceProperties.Name,
        }, function (err: AWS.AWSError, data: AWS.EC2.KeyPair) {
            if (err) return reject(err);
            event.KeyName = data.KeyName;
            event.KeyFingerprint = data.KeyFingerprint;
            event.KeyMaterial = data.KeyMaterial;
            resolve(event);
        });
    });
}

function updateKeyPair(event: Event): Promise<Event> {
    return new Promise(function (resolve, reject) {
        // there is nothing to update. a key cannot be changed
        event.KeyName = event.ResourceProperties.Name;
        resolve(event);
    });
}

function deleteKeyPair(event: Event): Promise<Event> {
    return new Promise(function (resolve, reject) {
        ec2.deleteKeyPair({
            KeyName: event.ResourceProperties.Name,
        }, function (err: AWS.AWSError, data: {}) {
            if (err) return reject(err);
            event.KeyName = event.ResourceProperties.Name;
            resolve(event);
        });
    });
}

function savePrivaterKey(event: Event): Promise<Event> {
    return new Promise(function (resolve, reject) {
        secretsmanager.createSecret({
            Name: `${secretPrefix}${event.ResourceProperties.Name}`,
            Description: event.ResourceProperties.Description,
            SecretString: event.KeyMaterial,
            KmsKeyId: event.ResourceProperties.Kms,
            Tags: makeTags(event, event.ResourceProperties),
        }, function (err: AWS.AWSError, data: AWS.SecretsManager.CreateSecretResponse) {
            if (err) return reject(err);
            event.secretARN = data.ARN;
            resolve(event);
        });
    });
}

function updatePrivaterKey(event: Event): Promise<Event> {
    return new Promise(function (resolve, reject) {
        secretsmanager.updateSecret({
            SecretId: `${secretPrefix}${event.ResourceProperties.Name}`,
            Description: event.ResourceProperties.Description,
            KmsKeyId: event.ResourceProperties.Kms,
        }, function (err: AWS.AWSError, data: AWS.SecretsManager.UpdateSecretResponse) {
            if (err) return reject(err);
            event.secretARN = data.ARN;
            resolve(event);
        });
    });
}

function updatePrivaterKeyAddTags(event: Event): Promise<Event> {
    console.log(`Attempting to update tags for EC2 private key ${event.ResourceProperties.Name}`);
    return new Promise(function (resolve, reject) {
        const oldTags = makeTags(event, event.OldResourceProperties);
        const newTags = makeTags(event, event.ResourceProperties);
        if (JSON.stringify(oldTags) == JSON.stringify(newTags)) {
            console.log(`No changes of tags detected for EC2 private key ${event.ResourceProperties.Name}. Not attempting any update`);
            return resolve(event);
        }

        secretsmanager.tagResource({
            SecretId: `${secretPrefix}${event.ResourceProperties.Name}`,
            Tags: newTags,
        }, function (err: AWS.AWSError, data: {}) {
            if (err) return reject(err);
            resolve(event);
        });
    });
}

function updatePrivaterKeyRemoveTags(event: Event): Promise<Event> {
    console.log(`Attempting to remove some tags for EC2 private key ${event.ResourceProperties.Name}`);
    return new Promise(function (resolve, reject) {
        const oldTags = makeTags(event, event.OldResourceProperties);
        const newTags = makeTags(event, event.ResourceProperties);
        const tagsToRemove = getMissingTags(oldTags, newTags);
        if (JSON.stringify(oldTags) == JSON.stringify(newTags) || !tagsToRemove.length) {
            console.log(`No changes of tags detected for EC2 private key ${event.ResourceProperties.Name}. Not attempting any update`);
            return resolve(event);
        }

        console.log(`Will remove the following tags: ${JSON.stringify(tagsToRemove)}`);
        secretsmanager.untagResource({
            SecretId: `${secretPrefix}${event.ResourceProperties.Name}`,
            TagKeys: tagsToRemove,
        }, function (err: AWS.AWSError, data: {}) {
            event.results.push({ data: data, error: err });
            if (err) reject(err);
            else resolve(event);
        });
    });
}

function deletePrivaterKey(event: Event): Promise<Event> {
    return new Promise(function (resolve, reject) {
        secretsmanager.deleteSecret({
            RecoveryWindowInDays: 7, //TODO: should this be be configurable?
            SecretId: `${secretPrefix}${event.ResourceProperties.Name}`,
        }, function (err: AWS.AWSError, data: AWS.SecretsManager.DeleteSecretResponse) {
            if (err) return reject(err);
            event.secretARN = data.ARN;
            resolve(event);
        });
    });
}

function timeout(event: Event, context: Context, callback: Callback) {
    const handler = () => {
        console.log('Timeout FAILURE!');
        new Promise(() => sendResponse(event, context, 'FAILED', 'Function timed out'))
            .then(() => callback(new Error('Function timed out')));
    };
    setTimeout(handler, context.getRemainingTimeInMillis() - 1000);
}

function sendResponse(event: Event, context: Context, responseStatus: string, responseData: string) {
    console.log(`Sending response ${responseStatus}:\n${JSON.stringify(responseData)}`);

    var body = JSON.stringify({
        Status: responseStatus,
        Reason: `${responseData} | Full error in CloudWatch ${context.logStreamName}`,
        PhysicalResourceId: event.ResourceProperties.Name,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: {
            Message: responseData,
            PrivateKeyARN: event.secretARN,
            KeyPairName: event.KeyName,
        },
    });

    console.log(`RESPONSE BODY:\n`, body);

    var url = URL.parse(event.ResponseURL);
    var options = {
        hostname: url.hostname,
        port: 443,
        path: url.path,
        method: 'PUT',
        headers: {
            'content-type': '',
            'content-length': body.length,
        }
    };

    console.log('SENDING RESPONSE...\n');

    var request = https.request(options, function (response: any) {
        console.log('STATUS: ' + response.statusCode);
        console.log('HEADERS: ' + JSON.stringify(response.headers));
        context.done();
    });

    request.on('error', function (error: Error) {
        console.log('sendResponse Error:' + error);
        context.done();
    });

    request.write(body);
    request.end();
}

function makeTags(event: Event, properties: any): AWS.SecretsManager.TagListType {
    const tags: AWS.SecretsManager.TagListType = [{
        Key: 'aws-cloudformation:stack-id',
        Value: event.StackId,
    }, {
        Key: 'aws-cloudformation:stack-name',
        Value: properties.StackName,
    }, {
        Key: 'aws-cloudformation:logical-id',
        Value: event.LogicalResourceId,
    }];
    if ("Tags" in properties) {
        Object.keys(properties.Tags).forEach(function (key: string) {
            tags.push({
                Key: key,
                Value: properties.Tags[key],
            });
        });
    }
    return tags;
}

function getMissingTags(oldTags: AWS.SecretsManager.TagListType, newTags: AWS.SecretsManager.TagListType): string[] {
    var missing = oldTags.filter(missingTags(newTags));
    return missing.map(function (tag: AWS.SecretsManager.Tag) {
        return tag.Key;
    });
}

function missingTags(newTags: AWS.SecretsManager.TagListType) {
    return (currentTag: AWS.SecretsManager.Tag) => {
        return newTags.filter((newTag: any) => {
            return newTag.Key == currentTag.Key;
        }).length == 0;
    };
}
