export const EGYPT_TIME_ZONE = "Africa/Cairo";

const cairoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: EGYPT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function cairoDateString(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError("A valid date is required.");
  }
  const parts = Object.fromEntries(cairoDateFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isValidDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() + 1 === month
    && candidate.getUTCDate() === day;
}

function dateOnly(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value || "").slice(0, 10);
}

export function isDiscountActive(product, now = new Date()) {
  const discountPercent = Number(product?.discountPercent ?? product?.discount_percent ?? 0);
  if (!Number.isInteger(discountPercent) || discountPercent <= 0 || discountPercent > 99) return false;

  const start = dateOnly(product?.discountStartOn ?? product?.discount_start_on);
  const end = dateOnly(product?.discountEndOn ?? product?.discount_end_on);

  // Preserve existing discounts that predate the schedule fields.
  if (!start && !end) return true;
  if (!isValidDateOnly(start) || !isValidDateOnly(end) || start > end) return false;

  const today = cairoDateString(now);
  return start <= today && today <= end;
}
