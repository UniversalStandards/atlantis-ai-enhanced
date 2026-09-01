#!/usr/bin/env node

const repository = process.env.ATLANTIS_REPOSITORY ?? process.env.GITHUB_REPOSITORY ?? "UniversalStandards/atlantis-ai-enhanced";
const branch = process.env.ATLANTIS_MAIN_BRANCH ?? "main";
const pullRequest = Number(process.env.ATLANTIS_RELEASE_PR ?? "10");
const requiredCheck = process.env.ATLANTIS_REQUIRED_CHECK ?? "validate";
const requiredAppId = Number(process.env.ATLANTIS_REQUIRED_APP_ID ?? "15368");
const enforce = process.argv.includes("--enforce");
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

if (!/^[^/]+\/[^/]+$/.test(repository)) {
  throw new Error(`Invalid ATLANTIS_REPOSITORY: ${repository}`);
}
if (!Number.isInteger(pullRequest) || pullRequest <= 0) {
  throw new Error(`Invalid ATLANTIS_RELEASE_PR: ${pullRequest}`);
}
if (!Number.isInteger(requiredAppId) || requiredAppId <= 0) {
  throw new Error(`Invalid ATLANTIS_REQUIRED_APP_ID: ${requiredAppId}`);
}

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "atlantis-release-control-evidence",
};
if (token) headers.Authorization = `Bearer ${token}`;

async function github(path, { allow = [] } = {}) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, { headers });
  if (allow.includes(response.status)) {
    return { status: response.status, body: null };
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} for ${path}: ${body.slice(0, 300)}`);
  }
  return { status: response.status, body: await response.json() };
}

function configuredCheck(requiredStatusChecks) {
  const contexts = requiredStatusChecks?.contexts ?? [];
  const checks = requiredStatusChecks?.checks ?? [];
  return contexts.includes(requiredCheck) || checks.some((check) => {
    const context = typeof check === "string" ? check : check?.context;
    const appId = typeof check === "object" ? check?.app_id : undefined;
    return context === requiredCheck && (appId == null || Number(appId) === requiredAppId);
  });
}

const branchResult = await github(`/branches/${encodeURIComponent(branch)}`);
const prResult = await github(`/pulls/${pullRequest}`);
const headSha = prResult.body?.head?.sha;
if (!headSha) throw new Error(`PR #${pullRequest} did not expose a head SHA`);

const checkRunsResult = await github(`/commits/${headSha}/check-runs?per_page=100`);
const matchingChecks = (checkRunsResult.body?.check_runs ?? []).filter((run) =>
  run?.name === requiredCheck && Number(run?.app?.id) === requiredAppId
);

const protectionResult = await github(`/branches/${encodeURIComponent(branch)}/protection`, { allow: [403, 404] });
const summaryChecks = branchResult.body?.protection?.required_status_checks;
const detailedProtection = protectionResult.body;

const evidence = {
  generated_at: new Date().toISOString(),
  repository,
  branch,
  pull_request: pullRequest,
  pull_request_head: headSha,
  expected_check: { name: requiredCheck, app_id: requiredAppId },
  observed_matching_checks: matchingChecks.map((run) => ({
    id: run.id,
    name: run.name,
    app_id: run.app?.id,
    status: run.status,
    conclusion: run.conclusion,
    details_url: run.details_url,
  })),
  branch_protected: branchResult.body?.protected === true,
  summary_required_status_checks: summaryChecks ?? null,
  detailed_protection_read: protectionResult.status === 200 ? "available" : `unavailable:${protectionResult.status}`,
  pull_request_reviews_required: Boolean(detailedProtection?.required_pull_request_reviews),
  required_check_configured: configuredCheck(detailedProtection?.required_status_checks ?? summaryChecks),
};

evidence.check_identity_stable = matchingChecks.length === 1;
evidence.current_required_check_successful = matchingChecks.length === 1 && matchingChecks[0].status === "completed" && matchingChecks[0].conclusion === "success";
evidence.release_control_enforced = Boolean(
  evidence.branch_protected &&
  evidence.required_check_configured &&
  evidence.pull_request_reviews_required
);

console.log(JSON.stringify(evidence, null, 2));

if (!evidence.check_identity_stable) {
  console.error(`Expected exactly one ${requiredCheck} check from app ${requiredAppId}; observed ${matchingChecks.length}.`);
  process.exitCode = 2;
}

if (enforce && !evidence.release_control_enforced) {
  console.error("ATLANTIS release-control invariant is not yet enforced on the target branch.");
  process.exitCode = 3;
}
