/* eslint-disable @typescript-eslint/naming-convention */
import {
  CreateKeyPairCommand,
  CreateTagsCommand,
  DeleteKeyPairCommand,
  DeleteTagsCommand,
  DescribeKeyPairsCommand,
  EC2Client,
  ImportKeyPairCommand,
} from '@aws-sdk/client-ec2';
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  ListSecretsCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
  TagResourceCommand,
  UntagResourceCommand,
  UpdateSecretCommand,
} from '@aws-sdk/client-secrets-manager';
import { Context, Event } from 'aws-cloudformation-custom-resource';
import { generateKeyPairSync } from 'crypto';
import { EventEmitter } from 'events';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'http';
import { createRequire } from 'module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handler } from '../lambda/index';
import {
  KeyType,
  LogLevel,
  PublicKeyFormat,
  ResourceProperties,
} from '../lambda/types';

// The library sends the CloudFormation response with the CommonJS https
// module. Its ESM namespace can't be spied on, the CommonJS object can.
const https = createRequire(__filename)('https') as typeof import('https');

/** Body the handler sends to the CloudFormation response URL */
interface CfnResponse {
  Status: 'SUCCESS' | 'FAILED';
  Reason: string;
  Data: Record<string, string>;
}

type Input = Record<string, unknown>;
type Responder = (input: Input) => unknown;
type CommandClass = abstract new (...args: never[]) => object;

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const importedKey = 'ssh-rsa AAAAB3NzaC1yc2E imported';

const baseProps: ResourceProperties = {
  Name: 'test-key',
  Description: 'desc',
  KmsPrivate: 'kms-private',
  KmsPublic: 'kms-public',
  PublicKey: '',
  StorePublicKey: 'false',
  ExposePublicKey: 'false',
  KeyType: KeyType.RSA,
  PublicKeyFormat: PublicKeyFormat.SSH,
  RemoveKeySecretsAfterDays: 0,
  SecretPrefix: 'prefix/',
  StackName: 'stack',
  Tags: {},
};

const context: Context = {
  functionName: 'fn',
  functionVersion: '1',
  invokedFunctionArn: 'arn:fn',
  memoryLimitInMB: '128',
  awsRequestId: 'request',
  logGroupName: 'group',
  logStreamName: 'stream',
  getRemainingTimeInMillis: () => 60_000,
};

let responders: Map<CommandClass, Responder>;
let calls: { command: CommandClass; input: Input }[];
let responses: CfnResponse[];
let responseError: Error | undefined;

function respond(command: CommandClass, responder: Responder): void {
  responders.set(command, responder);
}

function fail(command: CommandClass, error: unknown): void {
  respond(command, () => {
    throw error;
  });
}

function inputs(command: CommandClass): Input[] {
  return calls.filter((call) => call.command === command).map((c) => c.input);
}

function send(command: object): Promise<unknown> {
  const ctor = command.constructor as CommandClass;
  const input = (command as { input: Input }).input;
  calls.push({ command: ctor, input });
  const responder = responders.get(ctor);
  if (!responder) {
    return Promise.reject(new Error(`Unexpected command ${ctor.name}`));
  }
  try {
    return Promise.resolve(responder(input));
  } catch (error) {
    // Some tests throw plain strings on purpose.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    return Promise.reject(error);
  }
}

function fakeRequest(
  _options: RequestOptions,
  callback: (response: IncomingMessage) => void,
): ClientRequest {
  let body = '';
  const request = new EventEmitter() as EventEmitter & {
    write: (chunk: string) => boolean;
    end: () => void;
  };
  request.write = (chunk) => {
    body += chunk;
    return true;
  };
  request.end = () => {
    responses.push(JSON.parse(body) as CfnResponse);
    if (responseError) {
      request.emit('error', responseError);
    } else {
      callback({ statusCode: 200, headers: {} } as IncomingMessage);
    }
  };
  return request as unknown as ClientRequest;
}

function makeEvent(
  requestType: Event['RequestType'],
  props: Partial<ResourceProperties> = {},
  oldProps: Partial<ResourceProperties> = {},
): Event<ResourceProperties> {
  return {
    RequestType: requestType,
    StackId: 'arn:stack',
    RequestId: 'request',
    LogicalResourceId: 'Key',
    ResponseURL: 'https://cloudformation.example.com/response?signature=1',
    ResourceProperties: { ...baseProps, ...props },
    OldResourceProperties:
      requestType === 'Update' ? { ...baseProps, ...oldProps } : undefined,
  };
}

async function invoke(
  requestType: Event['RequestType'],
  props: Partial<ResourceProperties> = {},
  oldProps: Partial<ResourceProperties> = {},
): Promise<CfnResponse> {
  await handler(makeEvent(requestType, props, oldProps), context);
  expect(responses).toHaveLength(1);
  return responses[0];
}

function notFound(): ResourceNotFoundException {
  return new ResourceNotFoundException({ message: 'not found', $metadata: {} });
}

beforeEach(() => {
  calls = [];
  responses = [];
  responseError = undefined;
  responders = new Map<CommandClass, Responder>([
    [
      CreateKeyPairCommand,
      () => ({
        KeyName: 'test-key',
        KeyPairId: 'key-1',
        KeyFingerprint: 'fp',
        KeyMaterial: privateKey,
      }),
    ],
    [
      ImportKeyPairCommand,
      () => ({ KeyName: 'test-key', KeyPairId: 'key-1', KeyFingerprint: 'fp' }),
    ],
    [
      DescribeKeyPairsCommand,
      () => ({
        KeyPairs: [
          { KeyName: 'test-key', KeyPairId: 'key-1', KeyFingerprint: 'fp' },
        ],
      }),
    ],
    [CreateTagsCommand, () => ({})],
    [DeleteTagsCommand, () => ({})],
    [DeleteKeyPairCommand, () => ({})],
    [CreateSecretCommand, (input) => ({ ARN: `arn:${String(input.Name)}` })],
    [
      UpdateSecretCommand,
      (input) => ({ ARN: `arn:${String(input.SecretId)}` }),
    ],
    [
      DeleteSecretCommand,
      (input) => ({ ARN: `arn:${String(input.SecretId)}` }),
    ],
    [GetSecretValueCommand, () => ({ SecretString: privateKey })],
    [ListSecretsCommand, () => ({ SecretList: [{}] })],
    [TagResourceCommand, () => ({})],
    [UntagResourceCommand, () => ({})],
  ]);

  vi.spyOn(EC2Client.prototype, 'send').mockImplementation(send as never);
  vi.spyOn(SecretsManagerClient.prototype, 'send').mockImplementation(
    send as never,
  );
  vi.spyOn(https, 'request').mockImplementation(fakeRequest as never);
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation(() => undefined);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handler', () => {
  it('rejects when the response cannot be sent', async () => {
    responseError = new Error('network down');
    await expect(handler(makeEvent('Delete'), context)).rejects.toThrow(
      'network down',
    );
  });

  it('uses the log level of the resource', async () => {
    const response = await invoke('Delete', { LogLevel: LogLevel.DEBUG });
    expect(response.Status).toBe('SUCCESS');
    expect(console.debug).toHaveBeenCalled();
  });
});

describe('Create', () => {
  it('creates a key pair and stores the private key', async () => {
    const response = await invoke('Create');

    expect(response.Status).toBe('SUCCESS');
    expect(response.Data).toEqual({
      KeyPairName: 'test-key',
      KeyPairID: 'key-1',
      KeyPairFingerprint: 'fp',
      PrivateKeyARN: 'arn:prefix/test-key/private',
      PublicKeyValue: 'Not requested - Set ExposePublicKey to true',
    });
    expect(inputs(CreateKeyPairCommand)).toEqual([
      {
        KeyName: 'test-key',
        KeyType: 'rsa',
        TagSpecifications: [
          {
            ResourceType: 'key-pair',
            Tags: [
              { Key: 'aws-cloudformation:stack-id', Value: 'arn:stack' },
              { Key: 'aws-cloudformation:stack-name', Value: 'stack' },
              { Key: 'aws-cloudformation:logical-id', Value: 'Key' },
            ],
          },
        ],
      },
    ]);
    expect(inputs(CreateSecretCommand)).toEqual([
      expect.objectContaining({
        Name: 'prefix/test-key/private',
        Description: 'desc (Private Key)',
        SecretString: privateKey,
        KmsKeyId: 'kms-private',
      }),
    ]);
  });

  it('adds custom tags', async () => {
    await invoke('Create', { Tags: { Foo: 'bar' } });
    const [input] = inputs(CreateKeyPairCommand) as {
      TagSpecifications: { Tags: unknown[] }[];
    }[];
    expect(input.TagSpecifications[0].Tags).toContainEqual({
      Key: 'Foo',
      Value: 'bar',
    });
  });

  it('stores and exposes the public key', async () => {
    const response = await invoke('Create', {
      StorePublicKey: 'true',
      ExposePublicKey: 'true',
    });

    expect(response.Status).toBe('SUCCESS');
    expect(response.Data.PublicKeyARN).toBe('arn:prefix/test-key/public');
    expect(response.Data.PublicKeyValue).toMatch(/^ssh-rsa \S+ test-key$/);
    expect(inputs(CreateSecretCommand)[1]).toEqual(
      expect.objectContaining({
        Name: 'prefix/test-key/public',
        Description: 'desc (Public Key)',
        SecretString: response.Data.PublicKeyValue,
        KmsKeyId: 'kms-public',
      }),
    );
  });

  it('exposes RFC4253 public keys base64 encoded', async () => {
    const response = await invoke('Create', {
      ExposePublicKey: 'true',
      PublicKeyFormat: PublicKeyFormat.RFC4253,
    });

    const decoded = Buffer.from(response.Data.PublicKeyValue, 'base64');
    // RFC4253 wire format starts with the length-prefixed key type
    expect(decoded.subarray(4, 11).toString()).toBe('ssh-rsa');
  });

  it('imports a public key', async () => {
    const response = await invoke('Create', {
      PublicKey: importedKey,
      StorePublicKey: 'true',
      ExposePublicKey: 'true',
    });

    expect(response.Status).toBe('SUCCESS');
    expect(response.Data).toEqual({
      KeyPairName: 'test-key',
      KeyPairID: 'key-1',
      KeyFingerprint: 'fp',
      PrivateKeyARN: '',
      PublicKeyARN: 'arn:prefix/test-key/public',
      PublicKeyValue: importedKey,
    });
    expect(inputs(ImportKeyPairCommand)).toEqual([
      expect.objectContaining({
        KeyName: 'test-key',
        PublicKeyMaterial: Buffer.from(importedKey),
      }),
    ]);
    expect(inputs(CreateKeyPairCommand)).toHaveLength(0);
    expect(inputs(CreateSecretCommand)).toEqual([
      expect.objectContaining({ SecretString: importedKey }),
    ]);
  });

  it('fails when the import fails', async () => {
    fail(ImportKeyPairCommand, new Error('invalid key'));
    const response = await invoke('Create', { PublicKey: importedKey });
    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('invalid key');
  });

  it('fails when the private key secret cannot be created', async () => {
    fail(CreateSecretCommand, new Error('secret exists'));
    const response = await invoke('Create');
    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('secret exists');
  });
});

describe('Update', () => {
  it('updates the secrets and exposes the public key', async () => {
    const response = await invoke(
      'Update',
      {
        StorePublicKey: 'true',
        ExposePublicKey: 'true',
      },
      { StorePublicKey: 'true' },
    );

    expect(response.Status).toBe('SUCCESS');
    expect(response.Data).toEqual({
      KeyPairName: 'test-key',
      KeyPairID: 'key-1',
      KeyPairFingerprint: 'fp',
      PrivateKeyARN: 'arn:prefix/test-key/private',
      PublicKeyARN: 'arn:prefix/test-key/public',
      PublicKeyValue: expect.stringMatching(/^ssh-rsa \S+ test-key$/) as string,
    });
    expect(inputs(UpdateSecretCommand)).toEqual([
      {
        SecretId: 'prefix/test-key/private',
        Description: 'desc (Private key)',
        KmsKeyId: 'kms-private',
      },
      {
        SecretId: 'prefix/test-key/public',
        Description: 'desc (Public Key)',
        KmsKeyId: 'kms-public',
      },
    ]);
    // The public key is derived from the stored private key
    expect(inputs(GetSecretValueCommand)).toEqual([
      { SecretId: 'prefix/test-key/private' },
    ]);
    // Tags didn't change
    expect(inputs(CreateTagsCommand)).toHaveLength(0);
    expect(inputs(DeleteTagsCommand)).toHaveLength(0);
    expect(inputs(TagResourceCommand)).toHaveLength(0);
    expect(inputs(UntagResourceCommand)).toHaveLength(0);
  });

  it('accepts keys without a stored key type as RSA', async () => {
    const response = await invoke(
      'Update',
      {},
      {
        KeyType: undefined as unknown as KeyType,
      },
    );
    expect(response.Status).toBe('SUCCESS');
  });

  it('skips the private key secret of imported keys', async () => {
    const response = await invoke(
      'Update',
      { PublicKey: importedKey, ExposePublicKey: 'true' },
      { PublicKey: importedKey },
    );

    expect(response.Status).toBe('SUCCESS');
    expect(response.Data.PublicKeyValue).toBe(importedKey);
    expect(inputs(UpdateSecretCommand)).toHaveLength(0);
  });

  it('skips a public key secret that does not exist', async () => {
    respond(ListSecretsCommand, () => ({ SecretList: [] }));
    const response = await invoke(
      'Update',
      { StorePublicKey: 'true' },
      { StorePublicKey: 'true' },
    );

    expect(response.Status).toBe('SUCCESS');
    expect(inputs(UpdateSecretCommand)).toEqual([
      expect.objectContaining({ SecretId: 'prefix/test-key/private' }),
    ]);
  });

  it('adds and removes tags', async () => {
    const response = await invoke(
      'Update',
      { StorePublicKey: 'true', Tags: { Keep: 'new' } },
      { StorePublicKey: 'true', Tags: { Keep: 'old', Drop: 'x' } },
    );

    expect(response.Status).toBe('SUCCESS');
    const newTags = [
      { Key: 'aws-cloudformation:stack-id', Value: 'arn:stack' },
      { Key: 'aws-cloudformation:stack-name', Value: 'stack' },
      { Key: 'aws-cloudformation:logical-id', Value: 'Key' },
      { Key: 'Keep', Value: 'new' },
    ];
    expect(inputs(CreateTagsCommand)).toEqual([
      { Resources: ['key-1'], Tags: newTags },
    ]);
    expect(inputs(DeleteTagsCommand)).toEqual([
      { Resources: ['key-1'], Tags: [{ Key: 'Drop', Value: 'x' }] },
    ]);
    expect(inputs(TagResourceCommand)).toEqual([
      { SecretId: 'prefix/test-key/private', Tags: newTags },
      { SecretId: 'prefix/test-key/public', Tags: newTags },
    ]);
    expect(inputs(UntagResourceCommand)).toEqual([
      { SecretId: 'prefix/test-key/private', TagKeys: ['Drop'] },
      { SecretId: 'prefix/test-key/public', TagKeys: ['Drop'] },
    ]);
  });

  it('adds tags without removing any', async () => {
    const response = await invoke(
      'Update',
      { Tags: { Foo: 'bar' } },
      { Tags: undefined as unknown as Record<string, string> },
    );

    expect(response.Status).toBe('SUCCESS');
    expect(inputs(CreateTagsCommand)).toHaveLength(1);
    expect(inputs(TagResourceCommand)).toHaveLength(1);
    expect(inputs(DeleteTagsCommand)).toHaveLength(0);
    expect(inputs(UntagResourceCommand)).toHaveLength(0);
  });

  it.each<
    [string, Partial<ResourceProperties>, Partial<ResourceProperties>, string]
  >([
    ['the name', { Name: 'new' }, {}, 'A Key Pair cannot be renamed'],
    [
      'StorePublicKey',
      { StorePublicKey: 'true' },
      {},
      'the public key can only be stored, when the key is created',
    ],
    [
      'the public key',
      { PublicKey: importedKey },
      {},
      'You cannot change the public key',
    ],
    [
      'the key type',
      {},
      { KeyType: KeyType.ED25519 },
      'The type of a key pair cannot be changed',
    ],
  ])('rejects changing %s', async (_name, props, oldProps, message) => {
    const response = await invoke('Update', props, oldProps);
    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain(message);
  });

  it.each([{ KeyPairs: [] }, {}])(
    'fails when the key pair does not exist (%j)',
    async (result) => {
      respond(DescribeKeyPairsCommand, () => result);
      const response = await invoke('Update');
      expect(response.Status).toBe('FAILED');
      expect(response.Reason).toContain('Key pair was not found');
    },
  );
});

describe('Delete', () => {
  it('deletes the key pair and both secrets without recovery', async () => {
    const response = await invoke('Delete');

    expect(response.Status).toBe('SUCCESS');
    expect(response.Data).toEqual({
      PrivateKeyARN: 'arn:prefix/test-key/private',
      PublicKeyARN: 'arn:prefix/test-key/public',
    });
    expect(inputs(DeleteKeyPairCommand)).toEqual([{ KeyName: 'test-key' }]);
    expect(inputs(DeleteSecretCommand)).toEqual([
      { SecretId: 'prefix/test-key/private', ForceDeleteWithoutRecovery: true },
      { SecretId: 'prefix/test-key/public', ForceDeleteWithoutRecovery: true },
    ]);
  });

  it('deletes the secrets with a recovery window', async () => {
    await invoke('Delete', { RemoveKeySecretsAfterDays: 7 });
    expect(inputs(DeleteSecretCommand)).toEqual([
      { SecretId: 'prefix/test-key/private', RecoveryWindowInDays: 7 },
      { SecretId: 'prefix/test-key/public', RecoveryWindowInDays: 7 },
    ]);
  });

  const invalidKeyPair = Object.assign(new Error('missing'), {
    name: 'InvalidKeyPair.NotFound',
  });

  it.each<[string, Responder]>([
    ['an empty list', () => ({ KeyPairs: [] })],
    ['no list', () => ({})],
    [
      'InvalidKeyPair.NotFound',
      () => {
        throw invalidKeyPair;
      },
    ],
    [
      'ResourceNotFoundException',
      () => {
        throw notFound();
      },
    ],
  ])('skips a missing key pair (%s)', async (_name, responder) => {
    respond(DescribeKeyPairsCommand, responder);
    const response = await invoke('Delete');
    expect(response.Status).toBe('SUCCESS');
    expect(inputs(DeleteKeyPairCommand)).toHaveLength(0);
  });

  it.each([new Error('throttled'), 'throttled'])(
    'fails when the key pair lookup fails (%s)',
    async (error) => {
      fail(DescribeKeyPairsCommand, error);
      const response = await invoke('Delete');
      expect(response.Status).toBe('FAILED');
      expect(response.Reason).toContain('throttled');
    },
  );

  it.each<[string, Responder]>([
    ['an empty list', () => ({ SecretList: [] })],
    ['no list', () => ({})],
    [
      'ResourceNotFoundException',
      () => {
        throw notFound();
      },
    ],
  ])('skips missing secrets (%s)', async (_name, responder) => {
    respond(ListSecretsCommand, responder);
    const response = await invoke('Delete');
    expect(response.Status).toBe('SUCCESS');
    expect(response.Data).toEqual({});
    expect(inputs(DeleteSecretCommand)).toHaveLength(0);
  });

  it('fails when the secret lookup fails', async () => {
    fail(ListSecretsCommand, new Error('access denied'));
    const response = await invoke('Delete');
    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('access denied');
  });
});
