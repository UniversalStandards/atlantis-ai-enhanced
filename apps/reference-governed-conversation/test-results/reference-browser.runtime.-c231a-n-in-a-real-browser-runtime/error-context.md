# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: reference-browser.runtime.playwright.ts >> runs sign-in, conversation, approval gate, audit evidence, and deletion in a real browser runtime
- Location: test/reference-browser.runtime.playwright.ts:143:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  getByTestId('error')
Expected: "reference sign-in required"
Received: ""
Timeout:  5000ms

Call log:
  - Expect "toHaveText" with timeout 5000ms
  - waiting for getByTestId('error')
    14 × locator resolved to <pre data-testid="error"></pre>
       - unexpected value ""

```

```yaml
- text: Tenant
- textbox "Tenant"
- text: User
- textbox "User"
- button "Sign in"
- button "Sign out"
- button "Create conversation"
- text: Open
- textbox "Open"
- button "Open conversation"
- text: Message
- textbox "Message"
- button "Send message"
- text: Tool
- textbox "Tool": echo-status
- button "Request tool"
- button "Execute pending tool"
- text: Resolved by
- textbox "Resolved by": reviewer-a
- text: Resolved at
- textbox "Resolved at": 2026-09-05T00:00:06.000Z
- button "Approve pending tool"
- button "Delete conversation"
```

# Test source

```ts
  47  |     appReference,
  48  |     contractApproval,
  49  |     eventStoreIndex,
  50  |     eventStoreConversation,
  51  |   ],
  52  |   { cwd: repositoryRoot },
  53  | );
  54  | 
  55  | function createHtml(): string {
  56  |   return `<!doctype html>
  57  | <html lang="en">
  58  |   <head>
  59  |     <meta charset="utf-8" />
  60  |     <script type="importmap">
  61  |       {
  62  |         "imports": {
  63  |           "@atlantis/event-store/governed-conversation": "/packages/event-store/src/governed-conversation.js",
  64  |           "@atlantis/contracts/approval-control": "/packages/contracts/src/approval-control.js"
  65  |         }
  66  |       }
  67  |     </script>
  68  |   </head>
  69  |   <body>
  70  |     <label>Tenant <input data-testid="tenant-id" /></label>
  71  |     <label>User <input data-testid="user-id" /></label>
  72  |     <button data-testid="sign-in">Sign in</button>
  73  |     <button data-testid="sign-out">Sign out</button>
  74  |     <button data-testid="create-conversation">Create conversation</button>
  75  |     <label>Open <input data-testid="open-conversation-id" /></label>
  76  |     <button data-testid="open-conversation">Open conversation</button>
  77  |     <label>Message <input data-testid="message-input" /></label>
  78  |     <button data-testid="send-message">Send message</button>
  79  |     <label>Tool <input data-testid="tool-name" value="echo-status" /></label>
  80  |     <button data-testid="request-tool">Request tool</button>
  81  |     <button data-testid="execute-tool">Execute pending tool</button>
  82  |     <label>Resolved by <input data-testid="resolved-by" value="reviewer-a" /></label>
  83  |     <label>Resolved at <input data-testid="resolved-at" value="2026-09-05T00:00:06.000Z" /></label>
  84  |     <button data-testid="approve-tool">Approve pending tool</button>
  85  |     <button data-testid="delete-conversation">Delete conversation</button>
  86  |     <section data-testid="shell"></section>
  87  |     <pre data-testid="audit-types"></pre>
  88  |     <pre data-testid="audit-message-contents"></pre>
  89  |     <pre data-testid="error"></pre>
  90  |     <pre data-testid="result"></pre>
  91  |     <script type="module">
  92  |       import { mountReferenceConversationBrowserApp } from "/apps/reference-governed-conversation/src/browser-runtime.js";
  93  |       mountReferenceConversationBrowserApp(document);
  94  |     </script>
  95  |   </body>
  96  | </html>`;
  97  | }
  98  | 
  99  | const indexHtml = join(tempRoot, "index.html");
  100 | await writeFile(indexHtml, createHtml(), "utf8");
  101 | 
  102 | function contentType(pathname: string): string {
  103 |   if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  104 |   if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  105 |   return "text/plain; charset=utf-8";
  106 | }
  107 | 
  108 | let server: Server;
  109 | let origin = "";
  110 | 
  111 | test.beforeAll(async () => {
  112 |   server = createServer(async (request, response) => {
  113 |     try {
  114 |       const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  115 |       const filePath = requestUrl.pathname === "/"
  116 |         ? indexHtml
  117 |         : join(compiledRoot, requestUrl.pathname.slice(1));
  118 |       const content = await readFile(filePath);
  119 |       response.writeHead(200, { "content-type": contentType(filePath) });
  120 |       response.end(content);
  121 |     } catch {
  122 |       response.writeHead(404);
  123 |       response.end("not found");
  124 |     }
  125 |   });
  126 |   await new Promise<void>((resolve) => {
  127 |     server.listen(0, "127.0.0.1", () => resolve());
  128 |   });
  129 |   const address = server.address();
  130 |   if (address === null || typeof address === "string") {
  131 |     throw new Error("browser test server did not expose a TCP port");
  132 |   }
  133 |   origin = `http://127.0.0.1:${address.port}`;
  134 | });
  135 | 
  136 | test.afterAll(async () => {
  137 |   await new Promise<void>((resolve, reject) => {
  138 |     server.close((error) => (error === undefined ? resolve() : reject(error)));
  139 |   });
  140 |   await rm(tempRoot, { recursive: true, force: true });
  141 | });
  142 | 
  143 | test("runs sign-in, conversation, approval gate, audit evidence, and deletion in a real browser runtime", async ({ page }) => {
  144 |   await page.goto(origin);
  145 | 
  146 |   await page.getByTestId("create-conversation").click();
> 147 |   await expect(page.getByTestId("error")).toHaveText("reference sign-in required");
      |                                           ^ Error: expect(locator).toHaveText(expected) failed
  148 | 
  149 |   await page.getByTestId("tenant-id").fill("tenant-a");
  150 |   await page.getByTestId("user-id").fill("user-a");
  151 |   await page.getByTestId("sign-in").click();
  152 |   await expect(page.locator("[data-context='identity']")).toHaveText("tenant=tenant-a;user=user-a");
  153 | 
  154 |   await page.getByTestId("create-conversation").click();
  155 |   await expect(page.locator("[data-context='conversation']")).toHaveText("conversation-1");
  156 | 
  157 |   await page.getByTestId("message-input").fill("hello atlantis");
  158 |   await page.getByTestId("send-message").click();
  159 |   await expect(page.locator("[data-context='messages']")).toHaveText(
  160 |     "user:hello atlantis|assistant:mock:hello atlantis",
  161 |   );
  162 | 
  163 |   await page.getByTestId("request-tool").click();
  164 |   await expect(page.locator("[data-context='pending-approval']")).toContainText("approval-");
  165 | 
  166 |   await page.getByTestId("execute-tool").click();
  167 |   await expect(page.getByTestId("error")).toContainText("Approval approval-");
  168 | 
  169 |   await page.getByTestId("approve-tool").click();
  170 |   await expect(page.getByTestId("result")).toHaveText("tool:echo-status:ok");
  171 |   await expect(page.getByTestId("audit-types")).toContainText("conversation.tool.approved");
  172 | 
  173 |   await page.getByTestId("delete-conversation").click();
  174 |   await expect(page.locator("[data-context='conversation']")).toHaveText("none");
  175 | });
  176 | 
  177 | test("fails closed for cross-tenant access in the browser and preserves redacted owner audit", async ({ page }) => {
  178 |   await page.goto(origin);
  179 | 
  180 |   await page.getByTestId("tenant-id").fill("tenant-a");
  181 |   await page.getByTestId("user-id").fill("user-a");
  182 |   await page.getByTestId("sign-in").click();
  183 |   await page.getByTestId("create-conversation").click();
  184 |   await page.getByTestId("message-input").fill("delete me");
  185 |   await page.getByTestId("send-message").click();
  186 |   await page.getByTestId("delete-conversation").click();
  187 | 
  188 |   await page.getByTestId("open-conversation-id").fill("conversation-1");
  189 |   await page.getByTestId("open-conversation").click();
  190 |   await expect(page.getByTestId("audit-message-contents")).toHaveText("[deleted]|[deleted]");
  191 |   await expect(page.locator("[data-context='conversation']")).toHaveText("none");
  192 | 
  193 |   await page.getByTestId("tenant-id").fill("tenant-b");
  194 |   await page.getByTestId("user-id").fill("user-b");
  195 |   await page.getByTestId("sign-in").click();
  196 |   await page.getByTestId("open-conversation-id").fill("conversation-1");
  197 |   await page.getByTestId("open-conversation").click();
  198 |   await page.getByTestId("request-tool").click();
  199 |   await expect(page.getByTestId("error")).toHaveText(
  200 |     "conversation access denied for tenant/user context",
  201 |   );
  202 | });
  203 | 
```