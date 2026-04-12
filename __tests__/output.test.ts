//@ts-expect-error TS/JS import issue but works
import { updateGithubPrDescription, setGeneratingPrDescription, getNowFormated } from '../src/utils/output';

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
    const diffs = [
      {
        header: 'CDK Diff',
        markdown: '...',
        summary: { additions: 1, updates: 1, removals: 0 }
      }
    ];
    const gitHash = 'abc123def456';

    const existingDescription = 'This is an existing PR description';

    mockOctokitInstance.rest.pulls.get.mockResolvedValue({
      data: { body: existingDescription }
    });

    mockOctokitInstance.rest.pulls.update.mockResolvedValue({});

    const result = await updateGithubPrDescription(owner, repo, pullNumber, ghToken, diffs, gitHash);

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
    const diffs = [
      {
        header: 'CDK Diff',
        markdown: '...',
        summary: { additions: 0, updates: 1, removals: 0 }
      }
    ];
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

    const result = await updateGithubPrDescription(owner, repo, pullNumber, ghToken, diffs, gitHash);

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
    const diffs = [
      {
        header: 'CDK Diff',
        markdown: '...',
        summary: { additions: 1, updates: 0, removals: 0 }
      }
    ];
    const gitHash = 'abc123def456';

    mockOctokitInstance.rest.pulls.get.mockResolvedValue({
      data: { body: null }
    });

    mockOctokitInstance.rest.pulls.update.mockResolvedValue({});

    const result = await updateGithubPrDescription(owner, repo, pullNumber, ghToken, diffs, gitHash);

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
    const longMarkdown = 'Very Long Diff\n' + 'A'.repeat(300000);
    const diffs = [
      {
        header: 'CDK Diff',
        markdown: longMarkdown,
        summary: { additions: 1, updates: 0, removals: 0 }
      }
    ];
    const existingDescription = 'B'.repeat(100000);

    mockOctokitInstance.rest.pulls.get.mockResolvedValue({
      data: { body: existingDescription }
    });

    mockOctokitInstance.rest.pulls.update.mockResolvedValue({});

    const result = await updateGithubPrDescription(owner, repo, pullNumber, ghToken, diffs, gitHash);

    expect(result).toContain('... TRUNCATED Look at GitHub Actions logs for full diff');
    expect(result.length).toBeLessThanOrEqual(262145);
    expect(result).toMatchSnapshot();
  });

  it('should handle multiple existing markers and remove all', async () => {
    const owner = 'test-owner';
    const repo = 'test-repo';
    const pullNumber = 123;
    const ghToken = 'test-token';
    const diffs = [
      {
        header: 'CDK Diff',
        markdown: '...',
        summary: { additions: 0, updates: 1, removals: 0 }
      }
    ];
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

    const result = await updateGithubPrDescription(owner, repo, pullNumber, ghToken, diffs, gitHash);

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
    const diffs = [
      {
        header: 'CDK Diff',
        markdown: '...',
        summary: { additions: 1, updates: 0, removals: 0 }
      }
    ];
    const gitHash = 'abc123def456';

    mockOctokitInstance.rest.pulls.get.mockResolvedValue({
      data: { body: '   \n  \n  ' }
    });

    mockOctokitInstance.rest.pulls.update.mockResolvedValue({});

    const result = await updateGithubPrDescription(owner, repo, pullNumber, ghToken, diffs, gitHash);

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
    const diffs = [
      {
        header: 'CDK Diff',
        markdown: '...',
        summary: { additions: 0, updates: 0, removals: 0 }
      }
    ];
    const gitHash = 'abc123def456';

    mockOctokitInstance.rest.pulls.get.mockRejectedValue(new Error('API Error'));

    await expect(updateGithubPrDescription(owner, repo, pullNumber, ghToken, diffs, gitHash)).rejects.toThrow(
      'API Error'
    );
  });

  it('should handle multiple diffs', async () => {
    const owner = 'test-owner';
    const repo = 'test-repo';
    const pullNumber = 123;
    const ghToken = 'test-token';
    const diffs = [
      {
        header: 'CDK Diff Dev',
        markdown: '...',
        summary: { additions: 1, updates: 1, removals: 0 }
      },
      {
        header: 'CDK Diff Prod',
        markdown: '...',
        summary: { additions: 0, updates: 1, removals: 1 }
      }
    ];
    const gitHash = 'abc123def456';

    const existingDescription = 'Original description';

    mockOctokitInstance.rest.pulls.get.mockResolvedValue({
      data: { body: existingDescription }
    });

    mockOctokitInstance.rest.pulls.update.mockResolvedValue({});

    const result = await updateGithubPrDescription(owner, repo, pullNumber, ghToken, diffs, gitHash);

    expect(mockOctokitInstance.rest.pulls.update).toHaveBeenCalledWith({
      owner,
      repo,
      pull_number: pullNumber,
      body: result
    });

    expect(result).toContain('CDK Diff Dev');
    expect(result).toContain('CDK Diff Prod');
    expect(result).toMatchSnapshot();
  });

  it('should render collapsed <details> when expandDetails is false', async () => {
    const owner = 'test-owner';
    const repo = 'test-repo';
    const pullNumber = 123;
    const ghToken = 'test-token';
    const diffs = [
      {
        header: 'CDK Diff',
        markdown: '...',
        summary: { additions: 1, updates: 0, removals: 0 }
      }
    ];
    const gitHash = 'abc123def456';

    mockOctokitInstance.rest.pulls.get.mockResolvedValue({
      data: { body: null }
    });

    mockOctokitInstance.rest.pulls.update.mockResolvedValue({});

    const result = await updateGithubPrDescription(owner, repo, pullNumber, ghToken, diffs, gitHash, undefined, false);

    expect(result).toContain('<details>');
    expect(result).not.toContain('<details open>');
    expect(result).toMatchSnapshot();
  });

  it('should render expanded <details> when expandDetails is true (explicit)', async () => {
    const owner = 'test-owner';
    const repo = 'test-repo';
    const pullNumber = 123;
    const ghToken = 'test-token';
    const diffs = [
      {
        header: 'CDK Diff',
        markdown: '...',
        summary: { additions: 1, updates: 0, removals: 0 }
      }
    ];
    const gitHash = 'abc123def456';

    mockOctokitInstance.rest.pulls.get.mockResolvedValue({
      data: { body: null }
    });

    mockOctokitInstance.rest.pulls.update.mockResolvedValue({});

    const result = await updateGithubPrDescription(owner, repo, pullNumber, ghToken, diffs, gitHash, undefined, true);

    expect(result).toContain('<details open>');
    expect(result).toMatchSnapshot();
  });
});

describe('setGeneratingPrDescription', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockOctokitInstance: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockRestEndpointMethods: any;

  beforeEach(() => {
    jest.clearAllMocks();

    //eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Octokit } = require('@octokit/core');
    //eslint-disable-next-line @typescript-eslint/no-require-imports
    const { restEndpointMethods } = require('@octokit/plugin-rest-endpoint-methods');

    mockOctokitInstance = new Octokit();
    mockRestEndpointMethods = restEndpointMethods;

    mockRestEndpointMethods.mockReturnValue(mockOctokitInstance.rest);

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should set PR description to generating state when no existing marker', async () => {
    const owner = 'test-owner';
    const repo = 'test-repo';
    const pullNumber = 123;
    const ghToken = 'test-token';
    const gitHash = 'abc123def456';

    mockOctokitInstance.rest.pulls.get.mockResolvedValue({
      data: { body: 'Existing PR description' }
    });

    mockOctokitInstance.rest.pulls.update.mockResolvedValue({});

    const result = await setGeneratingPrDescription(owner, repo, pullNumber, ghToken, gitHash);

    expect(mockOctokitInstance.rest.pulls.update).toHaveBeenCalledWith({
      owner,
      repo,
      pull_number: pullNumber,
      body: result
    });

    expect(result).toContain('⏳ Generating diff from latest commit: abc123def456');
    expect(result).toMatchSnapshot();
  });

  it('should replace existing marker content with generating state', async () => {
    const owner = 'test-owner';
    const repo = 'test-repo';
    const pullNumber = 123;
    const ghToken = 'test-token';
    const gitHash = 'abc123def456';

    const existingDescription = `Existing PR description

<!-- CDK_EXPRESS_PIPELINE_DIFF_MARKER -->
<!-- DO NOT MAKE CHANGES BELOW THIS LINE, IT WILL BE OVERWRITTEN ON NEXT DIFF -->
---
## CDK Diff

*Generated At: 2024-01-01 11:00:00 (UTC) from commit: oldHash123*`;

    mockOctokitInstance.rest.pulls.get.mockResolvedValue({
      data: { body: existingDescription }
    });

    mockOctokitInstance.rest.pulls.update.mockResolvedValue({});

    const result = await setGeneratingPrDescription(owner, repo, pullNumber, ghToken, gitHash);

    expect(result).not.toContain('oldHash123');
    expect(result).toContain('⏳ Generating diff from latest commit: abc123def456');
    expect(result).toMatchSnapshot();
  });

  it('should handle empty existing description', async () => {
    const owner = 'test-owner';
    const repo = 'test-repo';
    const pullNumber = 123;
    const ghToken = 'test-token';
    const gitHash = 'abc123def456';

    mockOctokitInstance.rest.pulls.get.mockResolvedValue({
      data: { body: null }
    });

    mockOctokitInstance.rest.pulls.update.mockResolvedValue({});

    const result = await setGeneratingPrDescription(owner, repo, pullNumber, ghToken, gitHash);

    expect(result).toContain('⏳ Generating diff from latest commit: abc123def456');
    expect(result).toMatchSnapshot();
  });

  it('should skip update if description already contains generating marker', async () => {
    const owner = 'test-owner';
    const repo = 'test-repo';
    const pullNumber = 123;
    const ghToken = 'test-token';
    const gitHash = 'abc123def456';

    const existingDescription = `Existing PR description

<!-- CDK_EXPRESS_PIPELINE_DIFF_MARKER -->
<!-- DO NOT MAKE CHANGES BELOW THIS LINE, IT WILL BE OVERWRITTEN ON NEXT DIFF -->
---
## CDK Diff

⏳ Generating diff from latest commit: abc123def456 at 2024-01-01 12:00:00 (UTC)`;

    mockOctokitInstance.rest.pulls.get.mockResolvedValue({
      data: { body: existingDescription }
    });

    const result = await setGeneratingPrDescription(owner, repo, pullNumber, ghToken, gitHash);

    // Should not call update since the generating marker is already present
    expect(mockOctokitInstance.rest.pulls.update).not.toHaveBeenCalled();
    expect(result).toBe(existingDescription);
  });
});

describe('getNowFormated', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return UTC-only string when no timezones provided', () => {
    expect(getNowFormated()).toBe('2024-01-01 12:00:00 (UTC)');
  });

  it('should return UTC-only string when empty timezones array provided', () => {
    expect(getNowFormated([])).toBe('2024-01-01 12:00:00 (UTC)');
  });

  it('should append additional timezone times', () => {
    const result = getNowFormated(['America/New_York']);
    expect(result).toMatch(/^2024-01-01 12:00:00 \(UTC\) \| \d{2}:\d{2}:\d{2} \(.+\)$/);
    expect(result).toContain('2024-01-01 12:00:00 (UTC) |');
  });

  it('should append multiple timezone times', () => {
    const result = getNowFormated(['America/New_York', 'Europe/Paris']);
    expect(result).toContain('2024-01-01 12:00:00 (UTC) |');
    const parts = result.split(' | ');
    expect(parts).toHaveLength(3);
  });

  it('should skip invalid timezones silently', () => {
    const result = getNowFormated(['Invalid/Timezone']);
    expect(result).toBe('2024-01-01 12:00:00 (UTC)');
  });

  it('should skip invalid timezones but show valid ones', () => {
    const result = getNowFormated(['Invalid/Timezone', 'America/New_York']);
    expect(result).toContain('2024-01-01 12:00:00 (UTC) |');
    const parts = result.split(' | ');
    expect(parts).toHaveLength(2);
  });

  it('should append (+1d) when the timezone is ahead and crosses into the next day', () => {
    // UTC 2024-01-01T23:30:00Z → Asia/Tokyo (UTC+9) = 2024-01-02 08:30:00 JST
    jest.setSystemTime(new Date('2024-01-01T23:30:00.000Z'));
    const result = getNowFormated(['Asia/Tokyo']);
    expect(result).toContain('2024-01-01 23:30:00 (UTC) |');
    expect(result).toMatch(/\(\+1d\)/);
  });

  it('should append (-1d) when the timezone is behind and crosses into the previous day', () => {
    // UTC 2024-01-01T03:00:00Z → America/Los_Angeles (UTC-8 in winter) = 2023-12-31 19:00:00 PST
    jest.setSystemTime(new Date('2024-01-01T03:00:00.000Z'));
    const result = getNowFormated(['America/Los_Angeles']);
    expect(result).toContain('2024-01-01 03:00:00 (UTC) |');
    expect(result).toMatch(/\(-1d\)/);
  });

  it('should not append a day indicator when the timezone is on the same date as UTC', () => {
    // UTC 2024-01-01T12:00:00Z → America/New_York (UTC-5) = 2024-01-01 07:00:00 EST — same day
    const result = getNowFormated(['America/New_York']);
    expect(result).not.toMatch(/\([+-]\dd\)/);
    expect(result).toMatch(/^2024-01-01 12:00:00 \(UTC\) \| \d{2}:\d{2}:\d{2} \(.+\)$/);
  });
});

describe('updateGithubPrDescription with timezones', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockOctokitInstance: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockRestEndpointMethods: any;

  beforeEach(() => {
    jest.clearAllMocks();

    //eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Octokit } = require('@octokit/core');
    //eslint-disable-next-line @typescript-eslint/no-require-imports
    const { restEndpointMethods } = require('@octokit/plugin-rest-endpoint-methods');

    mockOctokitInstance = new Octokit();
    mockRestEndpointMethods = restEndpointMethods;
    mockRestEndpointMethods.mockReturnValue(mockOctokitInstance.rest);

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should include additional timezones in the Generated At line', async () => {
    const diffs = [
      {
        header: 'CDK Diff',
        markdown: '...',
        summary: { additions: 1, updates: 0, removals: 0 }
      }
    ];

    mockOctokitInstance.rest.pulls.get.mockResolvedValue({ data: { body: null } });
    mockOctokitInstance.rest.pulls.update.mockResolvedValue({});

    const result = await updateGithubPrDescription('owner', 'repo', 1, 'token', diffs, 'abc123', ['America/New_York']);

    expect(result).toContain('Generated At: 2024-01-01 12:00:00 (UTC) |');
    expect(result).toMatchSnapshot();
  });
});
