import { createHash } from 'crypto';

export const CDK_EXPRESS_PIPELINE_JSON_FILE = 'cdk-express-pipeline.json';

export function getCacheHash(stackSelector: string, cloudAssemblyDirectory: string): string {
  return createHash('md5')
    .update(stackSelector + cloudAssemblyDirectory)
    .digest('hex');
}

export function getCacheKey(stackSelector?: string, cloudAssemblyDirectory?: string): string {
  let ret = `cdk-diff-pipeline-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}-`;
  if (stackSelector) {
    ret += getCacheHash(stackSelector, cloudAssemblyDirectory!);
  }
  return ret;
}

/**
 * Returns unique (hashed) directory paths used when saving/restoring cache artifacts.
 * The hashed paths are siblings of the canonical paths (not children) so that copying
 * between them does not produce a self-copy error.
 *
 * e.g. canonical:  cdk.out/cdk-express-pipeline/diffs
 *      hashed:     cdk.out/cdk-express-pipeline/diffs-<hash>
 */
export function getHashedCachePaths(
  savedDir: string,
  pipelineOrderFile: string,
  hash: string
): { hashedSavedDir: string; hashedPipelineOrderFile: string } {
  return {
    hashedSavedDir: `${savedDir}-${hash}`,
    hashedPipelineOrderFile: `${pipelineOrderFile}.${hash}`
  };
}
