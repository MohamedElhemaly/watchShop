export function calculateDiscountedPrice(basePrice, discountPercent) {
  const price = Number(basePrice);
  const discount = Number(discountPercent);
  if (!Number.isInteger(price) || price < 0 || !Number.isInteger(discount) || discount < 0 || discount > 99) {
    throw new RangeError("Expected an integer EGP price and a discount between 0 and 99 percent.");
  }
  return discount === 0 ? price : Math.round(price * (100 - discount) / 100);
}

export function calculateFlexibleDiscount(basePrice, discountType = "none", discountValue = 0) {
  const price = Math.round(Number(basePrice)) || 0;
  const val = Math.round(Number(discountValue)) || 0;

  if (price <= 0) return 0;
  if (discountType === "percent" && val > 0) {
    const clamped = Math.min(99, Math.max(0, val));
    return calculateDiscountedPrice(price, clamped);
  }
  if (discountType === "fixed" && val > 0) {
    return Math.max(0, price - val);
  }
  return price;
}

export function formatDiscountLabel(discountType, discountValue) {
  const val = Math.round(Number(discountValue)) || 0;
  if (val <= 0 || discountType === "none") return "";
  if (discountType === "percent") {
    return `خصم ${formatEgpNumber(val)}%`;
  }
  if (discountType === "fixed") {
    return `خصم ${formatEgpNumber(val)} ج.م`;
  }
  return "";
}

export function formatEgpNumber(value) {
  return new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}
