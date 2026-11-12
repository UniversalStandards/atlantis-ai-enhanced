/** Version of the {@link ProvenanceRecord} shape. Bump on any breaking change. */
export declare const PROVENANCE_SCHEMA_VERSION = "1.0.0";
/** Deliberation Depth Ladder, D0 (trivial, reversible) to D4 (binding, high blast radius). */
export type Depth = 0 | 1 | 2 | 3 | 4;
/**
 * Minimum number of distinct model families that must answer at each depth.
 * Diversity is counted in families, never in instances: three instances of one
 * family share training data and failure modes, and count as one.
 */
export declare const MIN_FAMILIES: Readonly<Record<Depth, number>>;
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
"concordant"
/** Panelists disagree. The disagreement is the finding. */
 | "divergent"
/** Too few distinct families answered for the requested depth. */
 | "insufficient_panel";
export type Emission = 
/** Concordant: the agreed answer is released. */
"full"
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
export declare class PanelConfigurationError extends Error {
    constructor(message: string);
}
export declare function defaultCanonicalize(answer: string): string;
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
export declare function verify(options: VerifyOptions): Promise<VerificationResult>;
/** Recomputes a provenance record's hash. False if any field was altered. */
export declare function verifyProvenance(record: ProvenanceRecord): boolean;
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
export declare function scoreKnownAnswers(cases: readonly KnownAnswerCase[], options: Omit<VerifyOptions, "prompt" | "deliberationId">): Promise<KnownAnswerReport>;
export interface ScriptedPanelistOptions {
    readonly id: string;
    readonly family: string;
    readonly model?: string;
    /** Answer per prompt, or a function of the prompt. A missing prompt rejects. */
    readonly answers: Readonly<Record<string, string>> | ((prompt: string) => string);
}
/**
 * Deterministic panelist for tests, replay fixtures, and validation corpora.
 * It calls no model.
 */
export declare function createScriptedPanelist(options: ScriptedPanelistOptions): Panelist;
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
export declare class PanelistRequestError extends Error {
    readonly panelistId: string;
    readonly status: number | undefined;
    constructor(panelistId: string, status: number | undefined, detail: string);
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
export declare function createOpenAICompatiblePanelist(options: OpenAICompatiblePanelistOptions): Panelist;
//# sourceMappingURL=index.d.ts.map