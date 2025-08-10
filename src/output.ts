import { Octokit } from '@octokit/core';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';

const MAX_DESCRIPTION_LENGTH = 262145;

export async function updateGithubPrDescription(
  owner: string,
  repo: string,
  pullNumber: number,
  ghToken: string,
  markdown: string,
  gitHash: string
) {
  const MyOctokit = Octokit.plugin(restEndpointMethods);
  const octokit = new MyOctokit({ auth: ghToken });

  // Get current timestamp
  const now =
    new Date()
      .toISOString() // e.g. "2025-08-09T15:43:22.000Z"
      .replace('T', ' ') // "2025-08-09 15:43:22.000Z"
      .replace(/\.\d{3}Z$/, '') + // remove milliseconds + Z
    ' (UTC)'; // append UTC

  const marker = '<!-- CDK_EXPRESS_PIPELINE_DIFF_MARKER -->';
  const newContent = `${marker}
<!-- DO NOT MAKE CHANGES BELOW THIS LINE, IT WILL BE OVERWRITTEN ON NEXT DIFF -->
---
## CDK Diff

${markdown}

*Generated At: ${now} from commit: ${gitHash}*`;

  const response = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber
  });

  const currentDescription = response.data.body || '';
  const markerRegex = new RegExp(`${marker}[\\s\\S]*`, 'g');
  const cleanedDescription = currentDescription.replace(markerRegex, '').trim();

  let combinedContent = cleanedDescription + (cleanedDescription ? '\n\n' : '') + newContent;

  if (combinedContent.length > MAX_DESCRIPTION_LENGTH) {
    const availableSpace = MAX_DESCRIPTION_LENGTH - 100;
    combinedContent =
      combinedContent.substring(0, availableSpace) + '... TRUNCATED Look at GitHub Actions logs for full diff';
  }

  await octokit.rest.pulls.update({
    owner,
    repo,
    pull_number: pullNumber,
    body: combinedContent
  });

  return combinedContent;
}
