import { ReferenceConversationApp, renderReferenceAppShell } from "./reference-app.js";

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

function readValue(document: Document, testId: string): string {
  return requireElement<HTMLInputElement>(document, `[data-testid="${testId}"]`).value;
}

function bindClick(
  document: Document,
  testId: string,
  handler: () => Promise<string> | string,
  render: (result?: string, error?: string) => void,
): void {
  requireElement<HTMLButtonElement>(document, `[data-testid="${testId}"]`).addEventListener(
    "click",
    async () => {
      try {
        render(await handler(), undefined);
      } catch (error) {
        render(undefined, error instanceof Error ? error.message : String(error));
      }
    },
  );
}

export function mountReferenceConversationBrowserApp(
  document: Document,
  app: ReferenceConversationApp = new ReferenceConversationApp(),
): void {
  const shell = requireElement<HTMLElement>(document, "[data-testid='shell']");

  const render = (result?: string, error?: string) => {
    const view = app.view();
    const auditEvents = (() => {
      try {
        return app.readAuditEvents();
      } catch {
        return [] as const;
      }
    })();
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
    render,
  );
  bindClick(document, "sign-out", () => {
    app.signOut();
    return "signed-out";
  }, render);
  bindClick(document, "create-conversation", () => app.createConversation(), render);
  bindClick(document, "open-conversation", () => {
    app.openConversation(readValue(document, "open-conversation-id"));
    return "opened";
  }, render);
  bindClick(document, "send-message", async () =>
    (await app.sendMessage(readValue(document, "message-input"))).join(""), render);
  bindClick(document, "request-tool", () =>
    app.requestHarmlessTool(readValue(document, "tool-name")).approvalId, render);
  bindClick(document, "execute-tool", () => app.executePendingTool(), render);
  bindClick(document, "approve-tool", () =>
    app.approvePendingTool(
      readValue(document, "resolved-by"),
      readValue(document, "resolved-at"),
    ), render);
  bindClick(document, "delete-conversation", () => {
    app.deleteConversation();
    return "deleted";
  }, render);

  render();
}
