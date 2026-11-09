/* eslint-disable @typescript-eslint/naming-convention */
import { Context, Event } from 'aws-cloudformation-custom-resource';
import { describe, expect, it, vi } from 'vitest';
import { handler } from '../lambda/index';
import { ResourceProperties } from '../lambda/types';

// The library only passes Error objects to the callback. Replace it to cover
// how the handler deals with string errors.
const callbackArgs = vi.hoisted((): { error: unknown } => ({
  error: undefined,
}));

vi.mock('aws-cloudformation-custom-resource', () => ({
  CustomResource: class {
    constructor(
      _event: unknown,
      _context: unknown,
      callback: (e?: unknown) => void,
    ) {
      setTimeout(() => callback(callbackArgs.error));
    }
  },
  StandardLogger: class {},
}));

const event = {
  RequestType: 'Create',
  StackId: 'stack',
  RequestId: 'request',
  LogicalResourceId: 'Key',
  ResourceProperties: {},
} as unknown as Event<ResourceProperties>;

describe('handler callback', () => {
  it('turns string errors into Error objects', async () => {
    callbackArgs.error = 'something broke';
    await expect(handler(event, {} as Context)).rejects.toThrow(
      new Error('something broke'),
    );
  });

  it('resolves without error', async () => {
    callbackArgs.error = undefined;
    await expect(handler(event, {} as Context)).resolves.toBeUndefined();
  });
});
