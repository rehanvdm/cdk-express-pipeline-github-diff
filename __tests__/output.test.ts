//@ts-expect-error TS/JS import issue but works
import { updateGithubPrDescription } from '../src/output';

// Mock the modules
jest.mock('@octokit/core', () => {
  const mockOctokitInstance = {
    rest: {
      pulls: {
        get: jest.fn(),
        update: jest.fn()
      }
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MockOctokitClass = jest.fn().mockImplementation(() => mockOctokitInstance) as any;
  MockOctokitClass.plugin = jest.fn().mockReturnValue(MockOctokitClass);

  return {
    Octokit: MockOctokitClass
  };
});

jest.mock('@octokit/plugin-rest-endpoint-methods', () => ({
  restEndpointMethods: jest.fn()
}));

describe('updateGithubPrDescription', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockOctokitInstance: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockRestEndpointMethods: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Get the mocked modules
    //eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Octokit } = require('@octokit/core');
    //eslint-disable-next-line @typescript-eslint/no-require-imports
    const { restEndpointMethods } = require('@octokit/plugin-rest-endpoint-methods');

    // Get the mock instance
    mockOctokitInstance = new Octokit();
    mockRestEndpointMethods = restEndpointMethods;

    // Setup the mock implementation
    mockRestEndpointMethods.mockReturnValue(mockOctokitInstance.rest);

    // Mock timestamp
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should update PR description with new content when no existing marker', async () => {
    const owner = 'test-owner';
    const repo = 'test-repo';
    const pullNumber = 123;
    const ghToken = 'test-token';
    const markdown = '## Test Diff\n- Added resource A\n- Modified resource B';
    const gitHash = 'abc123def456';

    const existingDescription = 'This is an existing PR description';

    mockOctokitInstance.rest.pulls.get.mockResolvedValue({
      data: { body: existingDescription }
    });

    mockOctokitInstance.rest.pulls.update.mockResolvedValue({});

    const result = await updateGithubPrDescription(owner, repo, pullNumber, ghToken, markdown, gitHash);

    expect(mockOctokitInstance.rest.pulls.get).toHaveBeenCalledWith({
      owner,
      repo,
      pull_number: pullNumber
    });

    expect(mockOctokitInstance.rest.pulls.update).toHaveBeenCalledWith({
      owner,
      repo,
      pull_number: pullNumber,
      body: result
    });

    expect(result).toMatchSnapshot();
  });

  it('should replace existing marker content with new content', async () => {
    const owner = 'test-owner';
    const repo = 'test-repo';
    const pullNumber = 123;
    const ghToken = 'test-token';
    const markdown = '## New Diff\n- Updated resource C';
    const gitHash = 'abc123def456';

    const existingDescription = `This is an existing PR description

<!-- CDK_EXPRESS_PIPELINE_DIFF_MARKER -->
---
### CDK Express Pipeline Diff
## Old Diff
- Old resource A
- Old resource B`;

    mockOctokitInstance.rest.pulls.get.mockResolvedValue({
      data: { body: existingDescription }
    });

    mockOctokitInstance.rest.pulls.update.mockResolvedValue({});

    const result = await updateGithubPrDescription(owner, repo, pullNumber, ghToken, markdown, gitHash);

    expect(mockOctokitInstance.rest.pulls.update).toHaveBeenCalledWith({
      owner,
      repo,
      pull_number: pullNumber,
      body: result
    });

    expect(result).toMatchSnapshot();
  });

  it('should handle empty existing description', async () => {
    const owner = 'test-owner';
    const repo = 'test-repo';
    const pullNumber = 123;
    const ghToken = 'test-token';
    const markdown = '## Test Diff\n- Added resource A';
    const gitHash = 'abc123def456';

    mockOctokitInstance.rest.pulls.get.mockResolvedValue({
      data: { body: null }
    });

    mockOctokitInstance.rest.pulls.update.mockResolvedValue({});

    const result = await updateGithubPrDescription(owner, repo, pullNumber, ghToken, markdown, gitHash);

    expect(mockOctokitInstance.rest.pulls.update).toHaveBeenCalledWith({
      owner,
      repo,
      pull_number: pullNumber,
      body: result
    });

    expect(result).toMatchSnapshot();
  });

  it('should truncate content when it exceeds maximum length', async () => {
    const owner = 'test-owner';
    const repo = 'test-repo';
    const pullNumber = 123;
    const ghToken = 'test-token';
    const gitHash = 'abc123def456';

    // Create a markdown that would exceed the limit
    const longMarkdown = '# Very Long Diff\n' + 'A'.repeat(300000);
    const existingDescription = 'B'.repeat(100000);

    mockOctokitInstance.rest.pulls.get.mockResolvedValue({
      data: { body: existingDescription }
    });

    mockOctokitInstance.rest.pulls.update.mockResolvedValue({});

    const result = await updateGithubPrDescription(owner, repo, pullNumber, ghToken, longMarkdown, gitHash);

    expect(result).toContain('... TRUNCATED Look at GitHub Actions logs for full diff');
    expect(result.length).toBeLessThanOrEqual(262145);
    expect(result).toMatchSnapshot();
  });

  it('should handle multiple existing markers and remove all', async () => {
    const owner = 'test-owner';
    const repo = 'test-repo';
    const pullNumber = 123;
    const ghToken = 'test-token';
    const markdown = '## New Diff\n- Updated resource';
    const gitHash = 'abc123def456';

    const existingDescription = `Original description

<!-- CDK_EXPRESS_PIPELINE_DIFF_MARKER -->
---
### CDK Express Pipeline Diff
## Old Diff 1
- Old content 1

Some text in between

<!-- CDK_EXPRESS_PIPELINE_DIFF_MARKER -->
---
### CDK Express Pipeline Diff
## Old Diff 2
- Old content 2`;

    mockOctokitInstance.rest.pulls.get.mockResolvedValue({
      data: { body: existingDescription }
    });

    mockOctokitInstance.rest.pulls.update.mockResolvedValue({});

    const result = await updateGithubPrDescription(owner, repo, pullNumber, ghToken, markdown, gitHash);

    expect(mockOctokitInstance.rest.pulls.update).toHaveBeenCalledWith({
      owner,
      repo,
      pull_number: pullNumber,
      body: result
    });

    expect(result).toMatchSnapshot();
  });

  it('should handle description with only whitespace', async () => {
    const owner = 'test-owner';
    const repo = 'test-repo';
    const pullNumber = 123;
    const ghToken = 'test-token';
    const markdown = '## Test Diff\n- Added resource A';
    const gitHash = 'abc123def456';

    mockOctokitInstance.rest.pulls.get.mockResolvedValue({
      data: { body: '   \n  \n  ' }
    });

    mockOctokitInstance.rest.pulls.update.mockResolvedValue({});

    const result = await updateGithubPrDescription(owner, repo, pullNumber, ghToken, markdown, gitHash);

    expect(mockOctokitInstance.rest.pulls.update).toHaveBeenCalledWith({
      owner,
      repo,
      pull_number: pullNumber,
      body: result
    });

    expect(result).toMatchSnapshot();
  });

  it('should handle API errors gracefully', async () => {
    const owner = 'test-owner';
    const repo = 'test-repo';
    const pullNumber = 123;
    const ghToken = 'test-token';
    const markdown = '## Test Diff';
    const gitHash = 'abc123def456';

    mockOctokitInstance.rest.pulls.get.mockRejectedValue(new Error('API Error'));

    await expect(updateGithubPrDescription(owner, repo, pullNumber, ghToken, markdown, gitHash)).rejects.toThrow(
      'API Error'
    );
  });
});
