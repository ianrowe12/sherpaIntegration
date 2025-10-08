import {
  getProductByBarcode,
  searchProducts,
  isLikelyBarcode,
  OffProduct,
} from './api';

export type OffAnswer = {
  type: 'single' | 'list';
  products: Array<{
    code: string;
    name: string;
    brand?: string;
    quantity?: string;
    image?: string;
    nutriScore?: string; // a-e
    novaGroup?: number; // 1-4
    nutriments?: {
      energyKcal_100g?: number;
      protein_100g?: number;
      carbs_100g?: number;
      sugars_100g?: number;
      fat_100g?: number;
      satFat_100g?: number;
      salt_100g?: number;
      fiber_100g?: number;
    };
    allergens?: string[];
    offUrl?: string;
  }>;
  meta: {source: 'OFF'; query: string};
};

const pickNumber = (obj: any, key: string): number | undefined => {
  const v = obj?.[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return undefined;
};

const normalizeProduct = (p: OffProduct) => {
  const nutr = p.nutriments || {};
  // OFF often uses these exact keys
  const energyKcal =
    pickNumber(nutr, 'energy-kcal_100g') ??
    pickNumber(nutr, 'energy_kcal_100g') ??
    pickNumber(nutr, 'energy-kcal_value');

  const brand = (p.brands || '').split(',').map(s => s.trim()).filter(Boolean)[0];
  const allergensArr: string[] = Array.isArray(p.allergens_tags)
    ? (p.allergens_tags as string[])
    : (p.allergens || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

  return {
    code: p.code || '',
    name: p.product_name || '',
    brand: brand || undefined,
    quantity: p.quantity || undefined,
    image: p.image_front_url || undefined,
    nutriScore: (p.nutrition_grades || '') || undefined,
    novaGroup: (typeof p.nova_group === 'number' ? p.nova_group : undefined) as
      | number
      | undefined,
    nutriments: {
      energyKcal_100g: energyKcal,
      protein_100g: pickNumber(nutr, 'proteins_100g'),
      carbs_100g: pickNumber(nutr, 'carbohydrates_100g'),
      sugars_100g: pickNumber(nutr, 'sugars_100g'),
      fat_100g: pickNumber(nutr, 'fat_100g'),
      satFat_100g: pickNumber(nutr, 'saturated-fat_100g'),
      salt_100g: pickNumber(nutr, 'salt_100g'),
      fiber_100g: pickNumber(nutr, 'fiber_100g'),
    },
    allergens: allergensArr.length ? allergensArr : undefined,
    offUrl: p.code ? `https://world.openfoodfacts.org/product/${p.code}` : undefined,
  };
};

export async function routeToOff(message: string): Promise<OffAnswer> {
  const query = (message || '').trim();
  const barcode = isLikelyBarcode(query);

  if (barcode.type && barcode.code) {
    try {
      const product = await getProductByBarcode(barcode.code);
      const normalized = normalizeProduct(product);
      return {
        type: 'single',
        products: [normalized],
        meta: {source: 'OFF', query},
      };
    } catch (_e) {
      // Not found or error → fall through to return empty list
      return {
        type: 'single',
        products: [],
        meta: {source: 'OFF', query},
      };
    }
  }

  // Textual search (limit handled by API default arg 5)
  const result = await searchProducts(query, undefined, 5);
  const items = (result.products || []).slice(0, 5).map(normalizeProduct);
  return {
    type: 'list',
    products: items,
    meta: {source: 'OFF', query},
  };
}


