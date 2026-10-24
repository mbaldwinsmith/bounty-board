"use strict";

// Optional developer tooling only. The application itself has no dependencies.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const server = http.createServer(async (request, response) => {
  const name = new URL(request.url, "http://localhost").pathname;
  const allowed = {
    "/": ["index.html", "text/html"],
    "/app.js": ["app.js", "text/javascript"],
    "/styles.css": ["styles.css", "text/css"],
    "/favicon.svg": ["favicon.svg", "image/svg+xml"],
  };
  if (!allowed[name]) {
    response.writeHead(404).end();
    return;
  }
  const [file, type] = allowed[name];
  response.writeHead(200, { "Content-Type": type });
  response.end(await fs.readFile(path.join(root, file)));
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => requests.push(request.url()));
    await page.goto(origin);
    assert.equal(await page.locator("#empty-state").isVisible(), true);

    // Real UI creation, whitespace validation, XP preview, and safe user text.
    await page.locator("#new-bounty").click();
    await page.locator("#title").fill("   ");
    await page.locator("#save-bounty").click();
    assert.equal(await page.locator("#bounty-dialog").isVisible(), true);
    const title = "<img src=x onerror=alert(1)> The paperwork dragon";
    await page.locator("#title").fill(title);
    await page
      .locator("#description")
      .fill("Submit one application.\nKeep the confirmation.");
    await page.locator("#difficulty").selectOption("epic");
    await page.locator("#urgency").selectOption("urgent");
    await page.locator("#due").fill("2020-01-01");
    await page.locator("#reward").fill("Coffee and cake");
    assert.equal(await page.locator("#xp-preview").textContent(), "210 XP");
    await page.locator("#save-bounty").click();
    assert.equal(await page.locator(".task-title").textContent(), title);
    assert.equal(await page.locator("#task-list img").count(), 0);
    assert.match(await page.locator(".task-date").textContent(), /Overdue/);
    assert.equal(await page.locator(".task-xp").textContent(), "✦ 210 XP");
    await page.locator('[data-action="accept"]').click();
    await page.locator('[data-view="active"]').click();
    assert.equal(await page.locator(".bounty-card").count(), 1);

    // Edit an accepted task without losing its status, and return it to board.
    await page.locator('[data-action="edit"]').click();
    await page.locator("#difficulty").selectOption("hard");
    await page.locator("#save-bounty").click();
    assert.equal(await page.locator(".task-xp").textContent(), "✦ 110 XP");
    await page.locator('[data-action="return"]').click();
    assert.equal(await page.locator(".bounty-card").count(), 0);
    await page.locator('[data-view="board"]').click();
    await page.locator('[data-action="delete"]').click();
    await page.locator("#confirm-action").click();
    assert.equal(await page.locator(".bounty-card").count(), 0);
    await page.locator("#undo-button").click();
    assert.equal(await page.locator(".bounty-card").count(), 1);

    // Completion creates a journal record and awards XP once, including undo.
    await page.locator('[data-action="accept"]').click();
    await page.locator('[data-view="active"]').click();
    await page.locator('[data-action="claim"]').click();
    await page
      .locator("#reflection")
      .fill("Starting was harder than finishing.");
    await page.locator('#claim-form button[type="submit"]').click();
    assert.equal(await page.locator("#xp-stat").textContent(), "110");
    assert.match(
      await page.locator(".task-reflection").textContent(),
      /Starting was harder/,
    );
    await page.locator("#undo-button").click();
    assert.equal(await page.locator("#xp-stat").textContent(), "0");
    await page.locator('[data-action="claim"]').click();
    await page.locator("#reflection").fill("A fine adventure.");
    await page.locator('#claim-form button[type="submit"]').click();
    await page.reload();
    assert.equal(await page.locator("#xp-stat").textContent(), "110");
    await page.locator('[data-view="journal"]').click();
    await page.locator("#search").fill("fine adventure");
    assert.equal(await page.locator(".bounty-card").count(), 1);
    await page.locator("#search").fill("not-found");
    assert.equal(await page.locator("#empty-state").isVisible(), true);
    await page.locator("#search").fill("");
    await page.locator('[data-filter="easy"]').click();
    assert.equal(await page.locator(".bounty-card").count(), 0);
    await page.locator('[data-filter="all"]').click();

    // Export and restore, with invalid imports leaving the record untouched.
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export-button").click();
    const download = await downloadPromise;
    const backup = JSON.parse(await fs.readFile(await download.path(), "utf8"));
    assert.equal(backup.tasks.length, 1);
    assert.equal(backup.tasks[0].reflection, "A fine adventure.");
    const before = await page.evaluate(() =>
      localStorage.getItem("bounty-board.v1"),
    );
    await page.locator("#import-file").setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":1,"tasks":[{}]}'),
    });
    await page
      .locator("#toast-text")
      .filter({ hasText: "isn’t a valid" })
      .waitFor();
    assert.equal(
      await page.evaluate(() => localStorage.getItem("bounty-board.v1")),
      before,
    );
    await page.locator("#import-file").setInputFiles({
      name: "valid.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await page.locator("#confirm-action").click();
    assert.equal(await page.locator("#xp-stat").textContent(), "110");
    const peer = await context.newPage();
    await peer.goto(origin);
    await peer.locator("#new-bounty").click();
    await peer.locator("#title").fill("Cross-tab quest");
    await peer.locator("#save-bounty").click();
    await page
      .locator(".task-title")
      .filter({ hasText: "Cross-tab quest" })
      .waitFor();
    await peer.close();

    // Responsive layout, visible backup controls, and reduced-motion rules.
    for (const width of [1440, 900, 760, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `No overflow at ${width}px`,
      );
      assert.equal(await page.locator("#export-button").isVisible(), true);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator(".bounty-card")
        .first()
        .evaluate((element) => getComputedStyle(element).animationName),
      "none",
    );

    // Isolated fresh context tests optional examples, sorting, and level-ups.
    const fresh = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const preview = await fresh.newPage();
    await preview.goto(origin);
    await preview.locator("#load-examples").click();
    assert.equal(await preview.locator(".bounty-card").count(), 3);
    await preview.locator("#sort").selectOption("difficulty");
    assert.match(
      await preview.locator(".task-title").first().textContent(),
      /paperwork/,
    );
    if (process.env.SCREENSHOT_DIR) {
      await fs.mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
      await preview.locator("#toast").waitFor({ state: "hidden" });
      await preview.screenshot({
        path: path.join(process.env.SCREENSHOT_DIR, "bounty-board-desktop.png"),
        fullPage: true,
        animations: "disabled",
      });
      await preview.setViewportSize({ width: 390, height: 844 });
      await preview.screenshot({
        path: path.join(process.env.SCREENSHOT_DIR, "bounty-board-mobile.png"),
        fullPage: true,
        animations: "disabled",
      });
    }
    // Exercise a level boundary via a valid imported completed journal.
    const record = structuredClone(backup.tasks[0]);
    const second = { ...record, id: "second", difficulty: "epic", xp: 210 };
    await preview.locator("#import-file").setInputFiles({
      name: "levels.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({ version: 1, tasks: [record, second] }),
      ),
    });
    await preview.locator("#confirm-action").click();
    assert.equal(await preview.locator("#level").textContent(), "2");
    assert.equal(await preview.locator("#xp-in-level").textContent(), "70");
    await fresh.close();

    // Corrupt saved data must not be silently overwritten.
    const broken = await browser.newContext();
    const recovery = await broken.newPage();
    await recovery.goto(origin);
    await recovery.evaluate(() =>
      localStorage.setItem("bounty-board.v1", "{broken"),
    );
    await recovery.reload();
    assert.equal(await recovery.locator("#storage-warning").isVisible(), true);
    await recovery.locator("#load-examples").click();
    assert.equal(
      await recovery.evaluate(() => localStorage.getItem("bounty-board.v1")),
      "{broken",
    );
    await broken.close();

    // A storage quota failure must preserve this session and allow backup export.
    const limited = await browser.newContext();
    await limited.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("Storage full", "QuotaExceededError");
      };
    });
    const unsaved = await limited.newPage();
    await unsaved.goto(origin);
    await unsaved.locator("#load-examples").click();
    assert.equal(await unsaved.locator(".bounty-card").count(), 3);
    assert.equal(await unsaved.locator("#storage-warning").isVisible(), true);
    const rescuePromise = unsaved.waitForEvent("download");
    await unsaved.locator("#export-button").click();
    const rescue = await rescuePromise;
    assert.equal(
      JSON.parse(await fs.readFile(await rescue.path(), "utf8")).tasks.length,
      3,
    );
    await limited.close();
    assert.deepEqual(errors, []);
    assert.equal(
      requests.every((url) => url.startsWith(origin)),
      true,
      "No external network requests",
    );
    await context.close();
    console.log(
      "PASS: create, validate, edit, accept, return, remove/undo, complete/undo, XP, journal, persistence, search/filter/sort, export/import, tab sync, responsive widths, reduced motion, recovery, no script injection or external requests.",
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
