import test from "node:test";
import assert from "node:assert/strict";

import {
  saveMediaBlob,
  getMediaBlob,
  resolveMediaUrl,
  getCachedMediaUrl,
  resolveProductsMedia,
  deleteMediaBlob,
} from "../src/mediaStorage.js";

import { defaultStoreSettings } from "../src/data.js";

test("saveMediaBlob and getMediaBlob persist binary media correctly", async () => {
  const dummyData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG magic bytes
  const blob = new Blob([dummyData], { type: "image/png" });

  const mediaId = await saveMediaBlob(blob, "watch-cover.png", "image/png");

  assert.ok(typeof mediaId === "string", "mediaId must be a string");
  assert.ok(mediaId.startsWith("media://"), "mediaId must start with media:// scheme");
  assert.ok(mediaId.endsWith(".png"), "mediaId must preserve the file extension");

  const record = await getMediaBlob(mediaId);
  assert.ok(record, "record must be retrieved");
  assert.equal(record.id, mediaId);
  assert.equal(record.filename, "watch-cover.png");
  assert.equal(record.mimeType, "image/png");
  assert.equal(record.size, blob.size);
});

test("saveMediaBlob throws error when no blob is supplied", async () => {
  await assert.rejects(
    async () => {
      await saveMediaBlob(null, "invalid.png");
    },
    /No blob provided/
  );
});

test("resolveMediaUrl handles standard URLs and media:// IDs", async () => {
  // Standard URLs must return unchanged
  assert.equal(await resolveMediaUrl("https://example.com/watch.jpg"), "https://example.com/watch.jpg");
  assert.equal(await resolveMediaUrl("/assets/video.mp4"), "/assets/video.mp4");
  assert.equal(await resolveMediaUrl(""), "");
  assert.equal(await resolveMediaUrl(null), "");

  // Stored media URL must resolve to an object URL
  const testBlob = new Blob(["video-content"], { type: "video/mp4" });
  const mediaId = await saveMediaBlob(testBlob, "hero.mp4", "video/mp4");

  const resolved = await resolveMediaUrl(mediaId);
  assert.ok(typeof resolved === "string" && resolved.length > 0, "Resolved URL must not be empty");
  // In Node 18+, URL.createObjectURL creates a blob: URL
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    assert.ok(resolved.startsWith("blob:") || resolved.startsWith("media://"), "Should resolve to blob: or media fallback");
  }

  // Fast synchronous cache retrieval
  const cached = getCachedMediaUrl(mediaId);
  assert.equal(cached, resolved, "getCachedMediaUrl must return cached object URL immediately");
});

test("resolveProductsMedia batch resolves product images and variant swatches", async () => {
  const blob1 = new Blob(["img1"], { type: "image/webp" });
  const blob2 = new Blob(["img2"], { type: "image/webp" });
  const id1 = await saveMediaBlob(blob1, "variant-black.webp", "image/webp");
  const id2 = await saveMediaBlob(blob2, "variant-gold.webp", "image/webp");

  const testProducts = [
    {
      id: "prod-1",
      name: "ساعة كلاسيكية",
      imageUrl: id1,
      images: [
        { imageUrl: id1, colorLabel: "أسود ملكي" },
        { imageUrl: id2, colorLabel: "ذهبي وردي" },
        { imageUrl: "https://example.com/external.jpg", colorLabel: "فضي" },
      ],
    },
    {
      id: "prod-2",
      name: "ساعة رياضية",
      imageUrl: "https://example.com/sport.jpg",
      images: [],
    },
  ];

  const resolvedProducts = await resolveProductsMedia(testProducts);

  assert.equal(resolvedProducts.length, 2);
  assert.notEqual(resolvedProducts[0].imageUrl, id1, "Product cover media:// must be resolved");
  assert.notEqual(resolvedProducts[0].images[0].imageUrl, id1, "Variant 1 media:// must be resolved");
  assert.notEqual(resolvedProducts[0].images[1].imageUrl, id2, "Variant 2 media:// must be resolved");
  assert.equal(
    resolvedProducts[0].images[2].imageUrl,
    "https://example.com/external.jpg",
    "External image URL must be preserved untouched"
  );
  assert.equal(
    resolvedProducts[1].imageUrl,
    "https://example.com/sport.jpg",
    "Product 2 external cover image must remain untouched"
  );
});

test("deleteMediaBlob revokes and removes stored media", async () => {
  const blob = new Blob(["temporary"], { type: "image/jpeg" });
  const mediaId = await saveMediaBlob(blob, "temp.jpg", "image/jpeg");

  assert.ok(await getMediaBlob(mediaId), "Blob must exist before deletion");

  const deleted = await deleteMediaBlob(mediaId);
  assert.equal(deleted, true, "deleteMediaBlob should return true");

  const recordAfter = await getMediaBlob(mediaId);
  assert.equal(recordAfter, null, "Record must be null after deletion");
});

test("defaultStoreSettings contains Cloudinary sync fields for persistent live hosting", () => {
  assert.ok("cloudinaryCloudName" in defaultStoreSettings, "Must define cloudinaryCloudName");
  assert.ok("cloudinaryUploadPreset" in defaultStoreSettings, "Must define cloudinaryUploadPreset");
});
