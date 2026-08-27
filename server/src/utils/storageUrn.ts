export function parseStorageUrn(storageUrn: string): { bucketKey: string; objectKey: string } {
  const match = /^urn:adsk\.objects:os\.object:([^/]+)\/(.+)$/.exec(storageUrn);
  if (!match) {
    throw new Error(`Unrecognized storage URN format: ${storageUrn}`);
  }
  return { bucketKey: match[1], objectKey: match[2] };
}
