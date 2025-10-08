import {getProductByBarcode, searchProducts, isLikelyBarcode} from '../src/off/api';

const mockFetch = global.fetch as jest.Mock;

describe('OFF API', () => {
  beforeEach(() => {
    mockFetch?.mockReset?.();
    // @ts-ignore
    global.fetch = jest.fn();
  });

  it('isLikelyBarcode should classify common lengths', () => {
    expect(isLikelyBarcode('12345678').type).toBe('ean8');
    expect(isLikelyBarcode('036000291452').type).toBe('upca');
    expect(isLikelyBarcode('5901234123457').type).toBe('ean13');
    expect(isLikelyBarcode('12345678901234').type).toBe('ean14');
    expect(isLikelyBarcode('abc').type).toBeNull();
  });

  it('getProductByBarcode returns product with default fields', async () => {
    const product = {code: '737628064502', product_name: 'Cereal'};
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: {get: () => null},
      json: async () => ({product}),
    });

    const res = await getProductByBarcode('737628064502');
    expect(res.code).toBe('737628064502');
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toMatch('/api/v2/product/737628064502');
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toMatch('fields=');
  });

  it('searchProducts returns products list', async () => {
    const products = [
      {code: '5000159484695', product_name: 'Kit Kat'},
      {code: '3017620422003', product_name: 'Nutella'},
    ];
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      headers: {get: () => null},
      json: async () => ({products, count: 2, page: 1, page_size: 2}),
    });

    const res = await searchProducts('chocolate', undefined, 2);
    expect(res.products.length).toBe(2);
    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toMatch('/cgi/search.pl?json=1');
    expect(url).toMatch('search_terms=');
    expect(url).toMatch('page_size=2');
    expect(url).toMatch('fields=');
  });

  it('getProductByBarcode retries on 429 and eventually fails', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ok: false, status: 429, headers: {get: () => null}})
      .mockResolvedValueOnce({ok: false, status: 429, headers: {get: () => null}})
      .mockResolvedValueOnce({ok: false, status: 429, headers: {get: () => null}});

    await expect(getProductByBarcode('00000000')).rejects.toBeTruthy();
  });
});


