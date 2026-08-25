import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  getDirection,
  normalizeLocale,
  translate
} from "../lib/i18n.js";

test("localization supports Arabic and English through centralized dictionaries", () => {
  assert.equal(DEFAULT_LOCALE, "ar");
  assert.equal(normalizeLocale("en"), "en");
  assert.equal(normalizeLocale("unknown"), "ar");
  assert.equal(getDirection("ar"), "rtl");
  assert.equal(getDirection("en"), "ltr");
  assert.equal(translate("ar", "navigation.analytics"), "التحليلات");
  assert.equal(translate("en", "navigation.analytics"), "Analytics");
});

test("language provider persists locale and updates the document direction", async () => {
  const source = await readFile(
    new URL("../app/context/LanguageContext.jsx", import.meta.url),
    "utf8"
  );
  assert.equal(LOCALE_STORAGE_KEY, "metricsflo_locale");
  assert.match(source, /window\.localStorage\.getItem\(LOCALE_STORAGE_KEY\)/);
  assert.match(source, /document\.documentElement\.dir = direction/);
  assert.match(source, /document\.documentElement\.lang = locale/);
});

test("shared application shell follows the selected global direction", async () => {
  const [layout, shell, sidebar] = await Promise.all([
    readFile(new URL("../app/layout.jsx", import.meta.url), "utf8"),
    readFile(new URL("../components/layout/AppShell.jsx", import.meta.url), "utf8"),
    readFile(new URL("../components/layout/Sidebar.jsx", import.meta.url), "utf8")
  ]);
  assert.match(layout, /<LanguageProvider>/);
  assert.match(shell, /dir=\{direction\}/);
  assert.match(sidebar, /<LanguageSwitcher \/>/);
  assert.doesNotMatch(sidebar, /label:\s*"Intelligence Engine"/);
});
