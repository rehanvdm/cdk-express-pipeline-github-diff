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
  const now = new Date().toISOString();

  const marker = '<!-- CDK_EXPRESS_PIPELINE_DIFF_MARKER -->';
  const newContent = `${marker}
---
> DO NOT MAKE CHANGES BELOW THIS LINE, IT WILL BE OVERWRITTEN ON NEXT DIFF

## CDK Express Pipeline Diff

${markdown}

---
Git Hash: ${gitHash} | Generated At: ${now}`;

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
