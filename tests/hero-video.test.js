import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  uploadToCloudinary,
  processMediaUpload,
} from "../src/mediaStorage.js";

import settingsHandler from "../api/settings.js";
import storeHandler from "../api/store.js";
import { ensureInitialized, getDb, signAdminToken } from "../api/_db.js";

// Helper mock request/response for serverless endpoints
function createMockReqRes({ method = "GET", body = {}, headers = {}, query = {} } = {}) {
  const req = {
    method,
    body,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    query,
  };

  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };

  return { req, res };
}

test("Hero Video & Cloudinary Suite - Video Upload requires Cloudinary & reports missing credentials", async () => {
  const dummyVideoBlob = new Blob(["test-video-binary-content"], { type: "video/mp4" });
  dummyVideoBlob.name = "promo-test.mp4";

  // When no Cloudinary settings are provided, video upload MUST reject with clear Arabic error
  await assert.rejects(
    async () => {
      await processMediaUpload(dummyVideoBlob, {
        cloudName: "",
        uploadPreset: "",
      });
    },
    (err) => {
      assert.ok(err instanceof Error, "Should throw an Error");
      assert.ok(
        err.message.includes("Cloudinary") || err.message.includes("السحابي"),
        `Error should mention Cloudinary or cloud storage: got ${err.message}`
      );
      return true;
    }
  );
});

test("Hero Video & Cloudinary Suite - uploadToCloudinary XHR progress tracking & success", async () => {
  const dummyFile = new Blob(["video-bytes-chunk"], { type: "video/mp4" });
  dummyFile.name = "sample-hero.mp4";

  const progressEvents = [];

  // Mock global XMLHttpRequest
  const originalXHR = globalThis.XMLHttpRequest;

  class MockXHR {
    constructor() {
      this.upload = {};
      this.status = 200;
      this.responseText = "";
    }

    open(method, url) {
      this.method = method;
      this.url = url;
      assert.equal(method, "POST");
      assert.ok(url.includes("/video/upload"), "Video uploads must target /video/upload endpoint");
      assert.ok(url.includes("test-cloud"), "URL must include cloud name");
    }

    setRequestHeader() {}

    send(formData) {
      assert.ok(formData instanceof FormData, "Must send FormData");
      assert.equal(formData.get("upload_preset"), "test-preset");

      // Simulate upload progress events
      if (typeof this.upload.onprogress === "function") {
        this.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 });
        this.upload.onprogress({ lengthComputable: true, loaded: 100, total: 100 });
      }

      // Simulate successful Cloudinary JSON response
      this.status = 200;
      this.responseText = JSON.stringify({
        secure_url: "https://res.cloudinary.com/test-cloud/video/upload/v12345/sample-hero.mp4",
        public_id: "sample-hero",
      });

      if (this.onload) this.onload();
    }
  }

  globalThis.XMLHttpRequest = MockXHR;

  try {
    const resultUrl = await uploadToCloudinary(
      dummyFile,
      "test-cloud",
      "test-preset",
      (info) => progressEvents.push(typeof info === "object" ? info.percent : info)
    );

    assert.equal(resultUrl, "https://res.cloudinary.com/test-cloud/video/upload/v12345/sample-hero.mp4");
    assert.deepEqual(progressEvents, [50, 99, 100], "Should emit exact upload progress percentages");
  } finally {
    globalThis.XMLHttpRequest = originalXHR;
  }
});

test("Hero Video & Cloudinary Suite - uploadToCloudinary surfaces Cloudinary error messages", async () => {
  const dummyFile = new Blob(["video-content"], { type: "video/mp4" });
  dummyFile.name = "error-test.mp4";

  const originalXHR = globalThis.XMLHttpRequest;

  class MockErrorXHR {
    constructor() {
      this.upload = { addEventListener: () => {} };
      this.status = 400;
      this.responseText = JSON.stringify({
        error: { message: "Upload preset 'test-preset' does not allow video uploads" },
      });
    }

    open() {}
    send() {
      if (this.onload) this.onload();
    }
  }

  globalThis.XMLHttpRequest = MockErrorXHR;

  try {
    await assert.rejects(
      async () => {
        await uploadToCloudinary(dummyFile, "test-cloud", "test-preset");
      },
      (err) => {
        assert.ok(
          err.message.includes("Upload preset 'test-preset' does not allow video uploads") ||
          err.message.includes("فشل الرفع إلى Cloudinary"),
          `Expected Cloudinary error message in exception: got ${err.message}`
        );
        return true;
      }
    );
  } finally {
    globalThis.XMLHttpRequest = originalXHR;
  }
});

test("Hero Video & Turso Suite - /api/settings stores heroVideoUrl & /api/store exposes it", async () => {
  await ensureInitialized();

  // 1. Log in or create token for admin
  const token = signAdminToken({
    userId: "usr_super_admin",
    username: "admin",
    role: "super_admin",
    fullName: "المدير العام",
  });

  // 2. PUT /api/settings with heroVideoUrl & heroPosterUrl
  const newHeroVideo = "https://res.cloudinary.com/sodfa-watches/video/upload/v1700000000/sodfa-flagship.mp4";
  const newHeroPoster = "https://res.cloudinary.com/sodfa-watches/image/upload/v1700000000/sodfa-poster.webp";

  const { req: putReq, res: putRes } = createMockReqRes({
    method: "PUT",
    headers: { authorization: `Bearer ${token}` },
    body: {
      settings: {
        heroVideoUrl: newHeroVideo,
        heroPosterUrl: newHeroPoster,
        heroHeadline: "الجمال يكمن في اللحظة",
      },
    },
  });

  await settingsHandler(putReq, putRes);
  assert.equal(putRes.statusCode, 200, "PUT /api/settings must return 200");
  assert.equal(putRes.body.ok, true);
  assert.equal(putRes.body.settings.heroVideoUrl, newHeroVideo);
  assert.equal(putRes.body.settings.heroPosterUrl, newHeroPoster);

  // 3. GET /api/store public endpoint must return heroSettings with Cache-Control: no-store
  const { req: storeReq, res: storeRes } = createMockReqRes({ method: "GET" });
  await storeHandler(storeReq, storeRes);

  assert.equal(storeRes.statusCode, 200, "GET /api/store must return 200");
  assert.equal(storeRes.body.ok, true);
  assert.ok(
    storeRes.headers["Cache-Control"]?.includes("no-store"),
    "Must enforce Cache-Control: no-store"
  );
  assert.equal(storeRes.body.heroSettings.videoUrl, newHeroVideo);
  assert.equal(storeRes.body.heroSettings.heroVideoUrl, newHeroVideo);
  assert.equal(storeRes.body.heroSettings.posterUrl, newHeroPoster);
  assert.equal(storeRes.body.heroSettings.headline, "الجمال يكمن في اللحظة");
});

test("Storefront HTML Structure - index.html has #hero-video-player with mobile autoplay attributes", () => {
  const htmlPath = path.resolve(process.cwd(), "index.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  assert.ok(html.includes('id="hero-video-player"'), "index.html must include #hero-video-player");
  assert.ok(html.includes('id="hero-video-source"'), "index.html must include #hero-video-source");
  assert.ok(html.includes("autoplay"), "Video must have autoplay attribute");
  assert.ok(html.includes("muted"), "Video must have muted attribute for mobile policy");
  assert.ok(html.includes("playsinline"), "Video must have playsinline attribute for iOS");
  assert.ok(html.includes("loop"), "Video must have loop attribute");
});
