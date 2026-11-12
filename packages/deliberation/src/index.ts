import { randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "@atlantis/events";

/** Version of the {@link ProvenanceRecord} shape. Bump on any breaking change. */
export const PROVENANCE_SCHEMA_VERSION = "1.0.0";

/** Deliberation Depth Ladder, D0 (trivial, reversible) to D4 (binding, high blast radius). */
export type Depth = 0 | 1 | 2 | 3 | 4;

/**
 * Minimum number of distinct model families that must answer at each depth.
 * Diversity is counted in families, never in instances: three instances of one
 * family share training data and failure modes, and count as one.
 */
export const MIN_FAMILIES: Readonly<Record<Depth, number>> = Object.freeze({
  0: 1,
  1: 2,
  2: 3,
  3: 4,
  4: 5,
});

export interface PanelRequest {
  readonly deliberationId: string;
  /** Round 0 is blind: the request carries no other panelist's output. */
  readonly round: 0;
  readonly prompt: string;
}

export interface PanelResponse {
  readonly answer: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/**
 * One model behind a provider-neutral boundary. Adapters translate to and from
 * provider SDK types; nothing provider-specific crosses this interface.
 */
export interface Panelist {
  /** Unique within a panel. */
  readonly id: string;
  /** Model lineage used for diversity, e.g. `"claude"`, `"gpt"`, `"llama"`. */
  readonly family: string;
  readonly model: string;
  respond(request: PanelRequest, signal: AbortSignal): Promise<PanelResponse>;
}

export interface PanelistRecord {
  readonly panelistId: string;
  readonly family: string;
  readonly model: string;
  readonly responded: boolean;
  /** SHA-256 of the raw answer; absent when the panelist did not respond. */
  readonly answerHash?: string;
  /** Error name only. Messages may carry provider detail and are not recorded. */
  readonly failure?: string;
}

/** One distinct answer and everyone who gave it. */
export interface Position {
  /** SHA-256 of the canonical form of the answer. */
  readonly canonicalHash: string;
  readonly panelistIds: readonly string[];
  readonly families: readonly string[];
}

export type VerificationStatus =
  /** Every responding panelist gave the same canonical answer. */
  | "concordant"
  /** Panelists disagree. The disagreement is the finding. */
  | "divergent"
  /** Too few distinct families answered for the requested depth. */
  | "insufficient_panel";

export type Emission =
  /** Concordant: the agreed answer is released. */
  | "full"
  /** Divergent, non-binding: every position is released under a discrepancy header. */
  | "partial"
  /** Nothing is released: divergent on a binding instrument, or insufficient panel. */
  | "blocked";

/**
 * Emitted alongside every deliberation output. Carries hashes, never content,
 * so it can be logged and retained without retaining prompts or answers.
 */
export interface ProvenanceRecord {
  readonly schemaVersion: typeof PROVENANCE_SCHEMA_VERSION;
  readonly deliberationId: string;
  readonly mode: "C";
  readonly depth: Depth;
  readonly promptHash: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly requiredFamilies: number;
  readonly respondingFamilies: number;
  readonly panel: readonly PanelistRecord[];
  /** Every distinct position, including dissenting ones. Never collapsed. */
  readonly positions: readonly Position[];
  readonly status: VerificationStatus;
  readonly emission: Emission;
  readonly legallyBinding: boolean;
  /** SHA-256 over the canonical JSON of every field above. */
  readonly recordHash: string;
}

export interface PositionDetail extends Position {
  /** A raw answer representing this position (first received). */
  readonly answer: string;
}

export interface VerificationResult {
  readonly status: VerificationStatus;
  readonly emission: Emission;
  /** The agreed answer. Present only when `emission` is `"full"`. */
  readonly answer?: string;
  /** Present when `emission` is `"partial"`; must accompany any released content. */
  readonly discrepancyHeader?: string;
  /** All positions with their answers. Empty when `emission` is `"blocked"`. */
  readonly positions: readonly PositionDetail[];
  readonly provenance: ProvenanceRecord;
}

export interface VerifyOptions {
  readonly prompt: string;
  readonly panel: readonly Panelist[];
  readonly depth: Depth;
  /**
   * Whether the output is a legally binding instrument. Divergence on a
   * binding instrument blocks emission instead of releasing a partial result.
   */
  readonly legallyBinding?: boolean;
  /**
   * Maps a raw answer to the form in which two answers count as the same.
   * Defaults to Unicode NFC, trimmed, with whitespace collapsed. Supply a
   * domain-specific function for numbers, dates, or structured output.
   */
  readonly canonicalize?: (answer: string) => string;
  readonly signal?: AbortSignal;
  readonly deliberationId?: string;
  readonly now?: () => Date;
}

export class PanelConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PanelConfigurationError";
  }
}

export function defaultCanonicalize(answer: string): string {
  return answer.normalize("NFC").trim().replace(/\s+/g, " ");
}

/** Distinct families, compared case-insensitively. */
function familiesOf(panelists: readonly { family: string }[]): string[] {
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
export async function verify(
  options: VerifyOptions,
): Promise<VerificationResult> {
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
    throw new PanelConfigurationError(
      `Depth D${depth} requires ${required} distinct model families; the panel has ${configured}`,
    );
  }

  const now = options.now ?? (() => new Date());
  const canonicalize = options.canonicalize ?? defaultCanonicalize;
  const deliberationId = options.deliberationId ?? randomUUID();
  const legallyBinding = options.legallyBinding ?? false;
  const startedAt = now().toISOString();
  const controller = new AbortController();
  const onAbort = (): void => {
    controller.abort();
  };
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  // Round 0: every panelist receives an identical request and runs
  // concurrently. No panelist's output is available to any other.
  const request: PanelRequest = Object.freeze({
    deliberationId,
    round: 0,
    prompt,
  });
  let settled: PromiseSettledResult<PanelResponse>[];
  try {
    settled = await Promise.allSettled(
      panel.map(async (panelist) =>
        panelist.respond(request, controller.signal),
      ),
    );
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    controller.abort();
  }

  const records: PanelistRecord[] = [];
  const groups = new Map<string, { answer: string; members: Panelist[] }>();
  for (const [index, outcome] of settled.entries()) {
    const panelist = panel[index] as Panelist;
    const base = {
      panelistId: panelist.id,
      family: panelist.family,
      model: panelist.model,
    };
    const answer =
      outcome.status === "fulfilled"
        ? (outcome.value.answer as unknown)
        : undefined;
    if (typeof answer !== "string" || answer.trim().length === 0) {
      const failure =
        outcome.status === "rejected"
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
    if (group) group.members.push(panelist);
    else groups.set(key, { answer, members: [panelist] });
  }

  const details: PositionDetail[] = [...groups.entries()]
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

  let status: VerificationStatus;
  let emission: Emission;
  if (respondingFamilies < required) {
    status = "insufficient_panel";
    emission = "blocked";
  } else if (details.length === 1) {
    status = "concordant";
    emission = "full";
  } else {
    status = "divergent";
    emission = legallyBinding ? "blocked" : "partial";
  }

  const unhashed: Omit<ProvenanceRecord, "recordHash"> = {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    deliberationId,
    mode: "C" as const,
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
  const provenance: ProvenanceRecord = Object.freeze({
    ...unhashed,
    recordHash: sha256Hex(canonicalJson(unhashed)),
  });

  return {
    status,
    emission,
    ...(emission === "full"
      ? { answer: (details[0] as PositionDetail).answer }
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
export function verifyProvenance(record: ProvenanceRecord): boolean {
  const { recordHash, ...rest } = record;
  try {
    return sha256Hex(canonicalJson(rest)) === recordHash;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Validation corpus scoring
// ---------------------------------------------------------------------------

export interface KnownAnswerCase {
  readonly id: string;
  readonly prompt: string;
  /** The correct answer, compared after canonicalization. */
  readonly expected: string;
}

export interface KnownAnswerReport {
  readonly cases: number;
  /** Fraction of cases each panelist answered correctly. */
  readonly panelistAccuracy: Readonly<Record<string, number>>;
  readonly bestSinglePanelist: {
    readonly id: string;
    readonly accuracy: number;
  };
  /** Cases where the panel was concordant. */
  readonly concordant: number;
  /** Concordant and correct. */
  readonly concordantCorrect: number;
  /**
   * Concordant and wrong: every family made the same error. This is the
   * correlated-error probe, and the failure a panel cannot detect on its own.
   */
  readonly concordantWrong: number;
  readonly divergent: number;
  readonly insufficient: number;
  /** concordantCorrect / concordant; 0 when the panel was never concordant. */
  readonly precisionWhenConcordant: number;
  /**
   * Accuracy of a plurality vote over the same answers (ties count as wrong).
   * Measured as a baseline only. The kernel never emits by vote.
   */
  readonly pluralityBaselineAccuracy: number;
  /**
   * The falsification test: a concordant panel must be right more often than
   * the best single panelist is. If false, the roster needs rework.
   */
  readonly panelBeatsBestSingle: boolean;
}

/** Runs Mode C over a known-answer set and scores the panel against baselines. */
export async function scoreKnownAnswers(
  cases: readonly KnownAnswerCase[],
  options: Omit<VerifyOptions, "prompt" | "deliberationId">,
): Promise<KnownAnswerReport> {
  if (cases.length === 0) {
    throw new PanelConfigurationError(
      "A known-answer set needs at least one case",
    );
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
      if (position.canonicalHash !== expectedHash) continue;
      for (const id of position.panelistIds)
        correct.set(id, (correct.get(id) ?? 0) + 1);
    }
    const ranked = [...positions].sort(
      (a, b) => b.panelistIds.length - a.panelistIds.length,
    );
    const [top, second] = ranked;
    if (
      top?.canonicalHash === expectedHash &&
      top.panelistIds.length > (second?.panelistIds.length ?? 0)
    ) {
      pluralityCorrect += 1;
    }
    if (result.status === "insufficient_panel") insufficient += 1;
    else if (result.status === "divergent") divergent += 1;
    else {
      concordant += 1;
      if (top?.canonicalHash === expectedHash) concordantCorrect += 1;
    }
  }

  const panelistAccuracy = Object.fromEntries(
    [...correct].map(([id, n]) => [id, n / cases.length]),
  );
  const best = [...correct].reduce((a, b) => (b[1] > a[1] ? b : a));
  const bestSinglePanelist = { id: best[0], accuracy: best[1] / cases.length };
  const precisionWhenConcordant =
    concordant === 0 ? 0 : concordantCorrect / concordant;
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
    panelBeatsBestSingle:
      concordant > 0 && precisionWhenConcordant > bestSinglePanelist.accuracy,
  };
}

// ---------------------------------------------------------------------------
// Panelist adapters
// ---------------------------------------------------------------------------

export interface ScriptedPanelistOptions {
  readonly id: string;
  readonly family: string;
  readonly model?: string;
  /** Answer per prompt, or a function of the prompt. A missing prompt rejects. */
  readonly answers:
    Readonly<Record<string, string>> | ((prompt: string) => string);
}

/**
 * Deterministic panelist for tests, replay fixtures, and validation corpora.
 * It calls no model.
 */
export function createScriptedPanelist(
  options: ScriptedPanelistOptions,
): Panelist {
  const { answers } = options;
  return {
    id: options.id,
    family: options.family,
    model: options.model ?? "scripted",
    respond: (request) => {
      const answer =
        typeof answers === "function"
          ? answers(request.prompt)
          : answers[request.prompt];
      return answer === undefined
        ? Promise.reject(
            new Error(`No scripted answer for panelist ${options.id}`),
          )
        : Promise.resolve({ answer });
    },
  };
}

export interface OpenAICompatiblePanelistOptions {
  readonly id: string;
  readonly family: string;
  readonly model: string;
  /** API root that serves `POST {baseUrl}/chat/completions`, e.g. `https://api.openai.com/v1`. */
  readonly baseUrl: string;
  /** The user's own key. Sent only in the Authorization header; never logged or thrown. */
  readonly apiKey: string;
  readonly system?: string;
  /** Injectable for tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
}

export class PanelistRequestError extends Error {
  constructor(
    public readonly panelistId: string,
    public readonly status: number | undefined,
    detail: string,
  ) {
    super(`Panelist ${panelistId} request failed: ${detail}`);
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
export function createOpenAICompatiblePanelist(
  options: OpenAICompatiblePanelistOptions,
): Panelist {
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const send = options.fetch ?? fetch;
  return {
    id: options.id,
    family: options.family,
    model: options.model,
    respond: async (request, signal) => {
      let response: Response;
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
      } catch (error) {
        // Error messages from fetch can echo the URL but never the headers.
        throw new PanelistRequestError(
          options.id,
          undefined,
          error instanceof Error ? error.name : "network error",
        );
      }
      if (!response.ok) {
        // The body is not included: providers sometimes echo request detail.
        throw new PanelistRequestError(
          options.id,
          response.status,
          `HTTP ${response.status}`,
        );
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new PanelistRequestError(
          options.id,
          response.status,
          "response was not JSON",
        );
      }
      const parsed = body as {
        choices?: { message?: { content?: unknown } }[];
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
      };
      const content = parsed.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new PanelistRequestError(
          options.id,
          response.status,
          "response had no text content",
        );
      }
      const tokens = (value: unknown): number | undefined =>
        typeof value === "number" && Number.isFinite(value) && value >= 0
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
