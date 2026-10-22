// Portaldot V3 value units — measured against the live testnet (see docs/AUDIT_REPORT §H-01).
//
// Native POT has 14 decimals (Substrate `system_properties.tokenDecimals`), but the EVM
// layer (pallet-revive eth-rpc) exposes balances and msg.value scaled to 18 decimals:
//   evmWei = planck * 10^4
// Every on-chain amount (denominations, fees, extAmount) is therefore 18-decimal EVM wei.

export const EVM_DECIMALS = 18;
export const NATIVE_DECIMALS = 14;
export const NATIVE_TO_EVM_RATIO = 10n ** BigInt(EVM_DECIMALS - NATIVE_DECIMALS); // 10^4

/**
 * Existential deposit observed on V3 testnet: 0.1 tPOT. A brand-new account cannot be
 * created with less, so withdrawals of less than this to a fresh address revert (audit L-03).
 */
export const EXISTENTIAL_DEPOSIT_WEI = 10n ** 17n;

export function toEvmWei(tpot: string): bigint {
  const [whole, frac = ""] = tpot.trim().split(".");
  if (frac.length > NATIVE_DECIMALS) throw new Error(`max ${NATIVE_DECIMALS} decimal places`);
  return BigInt(whole || "0") * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18));
}

/** Amounts with sub-native precision are tracked as "dust" by pallet-revive; avoid them. */
export function isNativePrecision(evmWei: bigint): boolean {
  return evmWei % NATIVE_TO_EVM_RATIO === 0n;
}
