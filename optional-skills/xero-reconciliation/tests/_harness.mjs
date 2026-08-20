// Runs a workflow's Code nodes the way n8n does, offline.
//
// The one behaviour worth emulating exactly is that $('Some Node') throws when
// that node did not execute on this branch. Real outages in this repo have come
// from reading a node that never ran, so a harness that quietly returns
// undefined would pass code that dies in production.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export function loadWorkflow(file) {
  return JSON.parse(readFileSync(join(here, "..", "workflows", file), "utf8"));
}

export function codeOf(workflow, nodeName) {
  const node = workflow.nodes.find((entry) => entry.name === nodeName);
  if (!node) throw new Error(`no node named ${nodeName}`);
  if (typeof node.parameters?.jsCode !== "string") throw new Error(`${nodeName} is not a Code node`);
  return node.parameters.jsCode;
}

/**
 * @param nodes  { "Node Name": [{...json}] } for every node that DID execute.
 * @param input  items on this node's own input.
 */
export function runCode(source, { nodes = {}, input = [] } = {}) {
  const wrap = (items) => items.map((json) => ({ json }));
  const $ = (name) => {
    if (!(name in nodes)) {
      throw new Error(`Referenced node is unexecuted: no data found for node '${name}'`);
    }
    const items = wrap(nodes[name]);
    return { first: () => items[0], all: () => items, last: () => items[items.length - 1] };
  };
  const $input = { first: () => wrap(input)[0], all: () => wrap(input), last: () => wrap(input).slice(-1)[0] };
  const $json = input[0] ?? {};
  const fn = new Function("$", "$input", "$json", `${source}`);
  const out = fn($, $input, $json);
  return (Array.isArray(out) ? out : [out]).map((item) => item.json ?? item);
}

export function makeChecker(label) {
  const failures = [];
  let count = 0;
  const check = (name, condition, detail = "") => {
    count += 1;
    if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  };
  const done = () => {
    if (failures.length) {
      console.error(`FAIL ${label}: ${failures.length} of ${count} checks failed`);
      for (const failure of failures) console.error(`  - ${failure}`);
      process.exit(1);
    }
    console.log(`ok   ${label}: ${count} checks passed`);
  };
  return { check, done };
}
