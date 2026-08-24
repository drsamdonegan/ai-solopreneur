import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(projectRoot, "optional-skills", "seo-article-writer");

const files = [
  {
    source: "skill/agents/openai.yaml",
    target: "skills/seo-article-writer/agents/openai.yaml",
    previous: "c1126ce4a2d0ed64bfdb32f2ef4858d21e76ddea421c411e4bf123102e9ad7f7",
  },
  {
    source: "skill/README.md",
    target: "skills/seo-article-writer/README.md",
    previous: "a558a0a6d630ae49fce677b7db0b9bcf97ee2a186d44719d40e553f31e612f71",
  },
  {
    source: "skill/SKILL.md",
    target: "skills/seo-article-writer/SKILL.md",
    previous: "3dac8b0cc34a4a92ea4fac57aa37115cb92271024a5c81b083f5ea6440723254",
  },
  {
    source: "skill/skill.yaml",
    target: "skills/seo-article-writer/skill.yaml",
    previous: [
      "eebaa166f46e4c8c4aa9ee8d843aec5373e255224a69a1ebb54297c113cf49c8",
      "ac548c064c38a1bce0a84c74a058c02906e917ab232324d5e8aa5f9d50d3dbf8",
    ],
  },
  {
    source: "skill/references/article-contract.md",
    target: "skills/seo-article-writer/references/article-contract.md",
    previous: "975efecef4f9d909cd13b37dec9bacdfe8585b1e11dc096c64545df2ac0a5b4e",
  },
  {
    source: "workflows/56-tool-start-seo-article.json",
    target: "n8n/workflows/56-tool-start-seo-article.json",
    previous: [
      "4547b427b0ba860024235951c8ff7329234211a16481b5dbe367fdc5a58e99d3",
      "7e1a4ac42b983cffa282187181c86897a2e3996c5d9a07ad71b43aefaa3424fe",
    ],
    json: true,
  },
  {
    source: "workflows/57-internal-write-seo-article.json",
    target: "n8n/workflows/57-internal-write-seo-article.json",
    previous: "ccec1cd6cfb688847c23b202fd246180c3a6cd9b96bc43725d2a8d69776ef317",
    json: true,
  },
  {
    source: "workflows/58-tool-get-seo-article.json",
    target: "n8n/workflows/58-tool-get-seo-article.json",
    previous: "a595f8492c389178371e88fbc7a373ad415fe824f68ae15250fb5d17cf72c547",
    json: true,
  },
];

const oldToolHashes = [
  "d4b9faecb77f410bd2ecdfffaaad49d13c59911435ef0e8ab40d9574ef3bc976",
  "3088d5b4ef201430d7ffe6e18869b3e132f06e0b16a76b64d1fad35e18afa4e2",
];
const oldRules = [
  "- start_seo_article is risk=bounded_local_write. Use it only when the current user explicitly asks to draft an article. It starts a local writing job and saves the draft to this conversation; it never publishes anything anywhere.",
  "- get_seo_article is risk=read and is the source of truth for a draft started in this conversation. It reports a saved draft; it never writes one.",
];

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function node(workflow, name) {
  const result = workflow.nodes.find((entry) => entry.name === name);
  if (!result) throw new Error(`The installed agent is missing ${name}.`);
  return result;
}

const manifest = JSON.parse(await readFile(join(packageRoot, "manifest.json"), "utf8"));
const sourceTool = manifest.agentTools.find((entry) => entry.name === "start_seo_article");
const sourceToolHash = hash(JSON.stringify(sourceTool.parameters));
const pendingFiles = [];

for (const entry of files) {
  const sourcePath = join(packageRoot, entry.source);
  const targetPath = join(projectRoot, entry.target);
  const [source, target] = await Promise.all([readFile(sourcePath), readFile(targetPath)]);
  const sourceHash = hash(entry.json ? JSON.stringify(JSON.parse(source)) : source);
  const targetHash = hash(entry.json ? JSON.stringify(JSON.parse(target)) : target);
  const previousHashes = Array.isArray(entry.previous) ? entry.previous : [entry.previous];
  if (targetHash !== sourceHash && !previousHashes.includes(targetHash)) {
    throw new Error(
      `${entry.target} has local changes. The upgrade stopped before writing anything. ` +
        "Back up or reconcile that file, then run this command again.",
    );
  }
  if (targetHash !== sourceHash) pendingFiles.push({ targetPath, source });
}

const agentPath = join(projectRoot, "n8n", "workflows", "00-start-here-project-partner.json");
const agent = JSON.parse(await readFile(agentPath, "utf8"));
const installedTool = node(agent, "start_seo_article");
const installedToolHash = hash(JSON.stringify(installedTool.parameters));
if (![...oldToolHashes, sourceToolHash].includes(installedToolHash)) {
  throw new Error(
    "The installed start_seo_article tool has local changes. The upgrade stopped before writing anything.",
  );
}

const context = node(agent, "Build Agent Context");
const hasOldRules = oldRules.every((rule) => context.parameters.jsCode.includes(JSON.stringify(rule)));
const hasNewRules = manifest.policyRules.every((rule) =>
  context.parameters.jsCode.includes(JSON.stringify(rule)),
);
if (!hasOldRules && !hasNewRules) {
  throw new Error(
    "The installed Marketing article policy has local or partial changes. The upgrade stopped before writing anything.",
  );
}

const policyPath = join(projectRoot, "tools", "policy.json");
const policy = JSON.parse(await readFile(policyPath, "utf8"));
const installedPolicy = policy.tools.find((entry) => entry.id === "start_seo_article");
if (
  installedPolicy === undefined ||
  !["bounded_local_write", "bounded_external_read_and_local_write"].includes(installedPolicy.risk)
) {
  throw new Error(
    "The installed start_seo_article policy has local changes. The upgrade stopped before writing anything.",
  );
}

for (const { targetPath, source } of pendingFiles) await writeFile(targetPath, source);

installedTool.parameters = structuredClone(sourceTool.parameters);
if (!hasNewRules) {
  for (const rule of oldRules) {
    context.parameters.jsCode = context.parameters.jsCode.replace(
      `${JSON.stringify(rule)},\n      `,
      "",
    );
  }
  const anchor = "/* INSTALL marketing TOOL RULES */";
  for (const rule of [...manifest.policyRules].reverse()) {
    context.parameters.jsCode = context.parameters.jsCode.replace(
      anchor,
      `${JSON.stringify(rule)},\n      ${anchor}`,
    );
  }
}
installedPolicy.risk = "bounded_external_read_and_local_write";

await writeFile(agentPath, `${JSON.stringify(agent, null, 2)}\n`);
await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`);

process.stdout.write(
  pendingFiles.length === 0 && installedToolHash === sourceToolHash && hasNewRules
    ? "SEO Article Writer is already current.\n"
    : "SEO Article Writer upgraded safely. Run npm run sync-skills and npm run import-workflows, then restart the services.\n",
);
