#!/usr/bin/env node

const repository = process.env.ATLANTIS_REPOSITORY ?? process.env.GITHUB_REPOSITORY ?? "UniversalStandards/atlantis-ai-enhanced";
const branch = process.env.ATLANTIS_MAIN_BRANCH ?? "main";
const pullRequest = Number(process.env.ATLANTIS_RELEASE_PR ?? "10");
const requiredCheck = process.env.ATLANTIS_REQUIRED_CHECK ?? "validate";
const requiredAppId = Number(process.env.ATLANTIS_REQUIRED_APP_ID ?? "15368");
const enforce = process.argv.includes("--enforce");
const selfTest = process.argv.includes("--self-test");
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

function configuredClassicCheck(requiredStatusChecks) {
  const checks = requiredStatusChecks?.checks ?? [];
  return checks.some((check) =>
    typeof check === "object" &&
    check?.context === requiredCheck &&
    Number(check?.app_id) === requiredAppId
  );
}

function exactRulesetAppliesToBranch(ruleset, branchName) {
  if (ruleset?.target !== "branch" || ruleset?.enforcement !== "active") return false;
  const refName = ruleset?.conditions?.ref_name;
  if (!refName) return false;
  const ref = `refs/heads/${branchName}`;
  const include = Array.isArray(refName.include) ? refName.include : [];
  const exclude = Array.isArray(refName.exclude) ? refName.exclude : [];

  // Fail closed on pattern semantics we have not explicitly proven. Exact refs and
  // GitHub's ~ALL sentinel are sufficient for the Day-7 main-branch invariant.
  if (exclude.includes("~ALL") || exclude.includes(ref)) return false;
  return include.includes("~ALL") || include.includes(ref);
}

function evaluateRuleset(ruleset, branchName) {
  const applies = exactRulesetAppliesToBranch(ruleset, branchName);
  const rules = Array.isArray(ruleset?.rules) ? ruleset.rules : [];
  const prRule = rules.find((rule) => rule?.type === "pull_request");
  const statusRule = rules.find((rule) => rule?.type === "required_status_checks");
  const requiredChecks = statusRule?.parameters?.required_status_checks ?? [];
  const requiredCheckConfigured = requiredChecks.some((check) =>
    check?.context === requiredCheck && Number(check?.integration_id) === requiredAppId
  );
  const approvingReviewsRequired = Number(prRule?.parameters?.required_approving_review_count ?? 0) >= 1;

  return {
    id: ruleset?.id ?? null,
    name: ruleset?.name ?? null,
    enforcement: ruleset?.enforcement ?? null,
    target: ruleset?.target ?? null,
    applies_to_branch: applies,
    pull_request_reviews_required: applies && approvingReviewsRequired,
    required_check_configured: applies && requiredCheckConfigured,
    release_control_enforced: applies && approvingReviewsRequired && requiredCheckConfigured,
  };
}

function runSelfTest() {
  const fixture = {
    id: 1,
    name: "main-release-control",
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
    rules: [
      { type: "pull_request", parameters: { required_approving_review_count: 1 } },
      { type: "required_status_checks", parameters: { required_status_checks: [{ context: requiredCheck, integration_id: requiredAppId }] } },
    ],
  };
  const positive = evaluateRuleset(fixture, "main");
  const inactive = evaluateRuleset({ ...fixture, enforcement: "disabled" }, "main");
  const wrongApp = evaluateRuleset({
    ...fixture,
    rules: fixture.rules.map((rule) => rule.type === "required_status_checks"
      ? { ...rule, parameters: { required_status_checks: [{ context: requiredCheck, integration_id: requiredAppId + 1 }] } }
      : rule),
  }, "main");
  const excluded = evaluateRuleset({ ...fixture, conditions: { ref_name: { include: ["~ALL"], exclude: ["refs/heads/main"] } } }, "main");
  const insufficientReview = evaluateRuleset({
    ...fixture,
    rules: fixture.rules.map((rule) => rule.type === "pull_request"
      ? { ...rule, parameters: { required_approving_review_count: 0 } }
      : rule),
  }, "main");

  const assertions = [
    [positive.release_control_enforced === true, "positive fixture must enforce release control"],
    [inactive.release_control_enforced === false, "disabled ruleset must not enforce"],
    [wrongApp.release_control_enforced === false, "wrong integration id must not satisfy required check"],
    [excluded.release_control_enforced === false, "excluded branch must not satisfy ruleset"],
    [insufficientReview.release_control_enforced === false, "zero approving reviews must not satisfy ruleset"],
  ];
  for (const [ok, message] of assertions) {
    if (!ok) throw new Error(`release-control self-test failed: ${message}`);
  }
  console.log(JSON.stringify({ self_test: "passed", assertions: assertions.length }, null, 2));
}

if (selfTest) {
  runSelfTest();
  process.exit(0);
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

const rulesetListResult = await github(`/rulesets?includes_parents=true`, { allow: [403, 404] });
const rulesetSummaries = Array.isArray(rulesetListResult.body) ? rulesetListResult.body : [];
const rulesetDetails = [];
for (const summary of rulesetSummaries) {
  if (summary?.target !== "branch" || summary?.enforcement !== "active" || !Number.isInteger(summary?.id)) continue;
  const detail = await github(`/rulesets/${summary.id}?includes_parents=true`, { allow: [403, 404] });
  if (detail.status === 200 && detail.body) rulesetDetails.push(detail.body);
}
const evaluatedRulesets = rulesetDetails.map((ruleset) => evaluateRuleset(ruleset, branch));
const enforcingRulesets = evaluatedRulesets.filter((ruleset) => ruleset.release_control_enforced);

const classicEvidence = {
  branch_protected: branchResult.body?.protected === true,
  pull_request_reviews_required: Boolean(detailedProtection?.required_pull_request_reviews),
  required_check_configured: configuredClassicCheck(detailedProtection?.required_status_checks ?? summaryChecks),
};
classicEvidence.release_control_enforced = Boolean(
  classicEvidence.branch_protected &&
  classicEvidence.required_check_configured &&
  classicEvidence.pull_request_reviews_required
);

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
  branch_protected: classicEvidence.branch_protected,
  summary_required_status_checks: summaryChecks ?? null,
  detailed_protection_read: protectionResult.status === 200 ? "available" : `unavailable:${protectionResult.status}`,
  rulesets_read: rulesetListResult.status === 200 ? "available" : `unavailable:${rulesetListResult.status}`,
  classic_branch_protection: classicEvidence,
  evaluated_rulesets: evaluatedRulesets,
  enforcing_ruleset_ids: enforcingRulesets.map((ruleset) => ruleset.id),
};

evidence.check_identity_stable = matchingChecks.length === 1;
evidence.current_required_check_successful = matchingChecks.length === 1 && matchingChecks[0].status === "completed" && matchingChecks[0].conclusion === "success";
evidence.release_control_mechanism = classicEvidence.release_control_enforced
  ? "classic_branch_protection"
  : enforcingRulesets.length > 0
    ? "ruleset"
    : null;
evidence.release_control_enforced = Boolean(
  classicEvidence.release_control_enforced || enforcingRulesets.length > 0
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
