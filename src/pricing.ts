/** 价目表：元/百万 token。键 "provider/model" 优先，其次裸 "model"；缺价目只报 token 不报钱。 */

export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export type Prices = Record<string, Partial<Price>>;

export function priceFor(prices: Prices, provider: string, model: string): Price | null {
  const hit = prices[`${provider}/${model}`] ?? prices[model];
  if (!hit) return null;
  return {
    input: Number(hit.input) || 0,
    output: Number(hit.output) || 0,
    cacheRead: Number(hit.cacheRead) || 0,
    cacheWrite: Number(hit.cacheWrite) || 0,
  };
}

/** tokens × 元/Mtok → 元；无价目返回 null。 */
export function costOf(tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }, price: Price | null): number | null {
  if (!price) return null;
  return (tokens.input * price.input + tokens.output * price.output + tokens.cacheRead * price.cacheRead + tokens.cacheWrite * price.cacheWrite) / 1e6;
}
