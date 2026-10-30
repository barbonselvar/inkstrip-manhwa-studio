/** Local QA preload for sandboxes whose egress policy denies grok.com.
 *
 *   NODE_OPTIONS="--import ./scripts/qa-offline-branding.mjs" npm run test:…
 *
 * The deployed page loads the platform's "Created with Grok" pill from
 * https://grok.com/grok-app-builder/extensions.js. Where that host is refused,
 * every browser suite records a failed resource load unrelated to the app.
 * This fulfils only that origin with an empty script inside Playwright test
 * browsers. App code, the served HTML and every other request are unchanged.
 * CI runners reach grok.com and do not use it. */
import { chromium } from "playwright";

const platform = /^https:\/\/grok\.com\//;
const stub = (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
const launch = chromium.launch.bind(chromium);
chromium.launch = async (...args) => {
  const browser = await launch(...args),
    newContext = browser.newContext.bind(browser),
    newPage = browser.newPage.bind(browser);
  browser.newContext = async (...options) => {
    const context = await newContext(...options);
    await context.route(platform, stub);
    return context;
  };
  browser.newPage = async (...options) => {
    const page = await newPage(...options);
    await page.route(platform, stub);
    return page;
  };
  return browser;
};
