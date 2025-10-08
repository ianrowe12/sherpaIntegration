import {OPENFOODFACTS_HOST} from '@env';

// Types kept minimal to requested fields; OFF may return much more
export type OffProduct = {
  code?: string;
  product_name?: string;
  brands?: string;
  quantity?: string;
  image_front_url?: string;
  categories_tags?: string[];
  labels_tags?: string[];
  allergens?: string;
  allergens_tags?: string[];
  ingredients_text?: string;
  nutrition_grades?: string; // historical
  nutriscore_data?: Record<string, any> | null;
  nova_group?: number | null;
  nutriments?: Record<string, number | string>;
  [key: string]: any;
};

export type OffSearchResult = {
  count?: number;
  page?: number;
  page_size?: number;
  products: OffProduct[];
  [key: string]: any;
};

const DEFAULT_FIELDS = [
  'code',
  'product_name',
  'brands',
  'quantity',
  'image_front_url',
  'categories_tags',
  'labels_tags',
  'allergens',
  'allergens_tags',
  'ingredients_text',
  'nutrition_grades',
  'nutriscore_data',
  'nova_group',
  'nutriments',
] as const;

const UA = 'PocketPalAI/0.1 (contact@email)';

const resolveHost = () => {
  const envHost = (OPENFOODFACTS_HOST || '').trim();
  if (envHost) return envHost;
  return __DEV__ ? 'world.openfoodfacts.net' : 'world.openfoodfacts.org';
};

const baseUrls = () => {
  const host = resolveHost();
  return {
    PRODUCT_V2: `https://${host}/api/v2/product/`,
    SEARCH_V1: `https://${host}/cgi/search.pl?json=1`,
  };
};

type FetchOptions = {
  method?: 'GET';
  headers?: Record<string, string>;
};

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

let LAST_OFF_URL = '';

async function fetchWithBackoff(url: string, options: FetchOptions = {}) {
  const headers = {
    'Accept': 'application/json',
    'User-Agent': UA,
    ...(options.headers || {}),
  } as Record<string, string>;

  let attempt = 0;
  const maxAttempts = 3;
  let lastError: any;

  while (attempt < maxAttempts) {
    LAST_OFF_URL = url;
    const resp = await fetch(url, {method: 'GET', headers});
    if (resp.status === 429) {
      const retryAfter = resp.headers.get('retry-after');
      let backoffMs = retryAfter ? Number(retryAfter) * 1000 : 300 * Math.pow(2, attempt);
      if (!Number.isFinite(backoffMs) || backoffMs <= 0) backoffMs = 300 * Math.pow(2, attempt);
      attempt += 1;
      if (attempt >= maxAttempts) {
        throw new Error(`OpenFoodFacts rate limited (429) after ${attempt} attempts`);
      }
      await delay(backoffMs);
      continue;
    }
    if (!resp.ok) {
      lastError = new Error(`OpenFoodFacts request failed: ${resp.status}`);
      break;
    }
    return resp.json();
  }

  throw lastError || new Error('OpenFoodFacts request failed');
}

function toFieldsCsv(fields?: string[]) {
  const list = (fields && fields.length > 0 ? fields : DEFAULT_FIELDS as unknown as string[]);
  return encodeURIComponent(list.join(','));
}

export async function getProductByBarcode(
  code: string,
  fields?: string[],
): Promise<OffProduct> {
  const {PRODUCT_V2} = baseUrls();
  const fieldsCsv = toFieldsCsv(fields);
  const url = `${PRODUCT_V2}${encodeURIComponent(code)}?fields=${fieldsCsv}`;
  const data = await fetchWithBackoff(url);
  // v2 returns { product, status } or 404
  if (data && data.product) return data.product as OffProduct;
  throw new Error('Product not found');
}

export async function searchProducts(
  q: string,
  fields?: string[],
  pageSize = 5,
): Promise<OffSearchResult> {
  const {SEARCH_V1} = baseUrls();
  const fieldsCsv = toFieldsCsv(fields);
  const url = `${SEARCH_V1}&search_terms=${encodeURIComponent(q)}&page_size=${pageSize}&fields=${fieldsCsv}`;
  const data = await fetchWithBackoff(url);
  // v1 returns { products: [], count, page, page_size, ... }
  const products = Array.isArray(data?.products) ? (data.products as OffProduct[]) : [];
  return {
    count: typeof data?.count === 'number' ? data.count : undefined,
    page: typeof data?.page === 'number' ? data.page : undefined,
    page_size: typeof data?.page_size === 'number' ? data.page_size : pageSize,
    products,
    ...data,
  } as OffSearchResult;
}

export function isLikelyBarcode(input: string): {
  code?: string;
  type: 'ean8' | 'upca' | 'ean13' | 'ean14' | null;
} {
  const digits = (input || '').replace(/\D+/g, '');
  if (!digits) return {type: null};
  switch (digits.length) {
    case 8:
      return {code: digits, type: 'ean8'};
    case 12:
      return {code: digits, type: 'upca'};
    case 13:
      return {code: digits, type: 'ean13'};
    case 14:
      return {code: digits, type: 'ean14'};
    default:
      return {type: null};
  }
}

export function getLastOffUrl() {
  return LAST_OFF_URL;
}


