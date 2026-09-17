import { DurableSnapshotEventStore, type AtomicSnapshotStorage } from "../../../packages/event-store/src/event-store-core.js";
import { GovernedConversationService } from "../../../packages/event-store/src/governed-conversation.js";

import {
  ReferenceConversationApp,
  type ReferenceBrowserSessionState,
  renderReferenceAppShell,
} from "./reference-app.js";

const STORE_STORAGE_KEY = "atlantis.reference-governed-conversation.event-store";
const SESSION_STORAGE_KEY = "atlantis.reference-governed-conversation.session";

function requireElement<T extends Element>(document: Document, selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`missing required element ${selector}`);
  }
  return element;
}

function setText(document: Document, testId: string, value: string): void {
  requireElement<HTMLElement>(document, `[data-testid="${testId}"]`).textContent = value;
}

function setValue(document: Document, testId: string, value: string): void {
  requireElement<HTMLInputElement>(document, `[data-testid="${testId}"]`).value = value;
}

function readValue(document: Document, testId: string): string {
  return requireElement<HTMLInputElement>(document, `[data-testid="${testId}"]`).value;
}

class LocalStorageAtomicSnapshotStorage implements AtomicSnapshotStorage {
  public constructor(
    private readonly storage: Storage,
    private readonly key: string,
  ) {}

  public load(): { readonly revision: number; readonly value: string | null } {
    const stored = this.storage.getItem(this.key);
    if (stored === null) {
      return Object.freeze({ revision: 0, value: null });
    }
    const parsed = JSON.parse(stored) as { readonly revision?: unknown; readonly value?: unknown };
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      !Number.isSafeInteger(parsed.revision) ||
      (parsed.revision as number) < 0 ||
      (parsed.value !== null && typeof parsed.value !== "string")
    ) {
      throw new Error("reference browser persistence is corrupted");
    }
    return Object.freeze({
      revision: parsed.revision as number,
      value: parsed.value as string | null,
    });
  }

  public compareAndSwap(expectedRevision: number, nextValue: string): boolean {
    const current = this.load();
    if (current.revision !== expectedRevision) {
      return false;
    }
    this.storage.setItem(this.key, JSON.stringify({
      revision: current.revision + 1,
      value: nextValue,
    }));
    return true;
  }
}

function defaultApp(document: Document): ReferenceConversationApp {
  const view = document.defaultView;
  if (view === null) {
    throw new Error("reference browser runtime requires a window");
  }
  const storage = new LocalStorageAtomicSnapshotStorage(view.localStorage, STORE_STORAGE_KEY);
  return new ReferenceConversationApp(
    new GovernedConversationService(new DurableSnapshotEventStore(storage)),
  );
}

function parseSessionState(raw: string | null): ReferenceBrowserSessionState | null {
  if (raw === null) {
    return null;
  }
  const parsed = JSON.parse(raw) as {
    readonly identity?: { readonly tenantId?: unknown; readonly userId?: unknown } | null;
    readonly conversationId?: unknown;
  };
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("reference browser session is corrupted");
  }
  const identity = parsed.identity;
  if (identity !== null && identity !== undefined) {
    if (
      typeof identity !== "object" ||
      Array.isArray(identity) ||
      identity === null ||
      typeof identity.tenantId !== "string" ||
      typeof identity.userId !== "string"
    ) {
      throw new Error("reference browser session is corrupted");
    }
  }
  const conversationId = parsed.conversationId;
  if (conversationId !== null && conversationId !== undefined && typeof conversationId !== "string") {
    throw new Error("reference browser session is corrupted");
  }
  return Object.freeze({
    identity: identity === null || identity === undefined
      ? null
      : Object.freeze({
        tenantId: identity.tenantId as string,
        userId: identity.userId as string,
      }),
    conversationId: conversationId === null || conversationId === undefined
      ? null
        : conversationId as string,
  });
}

function persistSessionState(document: Document, app: ReferenceConversationApp): void {
  const storage = document.defaultView?.localStorage;
  if (storage === undefined) {
    return;
  }
  const state = app.snapshotSessionState();
  if (state.identity === null && state.conversationId === null) {
    storage.removeItem(SESSION_STORAGE_KEY);
    return;
  }
  storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state));
}

function restoreSessionState(document: Document, app: ReferenceConversationApp): void {
  const storage = document.defaultView?.localStorage;
  if (storage === undefined) {
    return;
  }
  const state = parseSessionState(storage.getItem(SESSION_STORAGE_KEY));
  if (state !== null) {
    app.restoreSessionState(state);
  }
}

function reflectSessionState(document: Document, app: ReferenceConversationApp): void {
  const state = app.snapshotSessionState();
  setValue(document, "tenant-id", state.identity?.tenantId ?? "");
  setValue(document, "user-id", state.identity?.userId ?? "");
  setValue(document, "open-conversation-id", state.conversationId ?? "");
}

function bindClick(
  document: Document,
  testId: string,
  handler: () => Promise<string> | string,
  render: (result?: string, error?: string) => Promise<void> | void,
): void {
  requireElement<HTMLButtonElement>(document, `[data-testid="${testId}"]`).addEventListener(
    "click",
    async () => {
      try {
        await render(await handler(), undefined);
      } catch (error) {
        await render(undefined, error instanceof Error ? error.message : String(error));
      }
    },
  );
}

export function mountReferenceConversationBrowserApp(
  document: Document,
  app: ReferenceConversationApp = defaultApp(document),
): void {
  const shell = requireElement<HTMLElement>(document, "[data-testid='shell']");
  const showError = (message: string) => {
    setText(document, "error", message);
    setText(document, "result", "");
  };

  const render = (result?: string, error?: string) => {
    persistSessionState(document, app);
    reflectSessionState(document, app);
    const view = app.view();
    const auditEvents = view.auditEvents;
    shell.innerHTML = renderReferenceAppShell(view);
    setText(
      document,
      "audit-types",
      auditEvents.map((event) => event.eventType).join("|"),
    );
    setText(
      document,
      "audit-message-contents",
      auditEvents
        .filter((event) => event.eventType === "conversation.message")
        .map((event) => {
          const payload = event.payload as { readonly message?: { readonly content?: string } };
          return payload.message?.content ?? "";
        })
        .join("|"),
    );
    setText(document, "error", error ?? "");
    setText(document, "result", result ?? "");
  };
  const safeRender = async (result?: string, error?: string) => {
    try {
      await render(result, error);
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  bindClick(
    document,
    "sign-in",
    () => {
      app.signIn({
        tenantId: readValue(document, "tenant-id"),
        userId: readValue(document, "user-id"),
      });
      return "signed-in";
    },
    safeRender,
  );
  bindClick(document, "sign-out", () => {
    app.signOut();
    return "signed-out";
  }, safeRender);
  bindClick(document, "create-conversation", () => app.createConversation(), safeRender);
  bindClick(document, "open-conversation", () => {
    app.openConversation(readValue(document, "open-conversation-id"));
    return "opened";
  }, safeRender);
  bindClick(document, "send-message", async () =>
    (await app.sendMessage(readValue(document, "message-input"))).join(""), safeRender);
  bindClick(document, "request-tool", () =>
    app.requestHarmlessTool(readValue(document, "tool-name")).approvalId, safeRender);
  bindClick(document, "execute-tool", () => app.executePendingTool(), safeRender);
  bindClick(document, "approve-tool", () =>
    app.approvePendingTool(
      readValue(document, "resolved-by"),
      readValue(document, "resolved-at"),
    ), safeRender);
  bindClick(document, "delete-conversation", () => {
    app.deleteConversation();
    return "deleted";
  }, safeRender);

  try {
    restoreSessionState(document, app);
    void safeRender();
  } catch (cause) {
    showError(cause instanceof Error ? cause.message : String(cause));
  }
}
