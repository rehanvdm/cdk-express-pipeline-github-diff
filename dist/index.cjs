"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/main.ts
var core = __toESM(require("@actions/core"), 1);
var github = __toESM(require("@actions/github"), 1);

// src/diff.ts
var fs = __toESM(require("node:fs"), 1);
function generateDiffs(templateDiffs) {
  if (Object.keys(templateDiffs).length === 0) {
    return void 0;
  }
  const result = { stacks: {} };
  for (const [name, templateDiff] of Object.entries(templateDiffs)) {
    result.stacks[name] = generateStackDiff(templateDiff);
  }
  return result;
}
function saveDiffs(diffResult, outputDir) {
  if (Object.keys(diffResult.stacks).length === 0) {
    return;
  }
  for (const [stackNameId, stackDiff] of Object.entries(diffResult.stacks)) {
    if (!fs.existsSync(`${outputDir}/cdk-express-pipeline/diffs`)) {
      fs.mkdirSync(`${outputDir}/cdk-express-pipeline/diffs`, { recursive: true });
    }
    const filePath = `${outputDir}/cdk-express-pipeline/diffs/${stackNameId}.json`;
    fs.writeFileSync(filePath, JSON.stringify(stackDiff, null, 2));
  }
}
function getSavedDiffs(outputDir) {
  const combinedDiff = { stacks: {} };
  const files = fs.readdirSync(`${outputDir}/cdk-express-pipeline/diffs`);
  for (const file of files) {
    const stackId = file.replace(".json", "");
    const stackDiff = JSON.parse(fs.readFileSync(`${outputDir}/cdk-express-pipeline/diffs/${file}`, "utf-8"));
    combinedDiff.stacks[stackId] = stackDiff;
  }
  return combinedDiff;
}
function generateMarkdown(order, diffResult) {
  let markdown = `---
`;
  markdown += "```diff\n";
  order.waves.forEach((wave) => {
    markdown += `\u{1F30A} ${wave.waveId}
`;
    wave.stages.forEach((stage) => {
      markdown += `  \u{1F3D7} ${stage.stageId}
`;
      stage.stacks.forEach((stack) => {
        const stackDiff = diffResult.stacks[stack.stackId];
        if (stackDiff) {
          markdown += `    \u{1F4E6} ${stack.stackName} (${stack.stackId})
`;
          if (stackDiff.markdown) {
            markdown += `${stackDiff.markdown}
`;
          }
        }
      });
    });
  });
  markdown += "```\n";
  return markdown;
}
function generateStackDiff(templateDiff) {
  const stackDiff = {
    summary: {
      additions: 0,
      removals: 0,
      updates: 0
    },
    markdown: ""
  };
  const changes = [];
  templateDiff.resources.forEachDifference((logicalId, change) => {
    if (ignoreResource(change)) {
      return;
    }
    if (change.isUpdate) {
      stackDiff.summary.updates++;
      const replacementIndicator = change.changeImpact === "WILL_REPLACE" ? " [\u{1F4A5} REPLACEMENT]" : "";
      changes.push(
        `!       [~] ${change.oldValue?.Type || change.newValue?.Type} ${logicalId} ${logicalId}${replacementIndicator}`
      );
      Object.entries(change.propertyUpdates).forEach(([propertyPath, propertyChange]) => {
        if (propertyChange.isAddition) {
          changes.push(`!         \u2514\u2500 [+] ${propertyPath}`);
          changes.push(`!             \u2514\u2500 [+] ${JSON.stringify(propertyChange.newValue)}`);
        } else if (propertyChange.isRemoval) {
          changes.push(`!         \u2514\u2500 [-] ${propertyPath}`);
          changes.push(`!             \u2514\u2500 [-] ${JSON.stringify(propertyChange.oldValue)}`);
        } else if (propertyChange.isUpdate) {
          changes.push(`!         \u2514\u2500 [~] ${propertyPath}`);
          changes.push(`!             \u251C\u2500 [-] ${JSON.stringify(propertyChange.oldValue)}`);
          changes.push(`!             \u2514\u2500 [+] ${JSON.stringify(propertyChange.newValue)}`);
        }
      });
    } else if (change.isAddition) {
      stackDiff.summary.additions++;
      changes.push(`+       [+] ${change.newValue?.Type} ${logicalId} ${logicalId}`);
    } else if (change.isRemoval) {
      stackDiff.summary.removals++;
      changes.push(`-       [-] ${change.oldValue?.Type} ${logicalId} ${logicalId}`);
    }
  });
  if (changes.length > 0) {
    stackDiff.markdown = changes.join("\n");
  }
  return stackDiff;
}
function ignoreResource(change) {
  const resourceType = change.oldValue?.Type ?? change.newValue?.Type;
  switch (resourceType) {
    case "AWS::CDK::Metadata":
      return true;
    case "AWS::Lambda::Function": {
      const keys = Object.keys(change.propertyUpdates);
      if (keys.length <= 2 && keys.includes("Code") || keys.includes("Metadata")) {
        return true;
      }
    }
  }
  return false;
}

// src/main.ts
var import_toolkit_lib = require("@aws-cdk/toolkit-lib");
var import_node_path = __toESM(require("node:path"), 1);
var import_node_fs = __toESM(require("node:fs"), 1);

// src/output.ts
var import_core = require("@octokit/core");
var import_plugin_rest_endpoint_methods = require("@octokit/plugin-rest-endpoint-methods");
var MAX_DESCRIPTION_LENGTH = 262145;
async function updateGithubPrDescription(owner, repo, pullNumber, ghToken, markdown, gitHash) {
  const MyOctokit = import_core.Octokit.plugin(import_plugin_rest_endpoint_methods.restEndpointMethods);
  const octokit = new MyOctokit({ auth: ghToken });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const marker = "<!-- CDK_EXPRESS_PIPELINE_DIFF_MARKER -->";
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
  const currentDescription = response.data.body || "";
  const markerRegex = new RegExp(`${marker}[\\s\\S]*`, "g");
  const cleanedDescription = currentDescription.replace(markerRegex, "").trim();
  let combinedContent = cleanedDescription + (cleanedDescription ? "\n\n" : "") + newContent;
  if (combinedContent.length > MAX_DESCRIPTION_LENGTH) {
    const availableSpace = MAX_DESCRIPTION_LENGTH - 100;
    combinedContent = combinedContent.substring(0, availableSpace) + "... TRUNCATED Look at GitHub Actions logs for full diff";
  }
  await octokit.rest.pulls.update({
    owner,
    repo,
    pull_number: pullNumber,
    body: combinedContent
  });
  return combinedContent;
}

// src/main.ts
async function run() {
  try {
    const mode = core.getInput("mode", { required: true });
    if (mode !== "generate" && mode !== "print") {
      core.setFailed(`Invalid mode '${mode}' specified. Valid modes are 'generate' or 'print'.`);
      return;
    }
    const cloudAssemblyDirectory = core.getInput("cloud-assembly-directory", { required: true });
    if (mode === "generate")
      await generate(cloudAssemblyDirectory);
    else if (mode === "print")
      await print(cloudAssemblyDirectory);
    core.info("Successfully updated PR description with CDK Express Pipeline diff");
  } catch (error) {
    if (error instanceof Error)
      core.setFailed(error.message);
  }
}
async function generate(cloudAssemblyDirectory) {
  const cdkToolkit = new import_toolkit_lib.Toolkit();
  const cx = await cdkToolkit.fromAssemblyDirectory(cloudAssemblyDirectory);
  const stackSelectors = core.getInput("stack-selectors", { required: true });
  const patterns = stackSelectors.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  const templateDiffs = await cdkToolkit.diff(cx, {
    method: import_toolkit_lib.DiffMethod.ChangeSet(),
    stacks: {
      strategy: import_toolkit_lib.StackSelectionStrategy.PATTERN_MUST_MATCH,
      patterns,
      expand: import_toolkit_lib.ExpandStackSelection.NONE,
      failOnEmpty: false
    }
  });
  const stackDiffs = generateDiffs(templateDiffs);
  if (!stackDiffs) {
    core.info("No changes detected in any stacks");
    return;
  }
  saveDiffs(stackDiffs, cloudAssemblyDirectory);
  core.info("Successfully generated CDK Express Pipeline diffs");
}
async function print(cloudAssemblyDirectory) {
  const githubToken = core.getInput("github-token", { required: true });
  let owner = core.getInput("owner");
  let repo = core.getInput("repo");
  let pullNumber = parseInt(core.getInput("pull-number"));
  let gitHash = core.getInput("git-hash");
  if (github.context.eventName === "pull_request") {
    const pushPayload = github.context.payload;
    if (!owner)
      owner = pushPayload.repository.owner.login;
    if (!repo)
      repo = pushPayload.repository.name;
    if (!pullNumber)
      pullNumber = pushPayload.pull_request.number;
    if (!gitHash)
      gitHash = pushPayload.pull_request.head.sha;
  }
  const allStackDiffs = getSavedDiffs(cloudAssemblyDirectory);
  const shortHandOrder = JSON.parse(
    import_node_fs.default.readFileSync(import_node_path.default.join(cloudAssemblyDirectory, "cdk-express-pipeline.json"), "utf-8")
  );
  const markdown = generateMarkdown(shortHandOrder, allStackDiffs);
  const result = await updateGithubPrDescription(owner, repo, pullNumber, githubToken, markdown, gitHash);
  core.info(result);
  await core.summary.addRaw(result).write({ overwrite: true });
}

// src/index.ts
run();
//# sourceMappingURL=index.cjs.map
