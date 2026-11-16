const CAIRO = "Africa/Cairo";
const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: CAIRO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function dateParts(date) {
  return Object.fromEntries(dateTimeFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
}

function monotonicNow() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}

let serverClockEpoch = Date.now();
let serverClockMonotonic = monotonicNow();
let countdownInterval = null;

function setServerClock(serverNowValue) {
  const parsed = serverNowValue ? Date.parse(serverNowValue) : Date.now();
  if (!Number.isFinite(parsed)) return false;
  serverClockEpoch = parsed;
  serverClockMonotonic = monotonicNow();
  return true;
}

function currentServerEpoch() {
  return serverClockEpoch + (monotonicNow() - serverClockMonotonic);
}

export function cairoDate(date = new Date()) {
  const parts = dateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isDateOnly(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ""));
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function addDays(dateString, days) {
  if (!isDateOnly(dateString)) return "";
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function cairoMidnightUtc(dateString) {
  if (!isDateOnly(dateString)) return null;
  const [year, month, day] = dateString.split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const local = dateParts(new Date(utcGuess));
  const localAsUtc = Date.UTC(
    Number(local.year), Number(local.month) - 1, Number(local.day),
    Number(local.hour), Number(local.minute), Number(local.second),
  );
  return utcGuess - (localAsUtc - utcGuess);
}

/** The date-only end is inclusive; expiry is the next Cairo midnight. */
export function promotionExpiryUtc(endDate) {
  const nextDate = addDays(endDate, 1);
  return nextDate ? cairoMidnightUtc(nextDate) : null;
}

export function formatRemainingDuration(remainingMs) {
  if (!Number.isFinite(remainingMs)) return "";
  if (remainingMs <= 0) return "00d : 00h : 00m";

  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const twoDigits = (value) => String(value).padStart(2, "0");
  return `${twoDigits(days)}d : ${twoDigits(hours)}h : ${twoDigits(minutes)}m`;
}

export function startPromotionCountdowns(root, serverNowValue) {
  if (typeof window === "undefined" || !root?.querySelectorAll) return;
  setServerClock(serverNowValue);
  if (countdownInterval !== null) window.clearInterval(countdownInterval);

  const timers = [...root.querySelectorAll("[data-promotion-countdown]")];
  countdownInterval = null;
  if (!timers.length) return;

  const update = () => {
    const now = currentServerEpoch();
    for (const timer of timers) {
      const endDate = timer.getAttribute("data-discount-end") || "";
      const expiresAt = promotionExpiryUtc(endDate);
      if (expiresAt === null) {
        timer.hidden = true;
        timer.textContent = "";
        continue;
      }
      timer.textContent = formatRemainingDuration(expiresAt - now);
    }
  };

  update();
  countdownInterval = window.setInterval(update, 15_000);
}

export function schedulePromotionRefresh(products, serverNowValue) {
  if (typeof window === "undefined" || !Array.isArray(products)) return;
  if (!setServerClock(serverNowValue)) return;
  const serverNow = currentServerEpoch();
  const today = cairoDate(new Date(serverNow));
  let nextDate = "";

  for (const product of products) {
    const start = String(product?.discountStartOn || "");
    const end = String(product?.discountEndOn || "");
    if (!(Number(product?.discountPercent) > 0) || !start || !end || end < today) continue;

    const boundary = start > today ? start : addDays(end, 1);
    if (!boundary) continue;
    if (!nextDate || boundary < nextDate) nextDate = boundary;
  }

  if (!nextDate) return;
  const expiry = cairoMidnightUtc(nextDate);
  if (expiry === null) return;
  const delay = expiry - currentServerEpoch() + 1200;
  window.setTimeout(() => window.location.reload(), Math.min(2_147_000_000, Math.max(1_000, delay)));
}
