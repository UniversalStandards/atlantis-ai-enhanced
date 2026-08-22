import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "sec20-audit.json";
let report;
try {
  report = JSON.parse(readFileSync(path, "utf8"));
} catch (error) {
  console.error(`SEC-20 audit gate failed: could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const counts = report?.metadata?.vulnerabilities;
if (counts === null || typeof counts !== "object") {
  console.error("SEC-20 audit gate failed: vulnerability metadata is missing");
  process.exit(1);
}

const levels = ["info", "low", "moderate", "high", "critical"];
for (const level of levels) {
  if (!Number.isSafeInteger(counts[level]) || counts[level] < 0) {
    console.error(`SEC-20 audit gate failed: invalid ${level} vulnerability count`);
    process.exit(1);
  }
}

const vulnerabilities = report?.vulnerabilities;
if (vulnerabilities !== null && typeof vulnerabilities === "object") {
  for (const [name, finding] of Object.entries(vulnerabilities)) {
    if (finding === null || typeof finding !== "object") continue;
    const severity = typeof finding.severity === "string" ? finding.severity : "unknown";
    const fix = finding.fixAvailable === true
      ? "fix available"
      : finding.fixAvailable && typeof finding.fixAvailable === "object"
        ? `fix available via ${finding.fixAvailable.name ?? "dependency"}@${finding.fixAvailable.version ?? "unspecified"}`
        : "no automatic fix reported";
    console.log(`SEC-20 finding: ${name} severity=${severity}; ${fix}`);

    if (Array.isArray(finding.via)) {
      for (const via of finding.via) {
        if (via && typeof via === "object") {
          const title = typeof via.title === "string" ? via.title : "advisory";
          const url = typeof via.url === "string" ? via.url : "no-url";
          const viaSeverity = typeof via.severity === "string" ? via.severity : severity;
          console.log(`  via: severity=${viaSeverity}; ${title}; ${url}`);
        }
      }
    }
  }
}

console.log(
  `SEC-20 audit summary: critical=${counts.critical}, high=${counts.high}, moderate=${counts.moderate}, low=${counts.low}, info=${counts.info}.`,
);

if (counts.critical > 0) {
  console.error("SEC-20 audit gate failed: unresolved critical vulnerabilities are present");
  process.exit(1);
}
