import { describe, expect, it } from "vitest";
import {
  createOpenAICompatiblePanelist,
  createScriptedPanelist,
  defaultCanonicalize,
  MIN_FAMILIES,
  PanelConfigurationError,
  PanelistRequestError,
  PROVENANCE_SCHEMA_VERSION,
  scoreKnownAnswers,
  verify,
  verifyProvenance,
  type Panelist,
  type PanelRequest,
} from "../src/index.js";

const Q = "What is 17 * 23?";
const fixed = () => new Date("2026-01-01T00:00:00.000Z");

function panelist(
  id: string,
  family: string,
  answer: string | Error,
): Panelist {
  return {
    id,
    family,
    model: `${family}-1`,
    respond: async () => {
      if (answer instanceof Error) throw answer;
      return { answer };
    },
  };
}

const agree = [
  panelist("a", "alpha", "391"),
  panelist("b", "beta", " 391 "),
  panelist("c", "gamma", "391"),
];
const split = [
  panelist("a", "alpha", "391"),
  panelist("b", "beta", "391"),
  panelist("c", "gamma", "381"),
];

describe("verify (Mode C)", () => {
  it("releases the answer only when every responder agrees", async () => {
    const result = await verify({
      prompt: Q,
      panel: agree,
      depth: 2,
      deliberationId: "d-1",
      now: fixed,
    });

    expect(result).toMatchObject({
      status: "concordant",
      emission: "full",
      answer: "391",
    });
    expect(result.discrepancyHeader).toBeUndefined();
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0]?.panelistIds).toEqual(["a", "b", "c"]);
    expect(result.provenance).toMatchObject({
      schemaVersion: PROVENANCE_SCHEMA_VERSION,
      deliberationId: "d-1",
      mode: "C",
      depth: 2,
      requiredFamilies: 3,
      respondingFamilies: 3,
    });
  });

  it("reports divergence as the finding and never picks the majority", async () => {
    const result = await verify({ prompt: Q, panel: split, depth: 2 });

    expect(result.status).toBe("divergent");
    expect(result.emission).toBe("partial");
    expect(result.answer).toBeUndefined();
    expect(result.discrepancyHeader).toMatch(
      /^UNRESOLVED DISCREPANCY: 2 distinct answers from 3 model families/,
    );
    expect(result.positions.map((p) => p.answer).sort()).toEqual([
      "381",
      "391",
    ]);
    const dissent = result.positions.find((p) => p.answer === "381");
    expect(dissent).toMatchObject({ panelistIds: ["c"], families: ["gamma"] });
  });

  it("orders positions by content hash, not by how many agree", async () => {
    const forward = await verify({ prompt: Q, panel: split, depth: 2 });
    const flipped = await verify({
      prompt: Q,
      panel: [
        panelist("a", "alpha", "381"),
        panelist("b", "beta", "381"),
        panelist("c", "gamma", "391"),
      ],
      depth: 2,
    });
    expect(forward.positions.map((p) => p.answer)).toEqual(
      flipped.positions.map((p) => p.answer),
    );
  });

  it("blocks emission when a binding instrument diverges", async () => {
    const result = await verify({
      prompt: Q,
      panel: split,
      depth: 2,
      legallyBinding: true,
    });
    expect(result.emission).toBe("blocked");
    expect(result.positions).toEqual([]);
    expect(result.answer).toBeUndefined();
    expect(result.provenance.positions).toHaveLength(2);
    expect(result.provenance.legallyBinding).toBe(true);
  });

  it("gives every panelist the same blind round-0 request", async () => {
    const seen: PanelRequest[] = [];
    const spy = (id: string, family: string): Panelist => ({
      id,
      family,
      model: "m",
      respond: async (request) => {
        seen.push(request);
        return { answer: "x" };
      },
    });
    await verify({
      prompt: Q,
      panel: [spy("a", "alpha"), spy("b", "beta")],
      depth: 1,
      deliberationId: "d-blind",
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toEqual({ deliberationId: "d-blind", round: 0, prompt: Q });
    expect(Object.isFrozen(seen[0])).toBe(true);
  });

  it("counts diversity in families, not instances", async () => {
    await expect(
      verify({
        prompt: Q,
        panel: [
          panelist("a", "alpha", "1"),
          panelist("b", "Alpha", "1"),
          panelist("c", " alpha ", "1"),
        ],
        depth: 2,
      }),
    ).rejects.toThrow(/requires 3 distinct model families; the panel has 1/);
    expect(MIN_FAMILIES).toEqual({ 0: 1, 1: 2, 2: 3, 3: 4, 4: 5 });
  });

  it("rejects duplicate ids and undeclared families", async () => {
    await expect(
      verify({
        prompt: Q,
        panel: [panelist("a", "alpha", "1"), panelist("a", "beta", "1")],
        depth: 0,
      }),
    ).rejects.toThrow(PanelConfigurationError);
    await expect(
      verify({ prompt: Q, panel: [panelist("a", "  ", "1")], depth: 0 }),
    ).rejects.toThrow(/declare a family/);
  });

  it("blocks when failures leave too few families, recording error names only", async () => {
    class ProviderDown extends Error {
      override name = "ProviderDown";
    }
    const result = await verify({
      prompt: Q,
      panel: [
        panelist("a", "alpha", "391"),
        panelist("b", "beta", new ProviderDown("key sk-live-secret rejected")),
        panelist("c", "gamma", "   "),
        {
          id: "d",
          family: "delta",
          model: "m",
          respond: async () => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw "string failure";
          },
        },
      ],
      depth: 2,
    });

    expect(result.status).toBe("insufficient_panel");
    expect(result.emission).toBe("blocked");
    expect(result.positions).toEqual([]);
    expect(result.provenance.respondingFamilies).toBe(1);
    expect(result.provenance.panel.map((p) => p.failure)).toEqual([
      undefined,
      "ProviderDown",
      "EmptyAnswer",
      "NonError",
    ]);
    expect(JSON.stringify(result.provenance)).not.toContain("sk-live-secret");
  });

  it("still concludes when a spare family fails", async () => {
    const result = await verify({
      prompt: Q,
      panel: [...agree, panelist("d", "delta", new Error("down"))],
      depth: 2,
    });
    expect(result.status).toBe("concordant");
    expect(result.provenance.respondingFamilies).toBe(3);
  });

  it("uses a caller-supplied canonical form", async () => {
    const result = await verify({
      prompt: Q,
      panel: [
        panelist("a", "alpha", "391.0"),
        panelist("b", "beta", "391"),
        panelist("c", "gamma", "3.91e2"),
      ],
      depth: 2,
      canonicalize: (answer) => String(Number(answer)),
    });
    expect(result.status).toBe("concordant");
    expect(defaultCanonicalize("  a \n b  ")).toBe("a b");
  });

  it("keeps prompts and answers out of the provenance record", async () => {
    const result = await verify({
      prompt: "account 4417 balance?",
      panel: [panelist("a", "alpha", "balance is 9,120.55")],
      depth: 0,
    });
    const serialized = JSON.stringify(result.provenance);
    expect(serialized).not.toContain("4417");
    expect(serialized).not.toContain("9,120.55");
    expect(result.provenance.panel[0]?.answerHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a tamper-evident, reproducible provenance record", async () => {
    const run = () =>
      verify({
        prompt: Q,
        panel: split,
        depth: 2,
        deliberationId: "d-1",
        now: fixed,
      });
    const first = await run();
    const second = await run();

    expect(first.provenance.recordHash).toBe(second.provenance.recordHash);
    expect(verifyProvenance(first.provenance)).toBe(true);
    expect(
      verifyProvenance({ ...first.provenance, status: "concordant" }),
    ).toBe(false);
    expect(
      verifyProvenance({ ...first.provenance, depth: Number.NaN as never }),
    ).toBe(false);
    expect(Object.isFrozen(first.provenance)).toBe(true);
  });

  it("propagates cancellation to panelists and stops them when done", async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    const waits: Panelist = {
      id: "a",
      family: "alpha",
      model: "m",
      respond: (_request, signal) =>
        new Promise((_, reject) => {
          signals.push(signal);
          signal.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
          queueMicrotask(() => {
            controller.abort();
          });
        }),
    };
    const result = await verify({
      prompt: Q,
      panel: [waits],
      depth: 0,
      signal: controller.signal,
    });
    expect(result.status).toBe("insufficient_panel");
    expect(result.provenance.panel[0]?.failure).toBe("AbortError");

    const preAborted = new AbortController();
    preAborted.abort();
    const quick: Panelist = {
      id: "q",
      family: "alpha",
      model: "m",
      respond: async (_request, signal) => {
        signals.push(signal);
        return { answer: "ok" };
      },
    };
    await verify({
      prompt: Q,
      panel: [quick],
      depth: 0,
      signal: preAborted.signal,
    });
    expect(signals.every((s) => s.aborted)).toBe(true);
  });
});

describe("scoreKnownAnswers", () => {
  const cases = [
    { id: "1", prompt: "q1", expected: "A" },
    { id: "2", prompt: "q2", expected: "B" },
    { id: "3", prompt: "q3", expected: "C" },
    { id: "4", prompt: "q4", expected: "D" },
  ];
  const scripted = (
    id: string,
    family: string,
    answers: Record<string, string>,
  ) => createScriptedPanelist({ id, family, answers });

  it("scores the panel against single-panelist and plurality baselines", async () => {
    const report = await scoreKnownAnswers(cases, {
      depth: 2,
      panel: [
        // q1: all right. q2: one wrong. q3: all wrong the same way. q4: three-way split.
        scripted("a", "alpha", { q1: "A", q2: "B", q3: "X", q4: "D" }),
        scripted("b", "beta", { q1: "A", q2: "B", q3: "X", q4: "Y" }),
        scripted("c", "gamma", { q1: "A", q2: "Z", q3: "X", q4: "W" }),
      ],
    });

    expect(report).toEqual({
      cases: 4,
      panelistAccuracy: { a: 0.75, b: 0.5, c: 0.25 },
      bestSinglePanelist: { id: "a", accuracy: 0.75 },
      concordant: 2,
      concordantCorrect: 1,
      concordantWrong: 1,
      divergent: 2,
      insufficient: 0,
      precisionWhenConcordant: 0.5,
      pluralityBaselineAccuracy: 0.5,
      panelBeatsBestSingle: false,
    });
  });

  it("passes the falsification test when concordance is more reliable than any one panelist", async () => {
    const report = await scoreKnownAnswers(cases.slice(0, 2), {
      depth: 1,
      panel: [
        scripted("a", "alpha", { q1: "A", q2: "B" }),
        scripted("b", "beta", { q1: "A", q2: "Q" }),
      ],
    });
    expect(report.precisionWhenConcordant).toBe(1);
    expect(report.bestSinglePanelist.accuracy).toBe(1);
    expect(report.panelBeatsBestSingle).toBe(false);

    const better = await scoreKnownAnswers(cases.slice(0, 2), {
      depth: 1,
      panel: [
        scripted("a", "alpha", { q1: "A", q2: "P" }),
        scripted("b", "beta", { q1: "A", q2: "Q" }),
      ],
    });
    expect(better.panelBeatsBestSingle).toBe(true);
  });

  it("counts insufficient panels and never-concordant runs", async () => {
    const report = await scoreKnownAnswers(cases.slice(0, 1), {
      depth: 1,
      panel: [
        scripted("a", "alpha", { q1: "A" }),
        createScriptedPanelist({ id: "b", family: "beta", answers: {} }),
      ],
    });
    expect(report).toMatchObject({
      insufficient: 1,
      concordant: 0,
      precisionWhenConcordant: 0,
      panelBeatsBestSingle: false,
    });
    await expect(
      scoreKnownAnswers([], { depth: 0, panel: [] }),
    ).rejects.toThrow(/at least one case/);
  });
});

describe("panelist adapters", () => {
  const request: PanelRequest = {
    deliberationId: "d",
    round: 0,
    prompt: "hello",
  };
  const signal = new AbortController().signal;

  it("scripted panelist answers from a function and defaults its model", async () => {
    const p = createScriptedPanelist({
      id: "s",
      family: "alpha",
      answers: (prompt) => prompt.toUpperCase(),
    });
    expect(p.model).toBe("scripted");
    expect(await p.respond(request, signal)).toEqual({ answer: "HELLO" });
  });

  const adapter = (fetchImpl: typeof fetch, system?: string) =>
    createOpenAICompatiblePanelist({
      id: "o",
      family: "gpt",
      model: "some-model",
      baseUrl: "https://example.test/v1//",
      apiKey: "sk-live-secret",
      fetch: fetchImpl,
      ...(system ? { system } : {}),
    });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  it("sends a chat-completions request and maps the response", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const p = adapter(async (url, init) => {
      captured = { url: url as string, init: init! };
      return json({
        choices: [{ message: { content: "hi there" } }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      });
    }, "be terse");

    expect(await p.respond(request, signal)).toEqual({
      answer: "hi there",
      inputTokens: 5,
      outputTokens: 2,
    });
    expect(captured?.url).toBe("https://example.test/v1/chat/completions");
    expect(captured?.init.signal).toBe(signal);
    expect(
      (captured?.init.headers as Record<string, string>).authorization,
    ).toBe("Bearer sk-live-secret");
    expect(JSON.parse(captured?.init.body as string)).toEqual({
      model: "some-model",
      messages: [
        { role: "system", content: "be terse" },
        { role: "user", content: "hello" },
      ],
    });
  });

  it("omits usage it cannot trust and the system message when unset", async () => {
    let body = "";
    const p = adapter(async (_url, init) => {
      body = init?.body as string;
      return json({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: -1, completion_tokens: "many" },
      });
    });
    expect(await p.respond(request, signal)).toEqual({ answer: "ok" });
    expect((JSON.parse(body) as { messages: unknown[] }).messages).toHaveLength(
      1,
    );
  });

  it.each([
    [
      "an HTTP error",
      async () => json({ error: "bad key sk-live-secret" }, 401),
      401,
    ],
    [
      "a non-JSON body",
      async () => new Response("<html>", { status: 200 }),
      200,
    ],
    ["a body with no text", async () => json({ choices: [] }), 200],
    [
      "a network failure",
      async () => {
        throw new TypeError("fetch failed for key sk-live-secret");
      },
      undefined,
    ],
    [
      "a non-Error network failure",
      async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "sk-live-secret";
      },
      undefined,
    ],
  ])("fails without leaking the key on %s", async (_label, impl, status) => {
    const p = adapter(impl);
    const error = await p.respond(request, signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PanelistRequestError);
    expect((error as PanelistRequestError).status).toBe(status);
    expect((error as Error).message).not.toContain("sk-live-secret");
  });

  it("defaults to the global fetch", () => {
    const p = createOpenAICompatiblePanelist({
      id: "o",
      family: "gpt",
      model: "m",
      baseUrl: "https://example.test/v1",
      apiKey: "k",
    });
    expect(p.id).toBe("o");
  });
});
