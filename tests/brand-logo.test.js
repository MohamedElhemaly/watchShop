import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const { renderBrandLogo } = await import("../src/brandLogo.js");

test("renderBrandLogo outputs circular markup with image and size classes", () => {
  const defaultLogo = renderBrandLogo();
  assert.ok(defaultLogo.includes("brand-logo-circle"), "Must contain brand-logo-circle class");
  assert.ok(defaultLogo.includes("size-md"), "Must default to size-md");
  assert.ok(defaultLogo.includes("/sodfa-icon-v3.png"), "Must reference the brand icon image");
  assert.ok(defaultLogo.includes('role="img"'), "Must have accessible role");

  const smallLogo = renderBrandLogo({ size: "sm", alt: "صُدْفَة فوتر" });
  assert.ok(smallLogo.includes("size-sm"), "Must apply size-sm");
  assert.ok(smallLogo.includes("صُدْفَة فوتر"), "Must apply custom alt");

  const largeLogo = renderBrandLogo({ size: "lg" });
  assert.ok(largeLogo.includes("size-lg"), "Must apply size-lg");
});

test("public/favicon.svg exists and defines circular watch dial with emerald and bronze palette", () => {
  const faviconPath = path.resolve("public/favicon.svg");
  assert.ok(fs.existsSync(faviconPath), "public/favicon.svg must exist");

  const svgContent = fs.readFileSync(faviconPath, "utf8");
  assert.ok(svgContent.includes("<circle"), "Must define circular elements");
  assert.ok(svgContent.includes("#0E2924") || svgContent.includes("#071b17"), "Must use deep emerald dial color");
  assert.ok(svgContent.includes("#B07D56"), "Must use warm bronze accent color");
});

test("src/brandLogo.css strictly enforces circular watch-dial silhouette and zero square corners", () => {
  const cssPath = path.resolve("src/brandLogo.css");
  assert.ok(fs.existsSync(cssPath), "src/brandLogo.css must exist");

  const css = fs.readFileSync(cssPath, "utf8");
  assert.ok(css.includes("border-radius: 9999px"), "Must enforce rounded-full (9999px)");
  assert.ok(css.includes("overflow: hidden"), "Must enforce overflow: hidden to clip square corners");
  assert.ok(css.includes("#0E2924"), "Must enforce deep emerald background");
  assert.ok(css.includes("rgba(176, 125, 86"), "Must enforce warm bronze ring border");
});
