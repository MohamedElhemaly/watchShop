import test from "node:test";
import assert from "node:assert/strict";

const {
  formatWhatsAppPhone,
  isValidWhatsAppPhone,
  buildWhatsAppUrl,
} = await import("../src/data.js");

test("formatWhatsAppPhone handles all common Egyptian phone input variations", () => {
  // 1. Starts with 0020
  assert.equal(formatWhatsAppPhone("00201012345678"), "201012345678");

  // 2. Starts with 2001 (accidental 0 after country code 20)
  assert.equal(formatWhatsAppPhone("2001012345678"), "201012345678");
  assert.equal(formatWhatsAppPhone("+20 011 1234 5678"), "201112345678");

  // 3. Starts with 01 and has 11 digits
  assert.equal(formatWhatsAppPhone("01012345678"), "201012345678");
  assert.equal(formatWhatsAppPhone("01123456789"), "201123456789");
  assert.equal(formatWhatsAppPhone("01234567890"), "201234567890");
  assert.equal(formatWhatsAppPhone("01545678901"), "201545678901");
  assert.equal(formatWhatsAppPhone("010 1234 5678"), "201012345678");
  assert.equal(formatWhatsAppPhone("(010) 1234-5678"), "201012345678");

  // 4. Starts with 10, 11, 12, or 15 and has 10 digits (without leading zero)
  assert.equal(formatWhatsAppPhone("1012345678"), "201012345678");
  assert.equal(formatWhatsAppPhone("1123456789"), "201123456789");
  assert.equal(formatWhatsAppPhone("1234567890"), "201234567890");
  assert.equal(formatWhatsAppPhone("1545678901"), "201545678901");

  // 5. Already pure international E.164 with +20
  assert.equal(formatWhatsAppPhone("+201012345678"), "201012345678");
  assert.equal(formatWhatsAppPhone("+20 10 1234 5678"), "201012345678");

  // 6. Arabic-Indic digits
  assert.equal(formatWhatsAppPhone("٠١٠١٢٣٤٥٦٧٨"), "201012345678");
  assert.equal(formatWhatsAppPhone("+٢٠١٠١٢٣٤٥٦٧٨"), "201012345678");

  // 7. International numbers outside Egypt
  assert.equal(formatWhatsAppPhone("+971 50 123 4567"), "971501234567");
  assert.equal(formatWhatsAppPhone("00966501234567"), "966501234567");
  assert.equal(formatWhatsAppPhone("+1 (202) 555-0123"), "12025550123");

  // 8. Falsy / empty input
  assert.equal(formatWhatsAppPhone(""), "");
  assert.equal(formatWhatsAppPhone(null), "");
  assert.equal(formatWhatsAppPhone(undefined), "");
});

test("isValidWhatsAppPhone strictly validates mobile phone numbers", () => {
  // Valid Egyptian mobiles
  assert.equal(isValidWhatsAppPhone("01012345678"), true);
  assert.equal(isValidWhatsAppPhone("01112345678"), true);
  assert.equal(isValidWhatsAppPhone("01212345678"), true);
  assert.equal(isValidWhatsAppPhone("01512345678"), true);
  assert.equal(isValidWhatsAppPhone("+201012345678"), true);
  assert.equal(isValidWhatsAppPhone("2001012345678"), true);
  assert.equal(isValidWhatsAppPhone("٠١٠١٢٣٤٥٦٧٨"), true);

  // Valid International
  assert.equal(isValidWhatsAppPhone("+971501234567"), true);
  assert.equal(isValidWhatsAppPhone("+966501234567"), true);

  // Invalid cases
  assert.equal(isValidWhatsAppPhone(""), false);
  assert.equal(isValidWhatsAppPhone("010"), false);
  assert.equal(isValidWhatsAppPhone("12345"), false);
  assert.equal(isValidWhatsAppPhone("abcdef"), false);
  // Fake / dummy placeholder numbers must strictly be rejected
  assert.equal(isValidWhatsAppPhone("+201000000000"), false);
  assert.equal(isValidWhatsAppPhone("201000000000"), false);
  assert.equal(isValidWhatsAppPhone("01000000000"), false);
  // Egyptian landlines or invalid mobile prefixes (e.g. 02 القاهرة)
  assert.equal(isValidWhatsAppPhone("0233445566"), false);
  assert.equal(isValidWhatsAppPhone("01312345678"), false); // 013 is Qalyubia landline, not mobile
});

test("buildWhatsAppUrl constructs direct cross-platform deep link without Invite screen", () => {
  const url = buildWhatsAppUrl("01012345678", "مرحبًا صُدْفَة، أريد تأكيد طلبي");
  assert.ok(url.startsWith("https://api.whatsapp.com/send?phone=201012345678"));
  assert.ok(url.includes("&text="));
  assert.ok(url.includes(encodeURIComponent("مرحبًا صُدْفَة، أريد تأكيد طلبي")));

  // Preserves multi-line order confirmation formatting
  const multiline = "الطلب: #DAF-101\nالساعة: هيريتدج\nالسعر: 2,450 ج.م";
  const orderUrl = buildWhatsAppUrl("+20 010 1234 5678", multiline);
  assert.ok(orderUrl.startsWith("https://api.whatsapp.com/send?phone=201012345678"));
  assert.ok(orderUrl.includes("%0A")); // encoded newline

  // Invalid phone & fake dummy placeholder return empty string
  assert.equal(buildWhatsAppUrl(""), "");
  assert.equal(buildWhatsAppUrl("invalid"), "");
  assert.equal(buildWhatsAppUrl("+201000000000", "test"), "");
  assert.equal(buildWhatsAppUrl("201000000000"), "");
});
