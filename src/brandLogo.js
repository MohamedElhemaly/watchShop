// Sodfa (صُدْفَة) - Unified Circular Brand Logo Component (2026)
// Enforces a strict circular watch-dial silhouette across all views:
// - Aspect-ratio 1:1, rounded-full, overflow-hidden, shrink-0
// - Deep emerald background (#0E2924)
// - Warm bronze/gold outer ring (border-[#B07D56]/60 with subtle glow ring)
// - Clean centered scaling with zero square corners

const BaseElement = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

export class BrandLogo extends BaseElement {
  connectedCallback() {
    const size = this.getAttribute("size") || "md";
    const alt = this.getAttribute("alt") || "شعار صُدْفَة";
    const customClass = this.getAttribute("class") || "";

    this.innerHTML = `
      <span class="brand-logo-circle size-${size} ${customClass}" role="img" aria-label="${alt}">
        <img class="brand-logo-img" src="/sodfa-icon-v3.png" alt="${alt}" loading="eager" decoding="async" />
      </span>
    `;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("brand-logo")) {
  customElements.define("brand-logo", BrandLogo);
}

/**
 * Functional template string renderer for dynamic JS / modal rendering
 */
export function renderBrandLogo({ size = "md", alt = "شعار صُدْفَة", className = "" } = {}) {
  return `
    <span class="brand-logo-circle size-${size} ${className}" role="img" aria-label="${alt}">
      <img class="brand-logo-img" src="/sodfa-icon-v3.png" alt="${alt}" loading="eager" decoding="async" />
    </span>
  `;
}
