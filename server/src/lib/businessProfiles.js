/*
 * Each business type gets its own way of working (products form and list, stock entry, sales, purchases).
 * The type chosen at sign-up ("Business category") picks the profile; the profile is sent to the app
 * with the signed-in business (req.business.profile → GET /api/auth/me) and the screens follow it.
 *
 *   variants        product variant fields shown in the form / list and added to the product name
 *                   (size, shade, fragrance, formula, packSize)
 *   extraBarcodes   several barcodes per product, each for a packaging unit (e.g. box of 12)
 *   batches         every product tracks batch number + expiry date per stock entry, sold first-expiry-first-out
 *   expirySoonDays  "expiring soon" window for batch alerts and filters
 *   labels          different words for the same product fields (keys of ui.products.*)
 *   units           units of measurement offered in the product form (null = the full list)
 *   hiddenFields    product form fields this business does not use (e.g. description)
 *   medicine        medicine details: generic name, dosage form, manufacturer, supplier, prescription, storage
 *   packaging       packs above the base unit (carton → box → strip → tablet, lib/packaging.js); stock is
 *                   kept in the base unit, purchases / stock entry / POS / invoices may use the packs
 *   purchaseOrders  purchases can be ordered first and received later (goods receipt adds the stock)
 *   electronics     product type, model number, manufacturer, preferred supplier, country of origin, notes,
 *                   minimum selling price, technical specifications by product type
 *   serials         per-product tracking: quantity, serial number, IMEI or both (devices table, lib/devices.js)
 *   warranties      warranty policy per product; a warranty record per device / line sold (Warranties module)
 *   variantGroups   product families: "Add variant" and the variants of a product (each variant is a product)
 *   categories      ready-made categories offered in the product form, with their subcategories
 *                   (the business adds its own in Products → Product lists)
 *   fashion         clothing: collection, season, model / style, size systems and colours (+ the business's own),
 *                   variant attributes by category (size + colour, colour + fabric type…)
 *   sizeSystems     { "Letter (XS–XXL)": [...], … } and categorySizes: which size system a category uses
 *   colors          [[name, "#hex"], …] colour list with swatches
 *   categoryVariants  which variant attributes a category uses (size, shade = colour, formula = fabric type, packSize = width)
 *   jewelry         metal, purity / karat, gross / stone / net weight, fixed or weight-based price (lib/jewelry.js),
 *                   unique pieces or quantities, item status, metal rates, used-gold purchases
 *   metals / purities  metals offered and their purity options (the business adds its own in Product lists)
 *
 * Add a business type here when its special interface is built; types without one use DEFAULT.
 */
const DEFAULT = {
  key: "default",
  variants: ["size"],
  extraBarcodes: false,
  batches: false,
  expirySoonDays: 90,
  labels: {},
  units: null,
  hiddenFields: [],
  medicine: false,
  packaging: false,
  purchaseOrders: false,
  electronics: false,
  serials: false,
  warranties: false,
  variantGroups: false,
  fashion: false,
  jewelry: false,
  categories: {}
};

/* Ready-made categories per business type: { category: [subcategories] } */
const CATEGORIES = {
  supermarket: {
    "Rice & Grains": [], "Flour & Baking": [], "Cooking Oil & Ghee": [], "Sugar & Salt": [], "Pasta & Noodles": [], "Canned & Packaged Food": [],
    "Spices & Sauces": [], "Dairy & Eggs": [], "Beverages & Juices": [], "Water": [], "Tea & Coffee": [], "Snacks & Sweets": [], "Bread & Bakery": [],
    "Frozen Food": [], "Fruits & Vegetables": [], "Meat & Fish": [], "Baby Products": [], "Personal Care": [], "Household & Cleaning": [], "Other": []
  },
  cosmetics: {
    "Skin Care": ["Cleansers", "Moisturizers", "Serums", "Masks", "Toners"], "Hair Care": ["Shampoo", "Conditioner", "Hair Oil", "Hair Color", "Styling"],
    "Makeup": ["Face", "Eyes", "Lips", "Nails"], "Fragrances & Perfumes": ["Perfume", "Body Mist", "Oud & Incense", "Deodorant"],
    "Body Care": ["Lotion", "Body Wash", "Soap", "Scrubs"], "Men's Grooming": [], "Oral Care": [], "Sun Care": [], "Beauty Tools & Accessories": [], "Other": []
  },
  pharmacy: {
    "Analgesics & Pain Relief": [], "Antibiotics": [], "Antimalarials": [], "Antihypertensives": [], "Antidiabetics": [], "Vitamins & Supplements": [],
    "Cough, Cold & Flu": [], "Gastrointestinal": [], "Antifungals": [], "Antihistamines & Allergy": [], "Dermatology": [], "Eye & Ear Care": [],
    "Medical Supplies & Devices": [], "Baby & Mother Care": [], "First Aid": [], "Other": []
  },
  electronics: {
    "Phones": ["Smartphones", "Feature Phones"], "Tablets": [], "Laptops & Computers": ["Laptops", "Desktops"], "Monitors & Printers": ["Monitors", "Printers"],
    "Computer Accessories": ["Keyboards", "Mice", "Webcams"], "Chargers & Cables": ["Chargers", "USB Cables", "Network Cables"],
    "Audio": ["Headphones", "Earphones", "Speakers"], "Power Banks": [], "Networking": ["Routers", "Switches"], "Storage & Memory": ["Flash Drives", "Memory Cards", "Hard Drives"],
    "POS Equipment": ["Barcode Scanners", "Receipt Printers", "Thermal Paper"], "Computer Components": [], "Electronic Accessories": ["Screen Protectors", "Cases & Covers", "Batteries"], "Other": []
  },
  fashion: {
    "Men's Clothing": ["Shirts", "T-Shirts", "Trousers", "Jeans", "Suits", "Jackets", "Kamis / Thobe", "Macawis", "Underwear", "Sportswear"],
    "Women's Clothing": ["Dresses", "Abayas", "Jilbab", "Hijabs", "Dirac", "Garbasaar", "Skirts", "Blouses", "Trousers", "Nightwear"],
    "Children's Clothing": ["Baby Clothes", "Boys", "Girls", "School Wear"],
    "Shoes": ["Men's Shoes", "Women's Shoes", "Children's Shoes", "Sandals", "Sneakers", "Slippers", "Boots"],
    "Bags and Handbags": ["Handbags", "Backpacks", "Wallets", "Travel Bags"],
    "Fashion Accessories": ["Belts", "Watches", "Sunglasses", "Jewelry", "Scarves", "Caps & Hats"],
    "Fabrics and Sewing Materials": ["Cotton", "Silk", "Chiffon", "Linen", "Thread", "Buttons & Zippers"],
    "Uniforms": ["School Uniforms", "Work Uniforms", "Medical Uniforms", "Security Uniforms"],
    "Other": []
  },
  jewelry: {
    "Gold": ["Rings", "Necklaces", "Earrings", "Bracelets", "Bangles", "Sets"], "Silver": ["Rings", "Necklaces", "Earrings", "Bracelets"],
    "Fashion Jewelry": [], "Watches": [], "Gemstones": [], "Men's Jewelry": [], "Children's Jewelry": [], "Other": []
  },
  fabric: {
    "Cotton": [], "Silk": [], "Chiffon": [], "Linen": [], "Polyester": [], "Wool": [], "Lace": [], "Velvet": [], "Satin": [], "Denim": [],
    "Sewing Materials": ["Thread", "Buttons", "Zippers", "Needles", "Elastic"], "Other": []
  }
};

const SIZE_SYSTEMS = {
  "Letter (XXS–4XL)": ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"],
  "Numeric (clothing)": ["26", "28", "30", "32", "34", "36", "38", "40", "42", "44", "46", "48", "50", "52"],
  "Children": ["0–3M", "3–6M", "6–12M", "12–18M", "18–24M", "2Y", "3Y", "4Y", "5Y", "6Y", "7Y", "8Y", "10Y", "12Y", "14Y"],
  "Shoes EU": ["19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "47"],
  "Shoes UK": ["3", "3.5", "4", "4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "12"],
  "Shoes US": ["5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "13"],
  "One size": ["One size"]
};
const COLORS = [["Black", "#111111"], ["White", "#ffffff"], ["Grey", "#8a8f98"], ["Navy", "#1f2a5a"], ["Blue", "#2563eb"], ["Sky Blue", "#7cc4f4"],
  ["Red", "#dc2626"], ["Maroon", "#7f1d1d"], ["Pink", "#f472b6"], ["Purple", "#7c3aed"], ["Green", "#16a34a"], ["Olive", "#6b7a2a"], ["Yellow", "#facc15"],
  ["Orange", "#f97316"], ["Brown", "#7c4a1e"], ["Beige", "#e8d8b8"], ["Cream", "#f7efd9"], ["Khaki", "#bfae7a"], ["Gold", "#d4a017"], ["Silver", "#c0c4cc"],
  ["Multicolor", null]];

const PROFILES = {
  // the standard interface, with its own units (e.g. 2.5 kg of rice, a carton of drinks)
  supermarket: {
    key: "supermarket",
    units: ["pcs", "kg", "g", "liter", "pack", "carton"],
    categories: CATEGORIES.supermarket
  },
  fashion: {
    key: "fashion",
    // size, colour, fabric type and width; a category uses only the ones it needs (categoryVariants)
    variants: ["size", "shade", "formula", "packSize"],
    variantGroups: true,
    labels: { shade: "color", formula: "fabricType", packSize: "width", costPrice: "purchasePrice", lowStockAlert: "minStockLevel", lowStockShort: "minStockLevel" },
    units: ["pcs", "pair", "set", "pack", "box", "carton", "meter", "roll", "spool"],
    packaging: true,                         // e.g. 1 carton = 12 pieces (purchase / sales units)
    fashion: true,
    categories: CATEGORIES.fashion,
    sizeSystems: SIZE_SYSTEMS,
    categorySizes: { "Men's Clothing": "Letter (XXS–4XL)", "Women's Clothing": "Letter (XXS–4XL)", "Children's Clothing": "Children", "Shoes": "Shoes EU",
      "Uniforms": "Letter (XXS–4XL)", "Bags and Handbags": "One size", "Fashion Accessories": "One size" },
    colors: COLORS,
    categoryVariants: {
      "Men's Clothing": ["size", "shade"], "Women's Clothing": ["size", "shade"], "Children's Clothing": ["size", "shade"], "Shoes": ["size", "shade"],
      "Bags and Handbags": ["shade"], "Fashion Accessories": ["shade", "formula"], "Fabrics and Sewing Materials": ["shade", "formula", "packSize"],
      "Uniforms": ["size", "shade"]
    }
  },
  jewelry: {
    key: "jewelry",
    variants: ["size"],                       // ring / bangle size
    labels: { subcategory: "itemType" },
    units: ["pcs", "pair", "set", "g"],
    jewelry: true,
    categories: CATEGORIES.jewelry,
    metals: ["gold", "silver"],
    purities: { gold: ["24K", "22K", "21K", "18K", "14K"], silver: ["999", "925", "900"] }
  },
  fabric: { key: "fabric", categories: CATEGORIES.fabric },
  cosmetics: {
    key: "cosmetics",
    variants: ["size"],
    extraBarcodes: true,
    batches: true,
    expirySoonDays: 90,
    labels: { costPrice: "purchaseCost", sellingPrice: "retailPrice", lowStockAlert: "reorderLevel", lowStockShort: "reorderLevel" },
    categories: CATEGORIES.cosmetics,
    // e.g. 1 bottle, or 1 carton of 12 bottles (packaging barcode: carton × 12)
    units: ["pcs", "bottle", "tube", "box", "carton"],
    hiddenFields: ["description"]
  },
  pharmacy: {
    key: "pharmacy",
    variants: ["size"],                       // shown as Strength, e.g. Paracetamol 500 mg
    extraBarcodes: false,
    batches: true,
    expirySoonDays: 180,
    labels: { size: "strength", brand: "brandName", category: "therapeuticCategory", unit: "baseUnit",
      costPrice: "purchaseCostBase", sellingPrice: "sellingPriceBase", lowStockAlert: "reorderLevel", lowStockShort: "reorderLevel" },
    units: ["tablet", "capsule", "bottle", "ml", "tube", "sachet", "ampoule", "vial", "pcs"],
    hiddenFields: ["description", "subcategory", "wholesalePrice"],
    medicine: true,
    packaging: true,
    purchaseOrders: true,
    categories: CATEGORIES.pharmacy
  },
  electronics: {
    key: "electronics",
    variants: ["size"],                       // shown as Variant, e.g. Galaxy A16 8GB/256GB Black
    variantGroups: true,
    extraBarcodes: false,
    batches: false,
    labels: { size: "variant", costPrice: "purchaseCost", sellingPrice: "retailPrice", lowStockAlert: "reorderLevel", lowStockShort: "reorderLevel" },
    units: ["pcs", "pack", "box", "roll", "meter"],
    hiddenFields: [],
    purchaseOrders: true,
    electronics: true,
    serials: true,
    warranties: true,
    categories: CATEGORIES.electronics
  }
};

export function profileFor(type) {
  return { ...DEFAULT, ...(PROFILES[type] || {}) };
}
