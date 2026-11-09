import { CustomResource, Logger } from 'aws-cloudformation-custom-resource';
import { ResourceProperties } from './types';

export type Resource = CustomResource<ResourceProperties>;

/** A tag as both the EC2 and the Secrets Manager API accept it */
export interface Tag {
  /* eslint-disable @typescript-eslint/naming-convention */
  Key: string;
  Value: string;
  /* eslint-enable @typescript-eslint/naming-convention */
}

/**
 * The CloudFormation tags of the resource plus the given tags
 */
export function makeTags(
  resource: Resource,
  eventTags?: Record<string, string>,
): Tag[] {
  const tags: Tag[] = [
    /* eslint-disable @typescript-eslint/naming-convention */
    { Key: 'aws-cloudformation:stack-id', Value: resource.event.StackId },
    {
      Key: 'aws-cloudformation:stack-name',
      Value: resource.properties.StackName.value,
    },
    {
      Key: 'aws-cloudformation:logical-id',
      Value: resource.event.LogicalResourceId,
    },
    /* eslint-enable @typescript-eslint/naming-convention */
  ];
  for (const [key, value] of Object.entries(eventTags ?? {})) {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    tags.push({ Key: key, Value: value });
  }
  return tags;
}

/**
 * Whether the tags changed with this update. Logs if they didn't.
 */
export function tagsChanged(
  resource: Resource,
  log: Logger,
  target: string,
): boolean {
  if (resource.properties.Tags.changed) {
    return true;
  }
  log.info(
    `No changes of tags detected for ${target}. Not attempting any update`,
  );
  return false;
}

/**
 * The tags that were removed with this update. Logs if there are none.
 */
export function removedTags(
  resource: Resource,
  log: Logger,
  target: string,
): Tag[] {
  const newKeys = new Set(
    makeTags(resource, resource.properties.Tags.value).map((tag) => tag.Key),
  );
  const removed = makeTags(resource, resource.properties.Tags.before).filter(
    (tag) => !newKeys.has(tag.Key),
  );
  if (!removed.length) {
    log.info(
      `No changes of tags detected for ${target}. Not attempting any update`,
    );
    return removed;
  }
  log.info(
    'Will remove the following tags:',
    JSON.stringify(
      removed.map((tag) => tag.Key),
      null,
      2,
    ),
  );
  return removed;
}
