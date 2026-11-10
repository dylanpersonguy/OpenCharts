/**
 * Public surface of the compliance module.
 *
 * The three symbols the terminal integration imports:
 *   ComplianceGate, MarketRiskBadge, useMarketRiskNotice
 * Plus the small hooks the integrator wires (see docs/COMPLIANCE_CHECKLIST.md).
 */
export { ComplianceGate } from "./ComplianceGate.tsx";
export { MarketRiskBadge } from "./MarketRiskBadge.tsx";
export { useMarketRiskNotice, registerMarketLookup, type MarketRiskNotice } from "./riskNotice.ts";
export { screenAddress, isAddressBlocked, setAddressScreener, type AddressScreener } from "./screen.ts";
export { TERMS_VERSION } from "./config.ts";
