// Public contact numbers and products are loaded from the managed database.
// Do not place real contact details or product records in this browser-side module.
// Sodfa Watch Catalog - Centralized E-Commerce Data Store & Inventory
// Complete preservation of all watch products, categories, variants, and specifications.

export const categories = [
  { id: "all", name: "كل الساعات", slug: "all", icon: "" },
  { id: "men", name: "رجالية", slug: "men", icon: "" },
  { id: "women", name: "نسائية", slug: "women", icon: "" },
  { id: "classic-dress", name: "كلاسيك ورسمية", slug: "classic-dress", icon: "" },
  { id: "sport-chrono", name: "رياضية وكرونوغراف", slug: "sport-chrono", icon: "" },
  { id: "smart-hybrid", name: "ذكية وهجينة", slug: "smart-hybrid", icon: "" },
];

// Helper to generate bespoke, ultra-sharp vector watch illustrations for studio presentation
function createWatchSvg({
  caseColor = "#d4af37", // gold, silver, rose, black
  dialColor = "#0f2027", // deep emerald, obsidian, ivory, navy
  strapColor = "#3d2314", // dark leather, steel, black
  strapType = "leather",  // leather or mesh or steel
  accentColor = "#c27856",
  dialStyle = "chronograph", // chronograph, classic, minimal, diver
  hasSubDials = false,
  dateText = "17",
}) {
  const isSteel = strapType === "steel";
  const isMesh = strapType === "mesh";

  let subDials = "";
  if (hasSubDials || dialStyle === "chronograph") {
    subDials = `
      <!-- Sub Dials -->
      <circle cx="160" cy="200" r="24" fill="none" stroke="${accentColor}" stroke-width="1.2" opacity="0.6"/>
      <circle cx="160" cy="200" r="1.5" fill="${accentColor}"/>
      <line x1="160" y1="200" x2="152" y2="194" stroke="${accentColor}" stroke-width="1.5"/>

      <circle cx="240" cy="200" r="24" fill="none" stroke="${accentColor}" stroke-width="1.2" opacity="0.6"/>
      <circle cx="240" cy="200" r="1.5" fill="${accentColor}"/>
      <line x1="240" y1="200" x2="246" y2="190" stroke="${accentColor}" stroke-width="1.5"/>

      <circle cx="200" cy="235" r="22" fill="none" stroke="${accentColor}" stroke-width="1.2" opacity="0.6"/>
      <circle cx="200" cy="235" r="1.5" fill="${accentColor}"/>
      <line x1="200" y1="235" x2="200" y2="222" stroke="${accentColor}" stroke-width="1.5"/>
    `;
  }

  // Generate hour markers
  let markers = "";
  for (let i = 0; i < 12; i++) {
    const angle = i * 30 * (Math.PI / 180);
    const r1 = 82;
    const r2 = i % 3 === 0 ? 68 : 74;
    const x1 = 200 + r1 * Math.sin(angle);
    const y1 = 200 - r1 * Math.cos(angle);
    const x2 = 200 + r2 * Math.sin(angle);
    const y2 = 200 - r2 * Math.cos(angle);
    const width = i % 3 === 0 ? 3.5 : 1.8;
    markers += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${caseColor}" stroke-width="${width}" stroke-linecap="round"/>`;
  }

  const strapTop = isSteel
    ? `
      <!-- Steel Bracelet Top -->
      <path d="M152 40 L248 40 L242 110 L158 110 Z" fill="${strapColor}" stroke="#333" stroke-width="1"/>
      <line x1="175" y1="40" x2="175" y2="110" stroke="#222" stroke-width="1" opacity="0.4"/>
      <line x1="225" y1="40" x2="225" y2="110" stroke="#222" stroke-width="1" opacity="0.4"/>
      <line x1="154" y1="65" x2="246" y2="65" stroke="#111" stroke-width="1.5" opacity="0.3"/>
      <line x1="156" y1="90" x2="244" y2="90" stroke="#111" stroke-width="1.5" opacity="0.3"/>
    `
    : isMesh
    ? `
      <rect x="160" y="40" width="80" height="70" fill="${strapColor}" opacity="0.95"/>
      <line x1="160" y1="40" x2="240" y2="40" stroke="#555" stroke-width="2"/>
    `
    : `
      <!-- Leather Strap Top -->
      <path d="M158 40 Q200 36 242 40 L240 115 Q200 110 160 115 Z" fill="${strapColor}"/>
      <path d="M164 45 L164 112" stroke="#ffffff" stroke-width="1" stroke-dasharray="3,3" opacity="0.35"/>
      <path d="M236 45 L236 112" stroke="#ffffff" stroke-width="1" stroke-dasharray="3,3" opacity="0.35"/>
    `;

  const strapBottom = isSteel
    ? `
      <!-- Steel Bracelet Bottom -->
      <path d="M158 290 L242 290 L248 360 L152 360 Z" fill="${strapColor}" stroke="#333" stroke-width="1"/>
      <line x1="175" y1="290" x2="175" y2="360" stroke="#222" stroke-width="1" opacity="0.4"/>
      <line x1="225" y1="290" x2="225" y2="360" stroke="#222" stroke-width="1" opacity="0.4"/>
      <line x1="156" y1="310" x2="244" y2="310" stroke="#111" stroke-width="1.5" opacity="0.3"/>
      <line x1="154" y1="335" x2="246" y2="335" stroke="#111" stroke-width="1.5" opacity="0.3"/>
    `
    : isMesh
    ? `
      <rect x="160" y="290" width="80" height="70" fill="${strapColor}" opacity="0.95"/>
      <line x1="160" y1="360" x2="240" y2="360" stroke="#555" stroke-width="2"/>
    `
    : `
      <!-- Leather Strap Bottom -->
      <path d="M160 285 Q200 290 240 285 L242 360 Q200 364 158 360 Z" fill="${strapColor}"/>
      <path d="M164 288 L164 355" stroke="#ffffff" stroke-width="1" stroke-dasharray="3,3" opacity="0.35"/>
      <path d="M236 288 L236 355" stroke="#ffffff" stroke-width="1" stroke-dasharray="3,3" opacity="0.35"/>
    `;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="100%" height="100%">
      <defs>
        <radialGradient id="sunburst_${Math.abs(hashCode(dialColor))}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="${dialColor}" stop-opacity="0.85"/>
          <stop offset="100%" stop-color="#050a0a" stop-opacity="1"/>
        </radialGradient>
        <linearGradient id="bezelGlow_${Math.abs(hashCode(caseColor))}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${caseColor}"/>
          <stop offset="50%" stop-color="#ffffff" stop-opacity="0.7"/>
          <stop offset="100%" stop-color="${caseColor}"/>
        </linearGradient>
      </defs>

      <!-- Background Soft Pedestal -->
      <rect width="400" height="400" fill="#f5f2e9" rx="8"/>
      <ellipse cx="200" cy="360" rx="90" ry="14" fill="#000000" opacity="0.12"/>

      ${strapTop}
      ${strapBottom}

      <!-- Watch Case Outer Lugs -->
      <path d="M152 110 Q144 140 144 200 Q144 260 152 290" fill="none" stroke="${caseColor}" stroke-width="10" stroke-linecap="round"/>
      <path d="M248 110 Q256 140 256 200 Q256 260 248 290" fill="none" stroke="${caseColor}" stroke-width="10" stroke-linecap="round"/>

      <!-- Crown & Pushers -->
      <rect x="306" y="193" width="10" height="14" rx="2" fill="${caseColor}"/>
      <rect x="302" y="162" width="8" height="10" rx="2" fill="${caseColor}"/>
      <rect x="302" y="228" width="8" height="10" rx="2" fill="${caseColor}"/>

      <!-- Main Bezel Outer -->
      <circle cx="200" cy="200" r="108" fill="#111" stroke="url(#bezelGlow_${Math.abs(hashCode(caseColor))})" stroke-width="8"/>
      <circle cx="200" cy="200" r="102" fill="none" stroke="#222" stroke-width="1"/>

      <!-- Dial Face -->
      <circle cx="200" cy="200" r="98" fill="url(#sunburst_${Math.abs(hashCode(dialColor))}"/>

      ${markers}
      ${subDials}

      <!-- Brand Logo Wordmark on Dial -->
      <text x="200" y="152" font-family="'Cairo', sans-serif" font-weight="800" font-size="12" fill="${caseColor}" text-anchor="middle" letter-spacing="1">صُدْفَة</text>
      <text x="200" y="163" font-family="'Manrope', sans-serif" font-weight="600" font-size="6" fill="#888" text-anchor="middle" letter-spacing="1.5">CHRONOMETRE</text>

      <!-- Date Window at 4:30 or 3 -->
      <rect x="238" y="193" width="18" height="14" rx="1.5" fill="#f8f6f0" stroke="${caseColor}" stroke-width="1"/>
      <text x="247" y="204" font-family="'Manrope', sans-serif" font-size="9" font-weight="700" fill="#111" text-anchor="middle">${dateText}</text>

      <!-- Hands -->
      <!-- Hour Hand -->
      <line x1="200" y1="200" x2="160" y2="165" stroke="${caseColor}" stroke-width="4.5" stroke-linecap="round"/>
      <!-- Minute Hand -->
      <line x1="200" y1="200" x2="235" y2="140" stroke="${caseColor}" stroke-width="3" stroke-linecap="round"/>
      <!-- Second Hand -->
      <line x1="200" y1="215" x2="200" y2="115" stroke="${accentColor}" stroke-width="1.4" stroke-linecap="round"/>
      <!-- Center Cap -->
      <circle cx="200" cy="200" r="4.5" fill="${caseColor}"/>
      <circle cx="200" cy="200" r="2" fill="${accentColor}"/>
    </svg>
  `.trim();

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function hashCode(str = "") {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// Full, curated inventory preserving existing test cases and adding complete authentic horology catalog
export const initialProducts = [
  {
    id: "sodfa-001-heritage-chrono",
    name: "ضَفّة هيريتدج كرونوغراف",
    shortSpec: "41.5 مم • كوارتز ياباني • كرونوغراف",
    brand: "ضَفّة",
    category: "رياضية وكرونوغراف",
    categoryId: "sport-chrono",
    gender: "men",
    style: "chronograph",
    basePrice: 1850,
    discountPercent: 15,
    discountActive: true,
    discountReason: "عرض افتتاح التشكيلة",
    discountStartOn: "2026-11-01",
    discountEndOn: "2026-12-31",
    salePrice: 1573,
    badge: "الأكثر مبيعًا",
    isFlagship: true,
    inStock: true,
    stockCount: 14,
    description: `ساعة كرونوغراف كلاسيكية مستوحاة من سباقات السبعينيات العريقة، تعبّر عن الدقة التامة والروح الرياضية الأنيقة.
تتميز بمينا عاجي ذو لمعان خفيف مع عدادات فرعية غائرة ثلاثية الأبعاد وعقارب زرقاء مطلية بالحرارة.
مؤطرة بإطار فولاذي من الستانلس ستيل 316L المقاوم للصدأ مع زجاج ياقوتي كريستال مانع للانعكاس، وسوار مريح من الجلد الإيطالي الفاخر.`,
    specifications: [
      { label: "قطر الهيكل", value: "41.5 مم" },
      { label: "سُمك الهيكل", value: "11.8 مم" },
      { label: "نوع الحركة", value: "كوارتز ياباني متعدد الوظائف (Chronograph)" },
      { label: "نوع الزجاج", value: "كريستال ياقوتي (Sapphire Crystal) مضاد للخدش" },
      { label: "مقاومة الماء", value: "100 متر / 10ATM (مقاومة للسباحة والغمر)" },
      { label: "خامة الهيكل", value: "ستانلس ستيل 316L فائق المقاومة للصدأ" },
      { label: "خامة السوار", value: "جلد طبيعي إيطالي مدبوغ نباتيًا مع قفل فراشة" },
      { label: "عرض السوار", value: "20 مم" },
      { label: "الضمان", value: "سنتان ضمان دولي شامل" },
    ],
    imageUrl: createWatchSvg({
      caseColor: "#c5a059",
      dialColor: "#0b2b28",
      strapColor: "#4a2c11",
      strapType: "leather",
      accentColor: "#be724c",
      dialStyle: "chronograph",
      hasSubDials: true,
    }),
    imageAlt: "ساعة صُدْفَة هيريتدج كرونوغراف بمينا بترولي وسوار جلد بني",
    images: [
      {
        imageUrl: createWatchSvg({
          caseColor: "#c5a059",
          dialColor: "#0b2b28",
          strapColor: "#4a2c11",
          strapType: "leather",
          accentColor: "#be724c",
          dialStyle: "chronograph",
          hasSubDials: true,
        }),
        imageAlt: "صُدْفَة هيريتدج كرونوغراف — بترولي وجلد بني",
        colorLabel: "بترولي ملكي / جلد بني",
      },
      {
        imageUrl: createWatchSvg({
          caseColor: "#dcdde1",
          dialColor: "#1e272e",
          strapColor: "#2f3542",
          strapType: "steel",
          accentColor: "#e74c3c",
          dialStyle: "chronograph",
          hasSubDials: true,
        }),
        imageAlt: "صُدْفَة هيريتدج كرونوغراف — أسود وسوار ستيل",
        colorLabel: "أسود فحمي / سوار ستيل",
      },
      {
        imageUrl: createWatchSvg({
          caseColor: "#e5c07b",
          dialColor: "#f5f6fa",
          strapColor: "#1e272e",
          strapType: "leather",
          accentColor: "#2980b9",
          dialStyle: "chronograph",
          hasSubDials: true,
        }),
        imageAlt: "صُدْفَة هيريتدج كرونوغراف — عاجي وسوار جلد كلاسيكي",
        colorLabel: "عاجي كلاسيكي / جلد أسود",
      },
    ],
  },
  {
    id: "sodfa-002-classic-onyx",
    name: "ضَفّة كلاسيك أونيكس",
    shortSpec: "39 مم • كوارتز سويسري • سُمك 7.4 مم",
    brand: "ضَفّة",
    category: "كلاسيك ورسمية",
    categoryId: "classic-dress",
    gender: "men",
    style: "classic",
    basePrice: 1290,
    discountPercent: 0,
    discountActive: false,
    salePrice: 1290,
    badge: "كلاسيك رسمي",
    isFlagship: false,
    inStock: true,
    stockCount: 22,
    description: `ساعة سهرة فائقة النقاء والأناقة، مصممة للمناسبات الرسمية والاجتماعات الهامة.
تتألق بمينا أسود أونيكس عميق عاكس للضوء مع مؤشرات رفيعة مصقولة بدقة، وهيكل فائق النحافة ينساب بسلاسة تحت أكمام القميص.`,
    specifications: [
      { label: "قطر الهيكل", value: "39 مم" },
      { label: "سُمك الهيكل", value: "7.4 مم (Ultra Slim)" },
      { label: "نوع الحركة", value: "كوارتز ياباني رفيع الدقة ميوتا" },
      { label: "نوع الزجاج", value: "زجاج ياقوتي محدب مقاوم للانعكاس" },
      { label: "مقاومة الماء", value: "50 متر / 5ATM (مقاومة للرذاذ والاستحمام الخفيف)" },
      { label: "خامة الهيكل", value: "ستانلس ستيل 316L مصقول بالمرآة" },
      { label: "خامة السوار", value: "جلد تمساحي منقوش يدويًا باللون الأسود" },
      { label: "عرض السوار", value: "19 مم" },
      { label: "الضمان", value: "سنتان ضد عيوب الصناعة" },
    ],
    imageUrl: createWatchSvg({
      caseColor: "#dcdde1",
      dialColor: "#050505",
      strapColor: "#111111",
      strapType: "leather",
      accentColor: "#be724c",
      dialStyle: "classic",
    }),
    imageAlt: "ساعة صُدْفَة كلاسيك أونيكس سوداء فائقة النحافة",
    images: [
      {
        imageUrl: createWatchSvg({
          caseColor: "#dcdde1",
          dialColor: "#050505",
          strapColor: "#111111",
          strapType: "leather",
          accentColor: "#be724c",
          dialStyle: "classic",
        }),
        imageAlt: "صُدْفَة كلاسيك أونيكس سوداء",
        colorLabel: "أونيكس أسود ملكي",
      },
      {
        imageUrl: createWatchSvg({
          caseColor: "#c5a059",
          dialColor: "#fcf8f2",
          strapColor: "#3b1e08",
          strapType: "leather",
          accentColor: "#c5a059",
          dialStyle: "classic",
        }),
        imageAlt: "صُدْفَة كلاسيك ذهبي ومينا بيضاء",
        colorLabel: "ذهبي دافئ / جلد هافان",
      },
    ],
  },
  {
    id: "sodfa-003-rose-meridian",
    name: "ضَفّة روز ميريديان",
    shortSpec: "34 مم • صدف لؤلؤي • مطلي ذهب وردي",
    brand: "ضَفّة",
    category: "نسائي",
    categoryId: "women",
    gender: "women",
    style: "classic",
    basePrice: 1450,
    discountPercent: 20,
    discountActive: true,
    discountReason: "عرض الأناقة النسائية",
    discountStartOn: "2026-11-05",
    discountEndOn: "2026-12-25",
    salePrice: 1160,
    badge: "عرض خاص",
    isFlagship: false,
    inStock: true,
    stockCount: 18,
    description: `تصميم أنثوي رقيق يجمع بين دفء الذهب الوردي ولمعان عرق اللؤلؤ الطبيعي على المينا.
تتكامل الساعة مع سوار شبكي ميلانيز يلتف بنعومة حول المعصم مع إمكانية تعديل المقاس بسهولة فائقة دون الحاجة لأدوات.`,
    specifications: [
      { label: "قطر الهيكل", value: "33 مم" },
      { label: "سُمك الهيكل", value: "7.0 مم" },
      { label: "نوع المينا", value: "عرق اللؤلؤ الطبيعي (Natural Mother of Pearl)" },
      { label: "نوع الحركة", value: "كوارتز سويسري روندا فائق الدقة" },
      { label: "نوع الزجاج", value: "كريستال مقوى مقاوم للخدش" },
      { label: "مقاومة الماء", value: "30 متر / 3ATM" },
      { label: "خامة الهيكل", value: "ستانلس ستيل مطلي بالذهب الوردي بتقنية PVD" },
      { label: "نوع السوار", value: "سوار ميلانيز شبكي روز جولد ناعم الملمس" },
      { label: "عرض السوار", value: "14 مم" },
      { label: "الضمان", value: "سنتان شاملتان" },
    ],
    imageUrl: createWatchSvg({
      caseColor: "#e0a899",
      dialColor: "#f7eded",
      strapColor: "#d39c8e",
      strapType: "mesh",
      accentColor: "#be724c",
      dialStyle: "minimal",
    }),
    imageAlt: "ساعة صُدْفَة روز ميريديان نسائية بالذهب الوردي",
    images: [
      {
        imageUrl: createWatchSvg({
          caseColor: "#e0a899",
          dialColor: "#f7eded",
          strapColor: "#d39c8e",
          strapType: "mesh",
          accentColor: "#be724c",
          dialStyle: "minimal",
        }),
        imageAlt: "صُدْفَة روز ميريديان روز جولد",
        colorLabel: "ذهب وردي شبكي",
      },
      {
        imageUrl: createWatchSvg({
          caseColor: "#dcdde1",
          dialColor: "#ebf2fa",
          strapColor: "#b2bec3",
          strapType: "mesh",
          accentColor: "#74b9ff",
          dialStyle: "minimal",
        }),
        imageAlt: "صُدْفَة ميريديان فضي ثلجي",
        colorLabel: "فضي ثلجي ناعم",
      },
    ],
  },
  {
    id: "sodfa-004-verdi-grand",
    name: "ضَفّة فيردي جراند",
    shortSpec: "40 مم • زمردي Sunburst • نافذة تاريخ",
    brand: "ضَفّة",
    category: "كلاسيك ورسمية",
    categoryId: "classic-dress",
    gender: "men",
    style: "classic",
    basePrice: 1680,
    discountPercent: 10,
    discountActive: true,
    discountReason: "خصم إطلاق الموسم",
    discountStartOn: "2026-11-01",
    discountEndOn: "2026-12-15",
    salePrice: 1512,
    badge: "إصدار محدود",
    isFlagship: false,
    inStock: true,
    stockCount: 9,
    description: `ساعة فاخرة مستوحاة من ألوان الزمرد الأخضر المصري العريق، متلألئة بتأثير أشعة الشمس (Sunburst) مع نافذة تاريخ عند مؤشر الساعة 3.
تأتي مع سوار ستانلس ستيل جوبيلي خماسي الوصلات يعكس الحرفية العالية في الصقل والتلميع المتبادل.`,
    specifications: [
      { label: "قطر الهيكل", value: "40 مم" },
      { label: "سُمك الهيكل", value: "9.5 مم" },
      { label: "نوع الحركة", value: "كوارتز ياباني مع ميزة التاريخ السريع" },
      { label: "نوع الزجاج", value: "سافاير كريستال مع عدسة تكبير للتاريخ (Cyclops)" },
      { label: "مقاومة الماء", value: "50 متر / 5ATM" },
      { label: "خامة الهيكل", value: "ستانلس ستيل 316L ثنائي اللون (فضي وذهبي)" },
      { label: "خامة السوار", value: "سوار جوبيلي فاخر من الستانلس ستيل" },
      { label: "عرض السوار", value: "20 مم" },
      { label: "الضمان", value: "سنتان مع علبة فاخرة وشهادة أصالة" },
    ],
    imageUrl: createWatchSvg({
      caseColor: "#c5a059",
      dialColor: "#064436",
      strapColor: "#8a8f94",
      strapType: "steel",
      accentColor: "#be724c",
      dialStyle: "classic",
      dateText: "17",
    }),
    imageAlt: "ساعة صُدْفَة فيردي جراند زمردية وسوار ستيل",
    images: [
      {
        imageUrl: createWatchSvg({
          caseColor: "#c5a059",
          dialColor: "#064436",
          strapColor: "#8a8f94",
          strapType: "steel",
          accentColor: "#be724c",
          dialStyle: "classic",
          dateText: "17",
        }),
        imageAlt: "صُدْفَة فيردي جراند بمينا زمردية",
        colorLabel: "زمردي ملكي / ستيل جوبيلي",
      },
      {
        imageUrl: createWatchSvg({
          caseColor: "#dcdde1",
          dialColor: "#0b2b28",
          strapColor: "#2c3e50",
          strapType: "leather",
          accentColor: "#be724c",
          dialStyle: "classic",
          dateText: "17",
        }),
        imageAlt: "صُدْفَة فيردي جراند مع سوار جلد",
        colorLabel: "زمردي غامق / جلد كحلي",
      },
    ],
  },
  {
    id: "sodfa-005-navigator-diver",
    name: "ضَفّة نافيجاتور دايفر",
    shortSpec: "42 مم • غواصين 200م • إطار سيراميك",
    brand: "ضَفّة",
    category: "رياضية وكرونوغراف",
    categoryId: "sport-chrono",
    gender: "men",
    style: "sport",
    basePrice: 1950,
    discountPercent: 0,
    discountActive: false,
    salePrice: 1950,
    badge: "جديد المتجر",
    isFlagship: false,
    inStock: true,
    stockCount: 12,
    description: `ساعة بحرية رياضية صلبة جاهزة لكافة المغامرات تحت الماء وفي أوقات الفراغ.
مزودة بإطار دوار أحادي الاتجاه مصنوع من السيراميك بـ 120 نقرة، وعقارب ومؤشرات فوسفورية بمادة Super-LumiNova السويسرية لضمان القراءة في أحلك الظروف.`,
    specifications: [
      { label: "قطر الهيكل", value: "42 مم" },
      { label: "سُمك الهيكل", value: "12.5 مم" },
      { label: "نوع الإطار", value: "سيراميك مصقول دوار أحادي الاتجاه (120 Click)" },
      { label: "نوع الحركة", value: "كوارتز دايفر عالي التحمل ضد الصدمات" },
      { label: "مقاومة الماء", value: "200 متر / 20ATM مع تاج ملولب مانع لتسرب الماء" },
      { label: "مادة الإضاءة", value: "Super-LumiNova سويسرية فائقة السطوع" },
      { label: "خامة السوار", value: "سيليكون فائق المرونة مع قفل ستيل غوص مضلع" },
      { label: "الضمان", value: "سنتان ضد عيوب الصناعة وتسرب الماء" },
    ],
    imageUrl: createWatchSvg({
      caseColor: "#dcdde1",
      dialColor: "#0f2b48",
      strapColor: "#1b263b",
      strapType: "steel",
      accentColor: "#e67e22",
      dialStyle: "diver",
      dateText: "28",
    }),
    imageAlt: "ساعة صُدْفَة نافيجاتور دايفر رياضية بحرية",
    images: [
      {
        imageUrl: createWatchSvg({
          caseColor: "#dcdde1",
          dialColor: "#0f2b48",
          strapColor: "#1b263b",
          strapType: "steel",
          accentColor: "#e67e22",
          dialStyle: "diver",
          dateText: "28",
        }),
        imageAlt: "صُدْفَة نافيجاتور أزرق بحري",
        colorLabel: "أزرق أعماق البحار",
      },
      {
        imageUrl: createWatchSvg({
          caseColor: "#2d3436",
          dialColor: "#111111",
          strapColor: "#1e272e",
          strapType: "leather",
          accentColor: "#be724c",
          dialStyle: "diver",
          dateText: "28",
        }),
        imageAlt: "صُدْفَة نافيجاتور أسود مطفي",
        colorLabel: "أسود شبحي كامل",
      },
    ],
  },
  {
    id: "sodfa-006-aura-minimalist",
    name: "ضَفّة أورا سليم",
    shortSpec: "32 مم • مينيملست • سُمك فائق النحافة",
    brand: "ضَفّة",
    category: "نسائي",
    categoryId: "women",
    gender: "women",
    style: "minimal",
    basePrice: 1120,
    discountPercent: 25,
    discountActive: true,
    discountReason: "عرض نهاية الموسم الحصري",
    discountStartOn: "2026-11-10",
    discountEndOn: "2026-12-20",
    salePrice: 840,
    badge: "خصم 25%",
    isFlagship: false,
    inStock: true,
    stockCount: 16,
    description: `جمالية البساطة النقية بدون تكلف. ساعة أنيقة ذات مينا رملي ناعم، مؤشرات دقيقة خافتة، وعقربين فقط بدون عقرب ثواني لتمنحك إحساسًا بالهدوء والتأمل في كل لحظة.
مرفقة بسوار ناعم من الجلد الطبيعي بلون بيج رملي دافئ يلائم كل الإطلالات اليومية.`,
    specifications: [
      { label: "قطر الهيكل", value: "32 مم" },
      { label: "سُمك الهيكل", value: "6.2 مم (Ultra Slim Profile)" },
      { label: "نوع الحركة", value: "كوارتز ياباني ثنائي العقارب هادئ الحركة" },
      { label: "نوع الزجاج", value: "كريستال معدني مقوى بحافة مشطوفة" },
      { label: "مقاومة الماء", value: "30 متر / 3ATM" },
      { label: "خامة السوار", value: "جلد ناعم طبيعي بدون درزات" },
      { label: "عرض السوار", value: "14 مم" },
      { label: "الوزن", value: "28 جرامًا فقط لخفة متناهية على المعصم" },
    ],
    imageUrl: createWatchSvg({
      caseColor: "#e0a899",
      dialColor: "#f5f0ea",
      strapColor: "#bfa58a",
      strapType: "leather",
      accentColor: "#be724c",
      dialStyle: "minimal",
    }),
    imageAlt: "ساعة صُدْفَة أورا سليم رملية ناعمة",
    images: [
      {
        imageUrl: createWatchSvg({
          caseColor: "#e0a899",
          dialColor: "#f5f0ea",
          strapColor: "#bfa58a",
          strapType: "leather",
          accentColor: "#be724c",
          dialStyle: "minimal",
        }),
        imageAlt: "صُدْفَة أورا رملي هادئ",
        colorLabel: "بيج رملي طبيعي",
      },
      {
        imageUrl: createWatchSvg({
          caseColor: "#dcdde1",
          dialColor: "#f1f2f6",
          strapColor: "#747d8c",
          strapType: "leather",
          accentColor: "#2ed573",
          dialStyle: "minimal",
        }),
        imageAlt: "صُدْفَة أورا رمادي فاتح",
        colorLabel: "رمادي معدني خفيف",
      },
    ],
  },
  {
    id: "sodfa-007-stellaris-automatic",
    name: "ضَفّة سيلاريس أوتوماتيك",
    shortSpec: "41 مم • حركة أوتوماتيكية • ظهر زجاجي",
    brand: "ضَفّة",
    category: "كلاسيك ورسمية",
    categoryId: "classic-dress",
    gender: "men",
    style: "classic",
    basePrice: 2490,
    discountPercent: 12,
    discountActive: true,
    discountReason: "إصدار النخبة الميكانيكي",
    discountStartOn: "2026-11-01",
    discountEndOn: "2026-12-31",
    salePrice: 2191,
    badge: "قطعة نخبة",
    isFlagship: false,
    inStock: true,
    stockCount: 6,
    description: `تحفة ميكانيكية حقيقية لا تحتاج إلى بطارية، تعمل ذاتيًا بحركة نبض معصمك.
تتميز بنافذة قلب مفتوح (Open-Heart) عند موضع الساعة 7 تكشف عن العجلة المتوازنة الدوارة، وظهر شفاف من كريستال السافاير لمشاهدة التروس الدقيقة والرقاص الذهبي المحفور يدويًا.`,
    specifications: [
      { label: "قطر الهيكل", value: "41 مم" },
      { label: "سُمك الهيكل", value: "11.2 مم" },
      { label: "نوع الحركة", value: "أوتوماتيك ميكانيكية كاليبر NH38 مع احتياطي طاقة 41 ساعة" },
      { label: "عدد الأحجار", value: "24 ياقوتة صناعية لتقليل الاحتكاك" },
      { label: "نوع الزجاج", value: "كريستال سافاير أمامي وخلفي مزدوج" },
      { label: "مقاومة الماء", value: "50 متر / 5ATM" },
      { label: "خامة السوار", value: "جلد بقري إيطالي منقوش مع إبزيم فراشة ميكانيكي" },
      { label: "الضمان", value: "3 سنوات ضمان ميكانيكي شامل" },
    ],
    imageUrl: createWatchSvg({
      caseColor: "#c5a059",
      dialColor: "#0d1b2a",
      strapColor: "#221105",
      strapType: "leather",
      accentColor: "#be724c",
      dialStyle: "chronograph",
      hasSubDials: true,
    }),
    imageAlt: "ساعة صُدْفَة سيلاريس أوتوماتيك بقلب مفتوح",
    images: [
      {
        imageUrl: createWatchSvg({
          caseColor: "#c5a059",
          dialColor: "#0d1b2a",
          strapColor: "#221105",
          strapType: "leather",
          accentColor: "#be724c",
          dialStyle: "chronograph",
          hasSubDials: true,
        }),
        imageAlt: "صُدْفَة سيلاريس أوتوماتيك كحلي وذهبي",
        colorLabel: "كحلي ليلي / ذهبي أصفر",
      },
      {
        imageUrl: createWatchSvg({
          caseColor: "#dcdde1",
          dialColor: "#2d3436",
          strapColor: "#111111",
          strapType: "leather",
          accentColor: "#0984e3",
          dialStyle: "chronograph",
          hasSubDials: true,
        }),
        imageAlt: "صُدْفَة سيلاريس أوتوماتيك أسود وفضي",
        colorLabel: "أسود تيتانيوم / فضي بارد",
      },
    ],
  },
  {
    id: "sodfa-008-platinum-hybrid",
    name: "ضَفّة بلاتينيوم هايبرد الذكية",
    shortSpec: "42 مم • عقارب ميكانيكية + شاشة ذكية",
    brand: "ضَفّة",
    category: "ذكية وهجينة",
    categoryId: "smart-hybrid",
    gender: "unisex",
    style: "smart",
    basePrice: 2850,
    discountPercent: 15,
    discountActive: true,
    discountReason: "عرض التكنولوجيا الراقية",
    discountStartOn: "2026-11-01",
    discountEndOn: "2026-12-31",
    salePrice: 2423,
    badge: "تقنية هجينة",
    isFlagship: false,
    inStock: true,
    stockCount: 11,
    description: `المعادلة المستحيلة التي تحققت: أناقة الساعات الفاخرة الكلاسيكية بعقارب ميكانيكية حقيقية، مع ذكاء رقمي غير مرئي.
تحتوي على شاشة OLED خفية تضيء فقط عند الحاجة لتعرض إشعارات هاتفك، نبضات القلب، جودة النوم، والخطوات اليومية، وبطارية مذهلة تدوم 30 يومًا متواصلة بشحنة واحدة.`,
    specifications: [
      { label: "قطر الهيكل", value: "42 مم" },
      { label: "سُمك الهيكل", value: "11.6 مم" },
      { label: "عمر البطارية", value: "حتى 30 يومًا بشحنة واحدة سريعة (شحن مغناطيسي)" },
      { label: "المستشعرات", value: "مستشعر نبضات القلب PPG، مقياس الأكسجين SpO2، مقياس الخطوات" },
      { label: "التوافق", value: "تطبيق صُدْفَة الذكي متوافق مع iPhone (iOS 14+) و Android (8.0+)" },
      { label: "مقاومة الماء", value: "50 متر / 5ATM (مقاومة للسباحة والأنشطة اليومية)" },
      { label: "خامة الهيكل", value: "ستانلس ستيل طبي 316L مع زجاج سافاير كريستال" },
      { label: "خامة السوار", value: "سوار هجين من الجلد الخارجي والسيليكون الداخلي المقاوم للتعرق" },
      { label: "الضمان", value: "سنتان ضمان للأجهزة والبطارية" },
    ],
    imageUrl: createWatchSvg({
      caseColor: "#2c3e50",
      dialColor: "#171c24",
      strapColor: "#1a252f",
      strapType: "steel",
      accentColor: "#00cec9",
      dialStyle: "minimal",
      dateText: "17",
    }),
    imageAlt: "ساعة صُدْفَة بلاتينيوم الذكية الهجينة",
    images: [
      {
        imageUrl: createWatchSvg({
          caseColor: "#2c3e50",
          dialColor: "#171c24",
          strapColor: "#1a252f",
          strapType: "steel",
          accentColor: "#00cec9",
          dialStyle: "minimal",
          dateText: "17",
        }),
        imageAlt: "صُدْفَة بلاتينيوم تيتانيوم غامق",
        colorLabel: "رمادي تيتانيوم / شاشة خفية",
      },
      {
        imageUrl: createWatchSvg({
          caseColor: "#dcdde1",
          dialColor: "#0c1017",
          strapColor: "#2d3436",
          strapType: "leather",
          accentColor: "#0984e3",
          dialStyle: "minimal",
          dateText: "17",
        }),
        imageAlt: "صُدْفَة بلاتينيوم فضي كلاسيكي",
        colorLabel: "فضي مصقول / جلد كربوني",
      },
    ],
  },
  // Legacy / Test Product compatibility preservation
  {
    id: "123e4567-e89b-42d3-a456-426614174000",
    name: "ساعة ضَفّة كلاسيكية أصلية",
    shortSpec: "40 مم • ستانلس ستيل • كلاسيك",
    brand: "ضَفّة",
    category: "كلاسيك ورسمية",
    categoryId: "classic-dress",
    gender: "men",
    style: "classic",
    basePrice: 500,
    discountPercent: 10,
    discountActive: true,
    discountReason: "عرض افتتاح",
    discountStartOn: "2026-11-10",
    discountEndOn: "2026-12-31",
    salePrice: 450,
    badge: "الإصدار التأسيسي",
    isFlagship: false,
    inStock: true,
    stockCount: 8,
    description: "ساعة صُدْفَة الأولى، بتصميم عربي معاصر وتفاصيل بسيطة تناسب كل يوم.",
    specifications: [
      { label: "قطر الهيكل", value: "40 مم" },
      { label: "نوع الحركة", value: "كوارتز ياباني" },
      { label: "نوع الزجاج", value: "كريستال مقوى" },
      { label: "مقاومة الماء", value: "30 متر" },
    ],
    imageUrl: "/sodfa-promo-poster.jpg",
    imageAlt: "ساعة صُدْفَة التأسيسية",
    images: [
      {
        imageUrl: "/sodfa-promo-poster.jpg",
        imageAlt: "ساعة صُدْفَة الأصلية بلون فضي",
        colorLabel: "فضي كلاسيكي",
      },
      {
        imageUrl: createWatchSvg({
          caseColor: "#c5a059",
          dialColor: "#0b2b28",
          strapColor: "#4a2c11",
          strapType: "leather",
        }),
        imageAlt: "ساعة صُدْفَة الأصلية بلون ذهبي",
        colorLabel: "ذهبي دافئ",
      },
    ],
  },
];

export const defaultStoreSettings = {
  brandName: "ضَفّة",
  brandSubtitle: "سَاعَةٌ لِكُلِّ لَحْظَةٍ",
  announcement: "شحن مجاني لكافة المحافظات • الدفع عند الاستلام بعد المعاينة والفحص",
  heroHeadline: "كل لحظة حلوة\nتستاهل وقتها.",
  heroDescription: "ساعات مختارة بعناية فائقة، تجمع بين دقة صناعة الساعات العالمية وجمال الخطوط المعاصرة. اقتنِ قطعة تعبّر عن هويتك اليومية.",
  heroVideoUrl: "/manus-storage/96837d80-d655-11f1-9beb-9def1d7eb227_fb348b1f.mp4",
  heroPosterUrl: "/sodfa-promo-poster.jpg",
  featuredTag: "القطعة المميزة",
  featuredName: "ضَفّة هيريتدج كرونوغراف",
  featuredSpec: "سافاير • مقاومة 100م • ستيل 316L",
  defaultPhone: "+201000000000",
  defaultWhatsapp: "+201000000000",
  shippingDetails: "سعر الساعة شامل الشحن إلى كافة المحافظات. تُضاف رسوم إضافية لمحافظات جنوب مصر ومرسى مطروح والغردقة.",
  exchangeDetails: "حق الاستبدال أو الاسترجاع خلال 14 يومًا، وحق رد القيمة خلال 30 يومًا في حالة العيب وفق لوائح جهاز حماية المستهلك المصري.",
  // Notification Settings (Dual-Channel: Email & Telegram)
  notificationEmail: "",
  web3formsKey: "",
  telegramBotToken: "",
  telegramChatId: "",
  emailNotificationsEnabled: false,
  telegramNotificationsEnabled: false,
  // News Ticker Settings
  tickerEnabled: true,
  tickerSpeed: "medium", // slow: 35s, medium: 22s, fast: 14s
};

export const defaultTickerItems = [
  "شحن مجاني لكافة محافظات مصر • متاح المعاينة والفحص الدقيق قبل السداد للمندوب",
  "ضمان رسمي شامل لمدة عامين على جميع الساعات الأصلية مع استبدال فوري",
  "خصومات حصرية بمناسبة إطلاق تشكيلة ساعات ضَفّة 2026 الفاخرة",
  "توصيل سريع وموثوق خلال 2 إلى 4 أيام عمل لباب منزلك مباشرة",
];

export function getTickerItems() {
  try {
    const raw = localStorage.getItem("daffa_ticker_items");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return defaultTickerItems;
}

export function saveTickerItems(items) {
  try {
    localStorage.setItem("daffa_ticker_items", JSON.stringify(items));
    window.dispatchEvent(new CustomEvent("daffa:ticker-updated", { detail: items }));
  } catch {}
}

export const storeSettings = defaultStoreSettings;

export function getStoreSettings() {
  try {
    const raw = localStorage.getItem("daffa_store_settings") || localStorage.getItem("sodfa_store_settings");
    if (raw) {
      return { ...defaultStoreSettings, ...JSON.parse(raw) };
    }
  } catch {
    // Fallback
  }
  return { ...defaultStoreSettings };
}

export function saveStoreSettings(settings) {
  try {
    localStorage.setItem("daffa_store_settings", JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent("daffa:settings-updated", { detail: settings }));
  } catch {
    // Storage quota
  }
}

// Orders State Management
export function getOrders() {
  try {
    const raw = localStorage.getItem("daffa_orders");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveOrders(orders) {
  try {
    localStorage.setItem("daffa_orders", JSON.stringify(orders));
    window.dispatchEvent(new CustomEvent("daffa:orders-updated", { detail: orders }));
  } catch {}
}

export function addOrder(orderData) {
  const orders = getOrders();
  const newOrder = {
    ...orderData,
    id: orderData.id || `DAF-${Date.now().toString().slice(-4)}`,
    status: orderData.status || "new", // "new" | "confirmed" | "shipped" | "delivered" | "cancelled"
    createdAt: orderData.createdAt || new Date().toISOString(),
    isRead: false,
  };
  orders.unshift(newOrder);
  saveOrders(orders);
  return newOrder;
}

export function updateOrderStatus(orderId, status) {
  const orders = getOrders();
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx > -1) {
    orders[idx].status = status;
    orders[idx].isRead = true;
    saveOrders(orders);
  }
}

export function markOrdersAsRead() {
  const orders = getOrders();
  let changed = false;
  orders.forEach((o) => {
    if (!o.isRead) {
      o.isRead = true;
      changed = true;
    }
  });
  if (changed) saveOrders(orders);
}

export function getStoredCategories() {
  try {
    const raw = localStorage.getItem("daffa_custom_categories");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return categories;
}

export function saveStoredCategories(cats) {
  try {
    localStorage.setItem("daffa_custom_categories", JSON.stringify(cats));
    window.dispatchEvent(new CustomEvent("daffa:categories-updated", { detail: cats }));
  } catch {}
}

// Kept empty for legacy imports only; the active catalog comes from /api/products or stored catalog.
export const products = [];

// Central catalog state management
export function getStoredProducts() {
  try {
    const local = localStorage.getItem("daffa_custom_products") || localStorage.getItem("sodfa_custom_products");
    if (local) {
      const parsed = JSON.parse(local);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Fallback to initial
  }
  return initialProducts;
}

export function saveStoredProducts(products) {
  try {
    localStorage.setItem("daffa_custom_products", JSON.stringify(products));
    window.dispatchEvent(new CustomEvent("daffa:products-updated", { detail: products }));
  } catch {
    // Ignore storage quota
  }
}

// Shopping Cart Persistence
export function getCart() {
  try {
    const raw = localStorage.getItem("daffa_cart") || localStorage.getItem("sodfa_cart");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCart(cartItems) {
  try {
    localStorage.setItem("daffa_cart", JSON.stringify(cartItems));
  } catch {
    // Ignore
  }
}
