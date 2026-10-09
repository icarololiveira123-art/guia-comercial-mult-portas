import { spawnSync } from "node:child_process";
import { verifyBracesProtection } from "./patch-braces.mjs";

export const GUARDED_ADVISORY = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";

export function actionableFindings(report) {
  const vulnerabilities = report.vulnerabilities ?? {};
  function advisories(name, visited = new Set()) {
    if (visited.has(name)) return [];
    const finding = vulnerabilities[name];
    if (!finding || !Array.isArray(finding.via)) throw new Error("Unrecognized dependency audit response.");
    const seen = new Set(visited).add(name);
    return finding.via.flatMap((via) => typeof via === "string" ? advisories(via, seen) : [via]);
  }
  return Object.keys(vulnerabilities).filter((name) => {
    const finding = vulnerabilities[name];
    if (!["high", "critical"].includes(finding.severity)) return false;
    const causes = advisories(name);
    return !causes.length || causes.some((cause) => cause.name !== "braces" || cause.url !== GUARDED_ADVISORY || cause.severity !== "high");
  });
}

async function runAudit() {
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 8_000_000 });
  if (result.error || result.signal || ![0, 1].includes(result.status)) throw result.error ?? new Error("Dependency audit could not complete.");
  const report = JSON.parse(result.stdout);
  if (report.error || !report.metadata || !report.vulnerabilities) throw new Error("Dependency audit unavailable; publication stopped.");
  const blocked = actionableFindings(report);
  if (blocked.length) throw new Error(`Dependency audit blocked: ${blocked.join(", ")}`);
  if (report.vulnerabilities.braces) {
    const protectedPaths = await verifyBracesProtection();
    for (const path of report.vulnerabilities.braces.nodes ?? []) {
      if (!protectedPaths.includes(path)) throw new Error("An affected braces installation lacks the depth guard.");
    }
    console.log(`${GUARDED_ADVISORY}: original alert retained; every affected installation has a verified depth guard. No upstream fixed release is available.`);
  }
  console.log("Dependency audit passed: no unmitigated high or critical findings.");
}

if (process.argv[1]?.endsWith("audit-dependencies.mjs")) await runAudit();
