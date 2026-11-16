export function calculateDiscountedPrice(basePrice, discountPercent) {
  const price = Number(basePrice);
  const discount = Number(discountPercent);
  if (!Number.isInteger(price) || price < 0 || !Number.isInteger(discount) || discount < 0 || discount > 99) {
    throw new RangeError("Expected an integer EGP price and a discount between 0 and 99 percent.");
  }
  return discount === 0 ? price : Math.round(price * (100 - discount) / 100);
}

export function formatEgpNumber(value) {
  return new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}
