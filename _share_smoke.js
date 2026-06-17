const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  // Try register then login
  console.log("=== Auth ===");
  let token, userId;
  const regRes = await page.request.post("http://localhost:3000/api/auth/register", {
    data: { name: "ShareTester", email: "sharetester@test.com", password: "Test1234" }
  });
  let regData = await regRes.json();
  if (regRes.status() === 201 || regRes.status() === 200) {
    token = regData.token;
    userId = regData.user?.id;
  } else {
    const loginRes = await page.request.post("http://localhost:3000/api/auth/login", {
      data: { email: "sharetester@test.com", password: "Test1234" }
    });
    const loginData = await loginRes.json();
    token = loginData.token;
    userId = loginData.user?.id;
    console.log("Login status:", loginRes.status(), "token:", !!token);
  }

  // Register/login target user
  let targetUserId;
  const reg2 = await page.request.post("http://localhost:3000/api/auth/register", {
    data: { name: "ShareTarget", email: "sharetarget@test.com", password: "Test1234" }
  });
  if (reg2.status() === 201 || reg2.status() === 200) {
    targetUserId = (await reg2.json()).user?.id;
  } else {
    const login2 = await page.request.post("http://localhost:3000/api/auth/login", {
      data: { email: "sharetarget@test.com", password: "Test1234" }
    });
    targetUserId = (await login2.json()).user?.id;
  }
  console.log("User token:", !!token, "Target:", targetUserId?.slice(0, 8) || "N/A");

  // Navigate and set auth
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
  await page.evaluate(({ t, u }) => {
    localStorage.setItem("newspaperAuthToken", t);
    localStorage.setItem("newspaperAuthUser", JSON.stringify({ name: "ShareTester", email: "sharetester@test.com", id: u }));
    localStorage.setItem("onboarded_ShareTester", "1");
  }, { t: token, u: userId });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);

  const cards = await page.$$(".article-card");
  console.log("\n=== Article Cards ===");
  console.log("Cards found:", cards.length);

  if (cards.length === 0) {
    const state = await page.evaluate(() => ({
      authHidden: document.getElementById("auth-overlay")?.hidden,
      gridEl: !!document.querySelector("#recommended-grid"),
      gridChildren: document.querySelector("#recommended-grid")?.children?.length || 0,
      stateArticles: (typeof state !== "undefined" && state.data?.articles?.length) || "N/A",
    }));
    console.log("Page state:", JSON.stringify(state, null, 2));

    // Try fetching feed manually
    const feedRes = await page.request.get("http://localhost:3000/api/feed", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const feedData = await feedRes.json();
    console.log("API feed articles:", feedData.articles?.length || feedData.data?.articles?.length || 0);
    console.log("Trying headless=false for visual check...");
    await browser.close();
    return;
  }

  // Share quick buttons
  console.log("\n=== Share Quick Buttons ===");
  const shareQuickBtns = await page.$$(".article-share-quick");
  console.log("Found:", shareQuickBtns.length);
  if (shareQuickBtns.length > 0) {
    const visible = await shareQuickBtns[0].isVisible();
    const box = await shareQuickBtns[0].boundingBox();
    console.log("Visible:", visible, "Box:", box);
  }

  // Card-actions share buttons
  const actionBtns = await page.$$('button[data-action="share"]');
  console.log("Action share buttons:", actionBtns.length);

  // FAB
  const fab = await page.$(".share-fab");
  console.log("FAB visible:", fab ? await fab.isVisible() : false);

  // Click share quick button
  if (shareQuickBtns.length > 0) {
    console.log("\n=== Modal Test ===");
    await shareQuickBtns[0].click({ force: true });
    await page.waitForTimeout(800);
    const modalVisible = await page.evaluate(() => {
      const m = document.getElementById("share-modal");
      return m ? !m.hidden : false;
    });
    console.log("Modal visible:", modalVisible);
  }

  // API share test
  if (token && targetUserId && cards.length > 0) {
    console.log("\n=== API Share Test ===");
    const articleId = await cards[0].getAttribute("data-drag-article-id");
    const shareRes = await page.request.post(`http://localhost:3000/api/articles/${encodeURIComponent(articleId)}/share`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: { articleId, receiverUserId: targetUserId, message: "test" }
    });
    console.log("Share:", shareRes.status(), (await shareRes.json()).success);
  }

  // Draggable
  const draggables = await page.$$('[draggable="true"]');
  console.log("\nDraggable elements:", draggables.length);

  if (consoleErrors.length > 0) {
    console.log("\nConsole errors:");
    consoleErrors.slice(0, 3).forEach(e => console.log(" -", e.slice(0, 120)));
  } else {
    console.log("\nNo console errors.");
  }

  await browser.close();
  console.log("DONE");
})();
