import { randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "@atlantis/events";
/** Version of the {@link ProvenanceRecord} shape. Bump on any breaking change. */
export const PROVENANCE_SCHEMA_VERSION = "1.0.0";
/**
 * Minimum number of distinct model families that must answer at each depth.
 * Diversity is counted in families, never in instances: three instances of one
 * family share training data and failure modes, and count as one.
 */
export const MIN_FAMILIES = Object.freeze({
    0: 1,
    1: 2,
    2: 3,
    3: 4,
    4: 5,
});
export class PanelConfigurationError extends Error {
    constructor(message) {
        super(message);
        this.name = "PanelConfigurationError";
    }
}
export function defaultCanonicalize(answer) {
    return answer.normalize("NFC").trim().replace(/\s+/g, " ");
}
/** Distinct families, compared case-insensitively. */
function familiesOf(panelists) {
    return [
        ...new Set(panelists.map((p) => p.family.trim().toLowerCase())),
    ].sort();
}
/**
 * Mode C (verification): ask every panelist the same question blind, then
 * compare.
 *
 * There is no vote. Agreement must be unanimous among responders to release an
 * answer; any disagreement is reported as the finding, with every position
 * preserved. Answers are never averaged and no position is suppressed for
 * being in the minority.
 *
 * Rejects with {@link PanelConfigurationError} when the configured panel cannot
 * satisfy the depth's family requirement even if everyone answers. Panelist
 * failures at run time do not reject; they reduce the responding families and
 * can produce `"insufficient_panel"`.
 */
export async function verify(options) {
    const { panel, depth, prompt } = options;
    const required = MIN_FAMILIES[depth];
    const ids = new Set(panel.map((p) => p.id));
    if (ids.size !== panel.length) {
        throw new PanelConfigurationError("Panelist ids must be unique");
    }
    if (panel.some((p) => p.family.trim().length === 0)) {
        throw new PanelConfigurationError("Every panelist must declare a family");
    }
    const configured = familiesOf(panel).length;
    if (configured < required) {
        throw new PanelConfigurationError(`Depth D${depth} requires ${required} distinct model families; the panel has ${configured}`);
    }
    const now = options.now ?? (() => new Date());
    const canonicalize = options.canonicalize ?? defaultCanonicalize;
    const deliberationId = options.deliberationId ?? randomUUID();
    const legallyBinding = options.legallyBinding ?? false;
    const startedAt = now().toISOString();
    const controller = new AbortController();
    const onAbort = () => {
        controller.abort();
    };
    if (options.signal?.aborted)
        controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    // Round 0: every panelist receives an identical request and runs
    // concurrently. No panelist's output is available to any other.
    const request = Object.freeze({
        deliberationId,
        round: 0,
        prompt,
    });
    let settled;
    try {
        settled = await Promise.allSettled(panel.map(async (panelist) => panelist.respond(request, controller.signal)));
    }
    finally {
        options.signal?.removeEventListener("abort", onAbort);
        controller.abort();
    }
    const records = [];
    const groups = new Map();
    for (const [index, outcome] of settled.entries()) {
        const panelist = panel[index];
        const base = {
            panelistId: panelist.id,
            family: panelist.family,
            model: panelist.model,
        };
        const answer = outcome.status === "fulfilled"
            ? outcome.value.answer
            : undefined;
        if (typeof answer !== "string" || answer.trim().length === 0) {
            const failure = outcome.status === "rejected"
                ? outcome.reason instanceof Error
                    ? outcome.reason.name
                    : "NonError"
                : "EmptyAnswer";
            records.push({ ...base, responded: false, failure });
            continue;
        }
        records.push({ ...base, responded: true, answerHash: sha256Hex(answer) });
        const key = sha256Hex(canonicalize(answer));
        const group = groups.get(key);
        if (group)
            group.members.push(panelist);
        else
            groups.set(key, { answer, members: [panelist] });
    }
    const details = [...groups.entries()]
        .map(([canonicalHash, group]) => ({
        canonicalHash,
        answer: group.answer,
        panelistIds: group.members.map((m) => m.id).sort(),
        families: familiesOf(group.members),
    }))
        // Stable, content-derived order. Deliberately not ordered by support.
        .sort((a, b) => a.canonicalHash.localeCompare(b.canonicalHash));
    const responders = panel.filter((_, i) => records[i]?.responded === true);
    const respondingFamilies = familiesOf(responders).length;
    let status;
    let emission;
    if (respondingFamilies < required) {
        status = "insufficient_panel";
        emission = "blocked";
    }
    else if (details.length === 1) {
        status = "concordant";
        emission = "full";
    }
    else {
        status = "divergent";
        emission = legallyBinding ? "blocked" : "partial";
    }
    const unhashed = {
        schemaVersion: PROVENANCE_SCHEMA_VERSION,
        deliberationId,
        mode: "C",
        depth,
        promptHash: sha256Hex(prompt),
        startedAt,
        completedAt: now().toISOString(),
        requiredFamilies: required,
        respondingFamilies,
        panel: records,
        positions: details.map(({ canonicalHash, panelistIds, families }) => ({
            canonicalHash,
            panelistIds,
            families,
        })),
        status,
        emission,
        legallyBinding,
    };
    const provenance = Object.freeze({
        ...unhashed,
        recordHash: sha256Hex(canonicalJson(unhashed)),
    });
    return {
        status,
        emission,
        ...(emission === "full"
            ? { answer: details[0].answer }
            : {}),
        ...(emission === "partial"
            ? {
                discrepancyHeader: `UNRESOLVED DISCREPANCY: ${details.length} distinct answers from ${respondingFamilies} model families. No answer has been selected. Deliberation ${deliberationId}.`,
            }
            : {}),
        positions: emission === "blocked" ? [] : details,
        provenance,
    };
}
/** Recomputes a provenance record's hash. False if any field was altered. */
export function verifyProvenance(record) {
    const { recordHash, ...rest } = record;
    try {
        return sha256Hex(canonicalJson(rest)) === recordHash;
    }
    catch {
        return false;
    }
}
/** Runs Mode C over a known-answer set and scores the panel against baselines. */
export async function scoreKnownAnswers(cases, options) {
    if (cases.length === 0) {
        throw new PanelConfigurationError("A known-answer set needs at least one case");
    }
    const canonicalize = options.canonicalize ?? defaultCanonicalize;
    const correct = new Map(options.panel.map((p) => [p.id, 0]));
    let concordant = 0;
    let concordantCorrect = 0;
    let divergent = 0;
    let insufficient = 0;
    let pluralityCorrect = 0;
    for (const testCase of cases) {
        const expectedHash = sha256Hex(canonicalize(testCase.expected));
        const result = await verify({
            ...options,
            legallyBinding: false,
            prompt: testCase.prompt,
        });
        const positions = result.provenance.positions;
        for (const position of positions) {
            if (position.canonicalHash !== expectedHash)
                continue;
            for (const id of position.panelistIds)
                correct.set(id, (correct.get(id) ?? 0) + 1);
        }
        const ranked = [...positions].sort((a, b) => b.panelistIds.length - a.panelistIds.length);
        const [top, second] = ranked;
        if (top?.canonicalHash === expectedHash &&
            top.panelistIds.length > (second?.panelistIds.length ?? 0)) {
            pluralityCorrect += 1;
        }
        if (result.status === "insufficient_panel")
            insufficient += 1;
        else if (result.status === "divergent")
            divergent += 1;
        else {
            concordant += 1;
            if (top?.canonicalHash === expectedHash)
                concordantCorrect += 1;
        }
    }
    const panelistAccuracy = Object.fromEntries([...correct].map(([id, n]) => [id, n / cases.length]));
    const best = [...correct].reduce((a, b) => (b[1] > a[1] ? b : a));
    const bestSinglePanelist = { id: best[0], accuracy: best[1] / cases.length };
    const precisionWhenConcordant = concordant === 0 ? 0 : concordantCorrect / concordant;
    return {
        cases: cases.length,
        panelistAccuracy,
        bestSinglePanelist,
        concordant,
        concordantCorrect,
        concordantWrong: concordant - concordantCorrect,
        divergent,
        insufficient,
        precisionWhenConcordant,
        pluralityBaselineAccuracy: pluralityCorrect / cases.length,
        panelBeatsBestSingle: concordant > 0 && precisionWhenConcordant > bestSinglePanelist.accuracy,
    };
}
/**
 * Deterministic panelist for tests, replay fixtures, and validation corpora.
 * It calls no model.
 */
export function createScriptedPanelist(options) {
    const { answers } = options;
    return {
        id: options.id,
        family: options.family,
        model: options.model ?? "scripted",
        respond: (request) => {
            const answer = typeof answers === "function"
                ? answers(request.prompt)
                : answers[request.prompt];
            return answer === undefined
                ? Promise.reject(new Error(`No scripted answer for panelist ${options.id}`))
                : Promise.resolve({ answer });
        },
    };
}
export class PanelistRequestError extends Error {
    panelistId;
    status;
    constructor(panelistId, status, detail) {
        super(`Panelist ${panelistId} request failed: ${detail}`);
        this.panelistId = panelistId;
        this.status = status;
        this.name = "PanelistRequestError";
    }
}
/**
 * Panelist for any endpoint that speaks the OpenAI chat-completions wire
 * format: hosted providers, gateways, and self-hosted servers alike. This is
 * the bring-your-own-key path: one adapter, any number of providers.
 *
 * `family` is declared by the caller because a base URL does not reveal model
 * lineage. Declare it truthfully: two endpoints serving the same model family
 * count as one family.
 */
export function createOpenAICompatiblePanelist(options) {
    const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const send = options.fetch ?? fetch;
    return {
        id: options.id,
        family: options.family,
        model: options.model,
        respond: async (request, signal) => {
            let response;
            try {
                response = await send(endpoint, {
                    method: "POST",
                    signal,
                    headers: {
                        "content-type": "application/json",
                        authorization: `Bearer ${options.apiKey}`,
                    },
                    body: JSON.stringify({
                        model: options.model,
                        messages: [
                            ...(options.system
                                ? [{ role: "system", content: options.system }]
                                : []),
                            { role: "user", content: request.prompt },
                        ],
                    }),
                });
            }
            catch (error) {
                // Error messages from fetch can echo the URL but never the headers.
                throw new PanelistRequestError(options.id, undefined, error instanceof Error ? error.name : "network error");
            }
            if (!response.ok) {
                // The body is not included: providers sometimes echo request detail.
                throw new PanelistRequestError(options.id, response.status, `HTTP ${response.status}`);
            }
            let body;
            try {
                body = await response.json();
            }
            catch {
                throw new PanelistRequestError(options.id, response.status, "response was not JSON");
            }
            const parsed = body;
            const content = parsed.choices?.[0]?.message?.content;
            if (typeof content !== "string") {
                throw new PanelistRequestError(options.id, response.status, "response had no text content");
            }
            const tokens = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0
                ? value
                : undefined;
            const inputTokens = tokens(parsed.usage?.prompt_tokens);
            const outputTokens = tokens(parsed.usage?.completion_tokens);
            return {
                answer: content,
                ...(inputTokens === undefined ? {} : { inputTokens }),
                ...(outputTokens === undefined ? {} : { outputTokens }),
            };
        },
    };
}
//# sourceMappingURL=index.js.map