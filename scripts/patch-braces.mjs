import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// GHSA-vfj7-8cjw-p6xm has no upstream release yet. Bound recursive AST
// walkers before they run, including consumers that import the lib directly.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const guardName = "mult-portas-depth-guard.js";
const guard = `'use strict';
// Local mitigation for GHSA-vfj7-8cjw-p6xm. Installed and verified by the project.
module.exports = function assertSafeDepth(input) {
  const fail = () => { throw new RangeError('Brace pattern exceeds the safe nesting limit'); };
  if (typeof input === 'string') {
    if (input.length > 65536) fail();
    let depth = 0;
    for (let index = 0; index < input.length; index++) {
      const character = input[index];
      if (character === '\\\\') { index++; continue; }
      if (character === '{' || character === '(' || character === '[') {
        if (++depth > 64) fail();
      } else if (character === '}' || character === ')' || character === ']') {
        depth = Math.max(0, depth - 1);
      }
    }
    return;
  }
  const queue = [{ node: input, depth: 0 }];
  const seen = new WeakSet();
  let count = 0;
  while (queue.length) {
    const { node, depth } = queue.pop();
    if (!node || typeof node !== 'object') continue;
    if (depth > 64 || ++count > 100000 || seen.has(node)) fail();
    seen.add(node);
    const children = Array.isArray(node) ? node : node.nodes;
    if (Array.isArray(children)) {
      for (const child of children) queue.push({ node: child, depth: depth + 1 });
    }
  }
};
`;

const files = [
  ["parse", "e572166565f15fa6ad9865ae49d678218e32aabfd1b3720f6d0d43d39800d310", "const parse = (input, options = {}) => {", "input"],
  ["compile", "dc98f22eee3d511785d92a00758d5f0d48efed5f5813bdecc2de430c529b5c9f", "const compile = (ast, options = {}) => {", "ast"],
  ["expand", "41ccc196ebfa7b7781a634e721eb744e4e7bcb54cba427a7e3d6806a1b9e58f7", "const expand = (ast, options = {}) => {", "ast"],
  ["stringify", "379f22d77bfa1478341ccd49c5e4267464aabcbba03558bab332aac23fc6f23a", "module.exports = (ast, options = {}) => {", "ast"],
];
const digest = (content) => createHash("sha256").update(content).digest("hex");
const patched = (source, entry, input) => source.replace("'use strict';\n", "'use strict';\nconst assertSafeDepth = require('../mult-portas-depth-guard');\n")
  .replace(entry, `${entry}\n  assertSafeDepth(${input});`);
const original = (source, entry, input) => source.replace("const assertSafeDepth = require('../mult-portas-depth-guard');\n", "")
  .replace(`${entry}\n  assertSafeDepth(${input});`, entry);

export async function bracesPackagePaths() {
  const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
  const paths = Object.keys(lock.packages).filter((path) => path === "node_modules/braces" || path.endsWith("/node_modules/braces"));
  if (!paths.length) throw new Error("The braces dependency could not be verified.");
  return paths;
}

export async function verifyBracesProtection() {
  const paths = await bracesPackagePaths();
  for (const path of paths) {
    const base = join(root, path);
    const info = JSON.parse(await readFile(join(base, "package.json"), "utf8"));
    if (info.version !== "3.0.3" || await readFile(join(base, guardName), "utf8") !== guard) throw new Error("The braces depth guard is missing or modified.");
    for (const [name, hash, entry, input] of files) {
      const source = await readFile(join(base, "lib", `${name}.js`), "utf8");
      const upstream = original(source, entry, input);
      if (digest(upstream) !== hash || source !== patched(upstream, entry, input)) throw new Error(`Unverified braces protection: ${name}`);
    }
  }
  return paths;
}

async function installProtection() {
  for (const path of await bracesPackagePaths()) {
    const base = join(root, path);
    const info = JSON.parse(await readFile(join(base, "package.json"), "utf8"));
    if (info.version !== "3.0.3") throw new Error("Review the braces mitigation before changing its version.");
    for (const [name, hash, entry, input] of files) {
      const file = join(base, "lib", `${name}.js`);
      const source = await readFile(file, "utf8");
      const upstream = original(source, entry, input);
      if (digest(upstream) !== hash || !upstream.includes(entry)) throw new Error(`Unexpected upstream braces file: ${name}`);
      await writeFile(file, patched(upstream, entry, input));
    }
    await writeFile(join(base, guardName), guard);
  }
  await verifyBracesProtection();
  console.log("braces: recursive depth protection installed and verified.");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await installProtection();
