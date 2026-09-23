import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";

import { expect, test } from "@playwright/test";

const execFile = promisify(execFileCallback);
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const tempRoot = await mkdtemp(join(tmpdir(), "atlantis-reference-browser-"));
const compiledRoot = join(tempRoot, "compiled");
const rootTypeScript = join(repositoryRoot, "node_modules", "typescript", "bin", "tsc");
const appBrowserRuntime = join(
  repositoryRoot,
  "apps/reference-governed-conversation/src/browser-runtime.ts",
);
const appReference = join(
  repositoryRoot,
  "apps/reference-governed-conversation/src/reference-app.ts",
);
const contractApproval = join(repositoryRoot, "packages/contracts/src/approval-control.ts");
const eventStoreCore = join(repositoryRoot, "packages/event-store/src/event-store-core.ts");
const eventStoreConversation = join(
  repositoryRoot,
  "packages/event-store/src/governed-conversation.ts",
);

await mkdir(compiledRoot, { recursive: true });
await execFile(
  process.execPath,
  [
    rootTypeScript,
    "--module",
    "nodenext",
    "--moduleResolution",
    "nodenext",
    "--target",
    "es2022",
    "--outDir",
    compiledRoot,
    "--rootDir",
    repositoryRoot,
    appBrowserRuntime,
    appReference,
    contractApproval,
    eventStoreCore,
    eventStoreConversation,
  ],
  { cwd: repositoryRoot },
);

function createHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <script type="importmap">
      {
        "imports": {
          "@atlantis/event-store/governed-conversation": "/packages/event-store/src/governed-conversation.js",
          "@atlantis/contracts/approval-control": "/packages/contracts/src/approval-control.js"
        }
      }
    </script>
  </head>
  <body>
    <label>Tenant <input data-testid="tenant-id" /></label>
    <label>User <input data-testid="user-id" /></label>
    <button data-testid="sign-in">Sign in</button>
    <button data-testid="sign-out">Sign out</button>
    <button data-testid="create-conversation">Create conversation</button>
    <label>Open <input data-testid="open-conversation-id" /></label>
    <button data-testid="open-conversation">Open conversation</button>
    <label>Message <input data-testid="message-input" /></label>
    <button data-testid="send-message">Send message</button>
    <label>Tool <input data-testid="tool-name" value="echo-status" /></label>
    <button data-testid="request-tool">Request tool</button>
    <button data-testid="execute-tool">Execute pending tool</button>
    <label>Resolved by <input data-testid="resolved-by" value="reviewer-a" /></label>
    <label>Resolved at <input data-testid="resolved-at" value="2999-01-01T00:00:00.000Z" /></label>
    <button data-testid="approve-tool">Approve pending tool</button>
    <button data-testid="delete-conversation">Delete conversation</button>
    <section
      data-testid="shell"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label="Governed conversation state"
    ></section>
    <pre data-testid="audit-types" role="log" aria-live="polite" aria-label="Audit event types"></pre>
    <pre data-testid="audit-message-contents" aria-label="Audit message contents"></pre>
    <pre data-testid="error" role="alert" aria-live="assertive"></pre>
    <pre data-testid="result" role="status" aria-live="polite"></pre>
    <script type="module">
      import { mountReferenceConversationBrowserApp } from "/apps/reference-governed-conversation/src/browser-runtime.js";
      mountReferenceConversationBrowserApp(document);
    </script>
  </body>
</html>`;
}

const indexHtml = join(tempRoot, "index.html");
await writeFile(indexHtml, createHtml(), "utf8");

function contentType(pathname: string): string {
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  return "text/plain; charset=utf-8";
}

let server: Server;
let origin = "";

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const filePath = requestUrl.pathname === "/"
        ? indexHtml
        : join(compiledRoot, requestUrl.pathname.slice(1));
      const content = await readFile(filePath);
      response.writeHead(200, { "content-type": contentType(filePath) });
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("browser test server did not expose a TCP port");
  }
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  await rm(tempRoot, { recursive: true, force: true });
});

test("runs sign-in, conversation, approval gate, audit evidence, and deletion in a real browser runtime", async ({ page }) => {
  await page.goto(origin);

  await expect(page.getByTestId("shell")).toHaveAttribute("role", "status");
  await expect(page.getByTestId("shell")).toHaveAttribute("aria-live", "polite");
  await expect(page.getByTestId("result")).toHaveAttribute("role", "status");
  await expect(page.getByTestId("error")).toHaveAttribute("role", "alert");

  await page.getByTestId("create-conversation").click();
  await expect(page.getByTestId("error")).toHaveText("reference sign-in required");

  await page.getByTestId("tenant-id").fill("tenant-a");
  await page.getByTestId("user-id").fill("user-a");
  await page.getByTestId("sign-in").click();
  await expect(page.locator("[data-context='identity']")).toHaveText("tenant=tenant-a;user=user-a");

  await page.getByTestId("create-conversation").click();
  await expect(page.locator("[data-context='conversation']")).toHaveText("conversation-1");

  await page.getByTestId("message-input").fill("hello atlantis");
  await page.getByTestId("send-message").click();
  await expect(page.locator("[data-context='messages']")).toHaveText(
    "user:hello atlantis|assistant:mock:hello atlantis",
  );

  await page.getByTestId("request-tool").click();
  await expect(page.locator("[data-context='pending-approval']")).toContainText("approval-");
  await expect(page.getByTestId("audit-types")).toContainText("conversation.tool.requested");

  await page.reload();
  await expect(page.locator("[data-context='identity']")).toHaveText("tenant=tenant-a;user=user-a");
  await expect(page.locator("[data-context='conversation']")).toHaveText("conversation-1");
  await expect(page.locator("[data-context='messages']")).toHaveText(
    "user:hello atlantis|assistant:mock:hello atlantis",
  );
  await expect(page.locator("[data-context='pending-approval']")).toContainText("approval-");
  await expect(page.getByTestId("audit-types")).toContainText("conversation.tool.requested");

  await page.getByTestId("execute-tool").click();
  await expect(page.getByTestId("error")).toContainText("Approval approval-");

  await page.getByTestId("approve-tool").click();
  await expect(page.getByTestId("result")).toHaveText("tool:echo-status:ok");
  await expect(page.getByTestId("audit-types")).toContainText("conversation.tool.approved");
  await expect(page.locator("[data-context='policy']")).toHaveText(
    "allowed:reference conversation policy permits harmless demonstration tools",
  );

  await page.getByTestId("delete-conversation").click();
  await expect(page.locator("[data-context='conversation']")).toHaveText("none");
});

test("fails closed for cross-tenant access in the browser and preserves redacted owner audit", async ({ page }) => {
  await page.goto(origin);

  await page.getByTestId("tenant-id").fill("tenant-a");
  await page.getByTestId("user-id").fill("user-a");
  await page.getByTestId("sign-in").click();
  await page.getByTestId("create-conversation").click();
  await page.getByTestId("message-input").fill("delete me");
  await page.getByTestId("send-message").click();
  await page.getByTestId("delete-conversation").click();

  await page.getByTestId("open-conversation-id").fill("conversation-1");
  await page.getByTestId("open-conversation").click();
  await expect(page.getByTestId("audit-message-contents")).toHaveText("[deleted]|[deleted]");
  await expect(page.locator("[data-context='conversation']")).toHaveText("none");

  await page.getByTestId("tenant-id").fill("tenant-b");
  await page.getByTestId("user-id").fill("user-b");
  await page.getByTestId("sign-in").click();
  await page.getByTestId("open-conversation-id").fill("conversation-1");
  await page.getByTestId("open-conversation").click();
  await page.getByTestId("request-tool").click();
  await expect(page.getByTestId("error")).toHaveText(
    "conversation access denied for tenant/user context",
  );
});
