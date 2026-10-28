import { RELAYER_URL } from "./chain";
import { readStored, storeKey, writeStored } from "./store";

export type CheckoutProduct = { id: string; name: string; description: string; amount: string; to: string; asset: { id: number; symbol: string; decimals: number }; chainId: number; pool: string };
export type CheckoutOrder = { id: string; productId: string; created: number; status: "awaiting" | "paid"; blinding: string; commitment: string; encryptedOutput: string; block?: number };
export type Merchant = { product: CheckoutProduct; token: string };
export const merchantKey = storeKey("checkout-merchants");
export const merchants = (): Merchant[] => {
  const stored = readStored<unknown>(merchantKey, []);
  return Array.isArray(stored) ? stored.filter((m): m is Merchant =>
    /^[a-f0-9]{64}$/.test(m?.product?.id ?? "") && /^[a-f0-9]{64}$/.test(m?.token ?? "") && typeof m?.product?.name === "string"
  ) : [];
};
export function saveMerchant(m: Merchant) { writeStored(merchantKey, [...merchants().filter(x => x.product.id !== m.product.id), m]); }
export const checkoutUrl = (id: string) => `${location.origin}${location.pathname}?checkout=${id}`;
export async function checkoutApi<T>(path: string, body?: unknown, token?: string): Promise<T> {
  if (!RELAYER_URL) throw new Error("Checkout server is not configured.");
  const r = await fetch(`${RELAYER_URL.replace(/\/$/, "")}/checkout${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error || "Checkout server is unavailable. Please retry.");
  if (data === null) throw new Error("Checkout returned an unreadable response. Please retry.");
  return data;
}
export async function downloadOrder(id: string) {
  const r = await fetch(`${RELAYER_URL.replace(/\/$/, "")}/checkout/orders/${id}/download`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error("Download is unavailable. Verify your payment and retry.");
  downloadBlob(await r.blob(), "umbra-purchase.txt");
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
