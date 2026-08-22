import { readFileSync } from "node:fs";

const lockfilePath = "pnpm-lock.yaml";
const lockfile = readFileSync(lockfilePath, "utf8");

function fail(message) {
  console.error(`SEC-20 supply-chain gate failed: ${message}`);
  process.exitCode = 1;
}

if (!/^lockfileVersion:\s*['"]?9\.0['"]?\s*$/m.test(lockfile)) {
  fail("pnpm lockfile version 9.0 is required");
}

const disallowedSpecifier = /^\s*specifier:\s*(?:https?:|git(?:\+|:)|github:|file:)/im;
if (disallowedSpecifier.test(lockfile)) {
  fail("direct HTTP, Git, GitHub shorthand, or file dependency specifiers are not allowed");
}

const packagesMarker = "\npackages:\n";
const packagesStart = lockfile.indexOf(packagesMarker);
if (packagesStart < 0) {
  fail("packages section is missing");
} else {
  const snapshotsMarker = "\nsnapshots:\n";
  const snapshotsStart = lockfile.indexOf(snapshotsMarker, packagesStart + packagesMarker.length);
  const packagesSection = lockfile.slice(
    packagesStart + packagesMarker.length,
    snapshotsStart < 0 ? lockfile.length : snapshotsStart,
  );

  const lines = packagesSection.split("\n");
  let packageKey;
  let hasIntegrity = false;
  let packageCount = 0;
  let integrityCount = 0;

  const settle = () => {
    if (packageKey === undefined) return;
    if (!hasIntegrity) {
      fail(`package ${packageKey} does not declare registry integrity metadata`);
    }
  };

  for (const line of lines) {
    const header = /^  (.+):$/.exec(line);
    if (header) {
      settle();
      packageKey = header[1];
      packageCount += 1;
      hasIntegrity = false;
      continue;
    }

    if (
      packageKey !== undefined &&
      /^    resolution:\s*\{[^}]*integrity:\s*sha(?:256|384|512)-[^}]+\}\s*$/.test(line)
    ) {
      hasIntegrity = true;
      integrityCount += 1;
    }
  }
  settle();

  if (packageCount === 0) {
    fail("no external package records were found");
  }

  if (process.exitCode !== 1) {
    console.log(
      `SEC-20 lockfile integrity gate passed: ${packageCount} external package records, ${integrityCount} integrity records, no direct unpinned HTTP/Git/file specifiers.`,
    );
  }
}

if (process.exitCode === 1) {
  process.exit(1);
}
