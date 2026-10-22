import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JSON_SCHEMA, load } from "js-yaml";

// Resolved from official actions/* Git refs on 2026-10-19. Keep updates explicit:
// an arbitrary 40-character string is not an approved action implementation.
const approvedActions = new Map([
  ["actions/checkout", new Set(["3d3c42e5aac5ba805825da76410c181273ba90b1", "11d5960a326750d5838078e36cf38b85af677262"])],
  ["actions/setup-node", new Set(["949feb2413d6458794dcd2491c4babbbce0c15c1", "49933ea5288caeca8642d1e84afbd3f7d6820020"])],
  ["actions/upload-pages-artifact", new Set(["fc324d3547104276b827a68afc52ff2a11cc49c9"])],
  ["actions/deploy-pages", new Set(["368f82528645a54fb793d4d04e342629a3f51346"])],
  ["actions/upload-artifact", new Set(["ea165f8d65b6e75b540449e92b4886f43607fa02"])],
  ["actions/download-artifact", new Set(["d3f86a106a0bac45b974a628896c90dbdf5c8093"])],
]);

const desktops = [
  {
    workflow: "marketing-desktop.yml", directory: "desktop-marketing",
    artifact: "Marketing-Diario-Windows-1.0.1",
    executable: "Marketing-Diario-Mult-Portas-1.0.1-Windows.exe",
    releaseTag: "marketing-desktop-v1.0.1", buildCommand: "build:windows",
  },
  {
    workflow: "recorta-planta-desktop.yml", directory: "desktop-recorta-planta",
    artifact: "Recorta-Planta-Windows-1.0.1", executable: "Recorta-Planta-Windows.exe",
    releaseTag: "recorta-planta-v1.0.1", buildCommand: "dist:win",
  },
];

async function workflowFile(name) {
  const source = await readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");
  return { source, workflow: load(source, { schema: JSON_SCHEMA }) };
}

for (const name of ["pages.yml", ...desktops.map((desktop) => desktop.workflow)]) {
  test(`${name}: trusted immutable actions and credentials without persistence`, async () => {
    const { workflow } = await workflowFile(name);
    assert.deepEqual(workflow.permissions, { contents: "read" });
    assert.deepEqual(Object.keys(workflow.on).sort(), ["push", "workflow_dispatch"]);
    assert.ok(workflow.on.push.branches.includes("main"));
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      for (const step of job.steps) {
        if (!step.uses) continue;
        const action = /^([a-z-]+\/[a-z-]+)@([0-9a-f]{40})$/.exec(step.uses);
        assert.ok(action, `${jobName}: action must use a complete commit SHA`);
        assert.ok(approvedActions.get(action[1])?.has(action[2]), `${jobName}: action SHA must be reviewed`);
        if (action[1] === "actions/checkout") assert.equal(step.with?.["persist-credentials"], false);
      }
    }
  });
}

test("Pages publishes only after all quality gates with a separate deployment role", async () => {
  const { workflow } = await workflowFile("pages.yml");
  assert.equal(workflow.jobs.build.permissions, undefined);
  assert.equal(workflow.jobs.deploy.needs, "build");
  assert.deepEqual(workflow.jobs.deploy.permissions, {
    contents: "read", pages: "write", "id-token": "write",
  });
  const scripts = workflow.jobs.build.steps.map((step) => step.run).filter(Boolean);
  for (const required of [
    "npm ci", "npm run audit:dependencies", "npm run lint", "npm run typecheck",
    "npm run build", "SITES_TEST_SKIP_BUILD=1 npm test", "npm run test:e2e", "npm run build:github",
    "node --test tests/security-workflows.test.mjs",
  ]) assert.ok(scripts.includes(required), `missing required publication gate: ${required}`);
  assert.ok(workflow.jobs.deploy.steps.every((step) => !step.run && step.uses.startsWith("actions/deploy-pages@")));
});

for (const desktop of desktops) {
  test(`${desktop.workflow}: unprivileged native build and isolated release job`, async () => {
    const { workflow } = await workflowFile(desktop.workflow);
    const build = workflow.jobs.windows;
    const release = workflow.jobs.release;
    assert.deepEqual(build.permissions, { contents: "read" });
    assert.equal(build["runs-on"], "windows-latest");
    assert.equal(release.needs, "windows");
    assert.equal(release.if, "github.ref == 'refs/heads/main'");
    assert.deepEqual(release.permissions, { contents: "write" });
    assert.equal(build.defaults.run["working-directory"], desktop.directory);
    assert.ok(workflow.on.push.paths.includes(`${desktop.directory}/**`));
    assert.ok(workflow.on.push.paths.includes(`.github/workflows/${desktop.workflow}`));

    const packageJson = JSON.parse(await readFile(new URL(`../${desktop.directory}/package.json`, import.meta.url), "utf8"));
    const smoke = await readFile(new URL(`../${desktop.directory}/tests/smoke-windows.ps1`, import.meta.url), "utf8");
    assert.equal(packageJson.version, "1.0.1");
    assert.ok(packageJson.scripts[desktop.buildCommand]);
    assert.equal(packageJson.build.win.artifactName, desktop.executable);
    assert.ok(smoke.includes(desktop.executable), "native smoke must launch the published filename");
    assert.ok(build.steps.some((step) => step.run === "npm test"));
    assert.ok(build.steps.some((step) => step.run === `npm run ${desktop.buildCommand}`));
    assert.ok(build.steps.some((step) => step.run === "./tests/smoke-windows.ps1"));
    assert.ok(build.steps.every((step) => !step.env?.GH_TOKEN));

    const upload = build.steps.find((step) => step.with?.name === desktop.artifact);
    const download = release.steps.find((step) => step.with?.name === desktop.artifact);
    assert.ok(upload.uses.startsWith("actions/upload-artifact@"));
    assert.equal(upload.with["if-no-files-found"], "error");
    assert.deepEqual(upload.with.path.trim().split("\n"), [
      `${desktop.directory}/release/${desktop.executable}`,
      `${desktop.directory}/release/SHA256.txt`,
    ]);
    assert.ok(download.uses.startsWith("actions/download-artifact@"));
    assert.equal(download.with.path, "release");

    for (const step of release.steps) {
      if (step.uses) assert.ok(step.uses.startsWith("actions/download-artifact@"));
      if (step.run) {
        assert.equal(step.shell, "bash");
        assert.doesNotMatch(step.run, /\b(?:npm|npx|node|electron|powershell|pwsh|python|curl|wget|eval|source)\b|\.\/(?:[^\s]+\.)?(?:ps1|mjs|cjs|sh)\b/i,
          "privileged release must not execute repository or downloaded scripts");
      }
    }
    const verificationIndex = release.steps.findIndex((step) => step.run?.includes("sha256sum"));
    const publishIndex = release.steps.findIndex((step) => step.run?.includes("gh release create"));
    assert.ok(verificationIndex >= 0 && publishIndex > verificationIndex);
    assert.equal(release.steps[verificationIndex].env?.GH_TOKEN, undefined);
    const publish = release.steps[publishIndex];
    assert.equal(publish.env.GH_TOKEN, "${{ github.token }}");
    assert.equal(publish.env.RELEASE_COMMIT, "${{ github.sha }}");
    assert.ok(publish.run.includes(desktop.releaseTag));
    assert.ok(publish.run.includes('--target "$RELEASE_COMMIT"'));
  });

  test(`${desktop.workflow}: published binary hash rejects tampering and unexpected filenames`, async () => {
    const { workflow } = await workflowFile(desktop.workflow);
    const verification = workflow.jobs.release.steps.find((step) => step.run?.includes("sha256sum"));
    const directory = await mkdtemp(join(tmpdir(), "mult-portas-release-security-"));
    const payload = "portable executable test fixture\n";
    const hash = createHash("sha256").update(payload).digest("hex");
    const runVerification = () => spawnSync("bash", ["-c", verification.run], {
      cwd: directory, encoding: "utf8", timeout: 5000,
    });
    try {
      await writeFile(join(directory, desktop.executable), payload);
      // Windows-generated SHA256.txt uses CRLF; the Linux publisher must accept it.
      await writeFile(join(directory, "SHA256.txt"), `${hash}  ${desktop.executable}\r\n`);
      assert.equal(runVerification().status, 0);
      await writeFile(join(directory, desktop.executable), `${payload}changed`);
      assert.notEqual(runVerification().status, 0);
      await writeFile(join(directory, desktop.executable), payload);
      await writeFile(join(directory, "SHA256.txt"), `${hash}  ../unexpected.exe\n`);
      assert.notEqual(runVerification().status, 0);
      await writeFile(join(directory, "SHA256.txt"), `not-a-sha256  ${desktop.executable}\n`);
      assert.notEqual(runVerification().status, 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
