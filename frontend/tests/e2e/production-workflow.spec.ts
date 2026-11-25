import { randomUUID } from "node:crypto";
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
const api = "http://127.0.0.1:4100";
test.setTimeout(120000);
test.use({ actionTimeout: 15000 });
async function login(page: Page, request: APIRequestContext) {
  const email = `${randomUUID()}@fixture.example`;
  await request.post(`${api}/__test__/admin`, {
    data: { email, scenario: "workflow-production" },
  });
  await page.goto("/admin/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page
    .getByRole("button", { name: "Continue to authenticator", exact: true })
    .click();
  await page.getByLabel("Authenticator code", { exact: true }).fill("123456");
  await page
    .getByRole("button", { name: "Verify and sign in", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "RFQ operations", exact: true }),
  ).toBeVisible();
  return email;
}
async function nextAction(page: Page, label: string) {
  await page.getByRole("button", { name: "Action", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: label, exact: true })
    .click();
}
test("production quotation workspace, private buyer negotiation and fulfilment work through the browser", async ({
  page,
  request,
  context,
}, info) => {
  const email = await login(page, request);
  await page.goto("/admin/quotations");
  await expect(
    page.getByRole("heading", { name: "All Quotations", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Active quotations", exact: true }),
  ).toContainText("RFQ-WORKFLOW-001");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`worklist-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.getByLabel("Search buyer or RFQ").fill("RFQ-WORKFLOW");
  await page.getByLabel("Country", { exact: true }).selectOption("CN");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.getByRole("button", { name: "Refresh worklist" }).click();
  await expect(page.getByLabel("Search buyer or RFQ")).toHaveValue(
    "RFQ-WORKFLOW",
  );
  await expect(page.getByLabel("Country", { exact: true })).toHaveValue("CN");
  await page
    .getByRole("region", { name: "Active quotations", exact: true })
    .getByRole("link", { name: "Review", exact: true })
    .click();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Availability", { exact: true })
    .selectOption("AVAILABLE");
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "Save review", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await nextAction(page, "Create quotation");
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Selling price per pack (USD)", { exact: true })
    .fill("125");
  await dialog
    .getByLabel("Approx. weight per pack (g)", { exact: true })
    .fill("100");
  await dialog.getByLabel("Delivery charge (USD)", { exact: true }).fill("25");
  await dialog
    .getByLabel("Estimated packed shipment weight (g, optional)", {
      exact: true,
    })
    .fill("250");
  await dialog
    .getByRole("button", { name: "Save draft & preview", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", {
      name: "Customer-facing preview",
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog).toContainText("275.00");
  for (const checkbox of await dialog.getByRole("checkbox").all())
    await checkbox.check();
  await dialog
    .getByRole("button", { name: "Send quotation to customer", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("rfq-workspace-desktop.png"),
    fullPage: true,
  });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Manage private link", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`rfq-workspace-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  const state = await (
    await request.get(
      `${api}/__test__/admin?${new URLSearchParams({ email, action: "workflow" })}`,
    )
  ).json();
  const buyer = await context.newPage();
  await buyer.goto(`/r/${state.data.token}`);
  await expect(
    buyer.getByRole("heading", { name: "Quotation v1", exact: true }),
  ).toBeVisible();
  await buyer
    .getByRole("button", { name: "Request a better offer", exact: true })
    .click();
  dialog = buyer.getByRole("dialog");
  await dialog.getByRole("combobox").selectOption("DELIVERY");
  await dialog
    .getByLabel("Proposed delivery charge (USD, optional)")
    .fill("10");
  await dialog
    .getByLabel("Your message")
    .fill("Please lower delivery to USD 10.");
  await dialog
    .getByRole("button", { name: "Send request", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    buyer.getByRole("button", { name: "Approve quotation", exact: true }),
  ).toHaveCount(0);
  await expect(
    buyer.getByRole("button", { name: "Decline quotation", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Customer requested a change",
      exact: true,
    }),
  ).toBeVisible();
  await nextAction(page, "Respond to request");
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Delivery charge (USD)", { exact: true }).fill("15");
  await dialog
    .getByLabel("Reply to customer")
    .fill("We can offer USD 15 delivery.");
  await dialog
    .getByRole("button", { name: "Preview response", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Send response to customer", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await buyer
    .getByRole("button", { name: "Refresh status", exact: true })
    .click();
  await expect(
    buyer.getByRole("heading", { name: "Quotation v2", exact: true }),
  ).toBeVisible();
  await expect(buyer).toHaveURL(/\/r\/[a-f0-9]{64}$/);
  await buyer
    .getByRole("button", { name: "Approve quotation", exact: true })
    .click();
  await buyer.getByRole("dialog").getByRole("checkbox").check();
  await buyer
    .getByRole("button", { name: "Confirm approval", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Customer reviewed and approved",
      exact: true,
    }),
  ).toBeVisible();
  await nextAction(page, "Request payment");
  dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "Send payment request", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await nextAction(page, "Mark as paid");
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Bank transaction / wire reference")
    .fill("BROWSER-TT-01");
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "Record confirmed payment", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await nextAction(page, "Add delivery details");
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Courier name").fill("Sample Courier");
  await dialog.getByLabel("AWB / tracking number").fill("BROWSER-AWB-01");
  await dialog
    .getByRole("button", {
      name: "Save details & mark dispatched",
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
  await nextAction(page, "Complete delivery");
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Delivery evidence / courier proof of delivery reference")
    .fill("Courier POD BROWSER-001");
  await dialog
    .getByRole("button", { name: "Mark as completed", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("link", { name: "All Quotations", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("region", { name: "Closed history", exact: true }),
  ).toContainText("RFQ-WORKFLOW-001");
  await expect(
    page.getByRole("region", { name: "Active quotations", exact: true }),
  ).not.toContainText("RFQ-WORKFLOW-001");
  await buyer
    .getByRole("button", { name: "Refresh status", exact: true })
    .click();
  await expect(
    buyer.getByRole("heading", { name: "Completed", exact: true }),
  ).toBeVisible();
  await expect(
    buyer.getByText("BROWSER-AWB-01", { exact: true }),
  ).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await buyer.setViewportSize({ width, height: 950 });
    expect(
      await buyer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await buyer.screenshot({
      path: info.outputPath(`private-quotation-${width}.png`),
      fullPage: true,
    });
  }
  expect(await buyer.content()).not.toMatch(
    /NEVER_RENDER|procurement|internal_cost|private document/i,
  );
  await buyer.close();
});

test("the private link shows the RFQ before an offer exists and never authorizes the RFQ number alone", async ({
  page,
  request,
  context,
}) => {
  const email = await login(page, request);
  const state = await (
    await request.get(
      `${api}/__test__/admin?${new URLSearchParams({ email, action: "workflow" })}`,
    )
  ).json();
  const buyer = await context.newPage();
  await buyer.goto(`/r/${state.data.token}`);
  await expect(
    buyer.getByRole("heading", { name: "Request received", exact: true }),
  ).toBeVisible();
  await expect(
    buyer.getByRole("button", { name: "Approve quotation", exact: true }),
  ).toHaveCount(0);
  await expect(buyer.locator('script[src*="plausible"]')).toHaveCount(0);
  expect(
    (await buyer.request.get(`/r/${state.data.token}`)).headers()[
      "cache-control"
    ],
  ).toContain("no-store");
  await buyer.goto("/r/RFQ-WORKFLOW-001");
  await expect(
    buyer.getByRole("heading", { name: "Request received", exact: true }),
  ).toHaveCount(0);
  await buyer.close();
});
