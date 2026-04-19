import type { CustomerPriceLevel, InvProduct, PosCustomer, PriceSource } from '../../lib/types';
import { round2, toNum } from '../../lib/utils';

export interface ResolvedProductPricing {
  selectedPriceLevel: CustomerPriceLevel;
  appliedPriceLevel: CustomerPriceLevel;
  priceSource: PriceSource;
  retailUnitPrice: number;
  unitPrice: number;
}

export interface PricingContext {
  customer?: PosCustomer | null;
  snapshotPriceLevel?: string | null;
}

export interface ResolvedCartLinePricing extends ResolvedProductPricing {
  originalUnitPrice: number;
  subtotal: number;
}

export function normalizeCustomerPriceLevel(priceLevel?: string | null): CustomerPriceLevel {
  if (priceLevel === 'Wholesale' || priceLevel === 'Special') return priceLevel;
  return 'Retail';
}

export function getActiveCustomerPriceLevel(customer?: PosCustomer | null, snapshotPriceLevel?: string | null): CustomerPriceLevel {
  return normalizeCustomerPriceLevel(customer?.price_level ?? snapshotPriceLevel);
}

export function getRetailPrice(product: InvProduct): number {
  return round2(toNum(product.retail_price ?? product.selling_price));
}

function getFallbackPriceSource(selectedPriceLevel: Exclude<CustomerPriceLevel, 'Retail'>): Extract<
  PriceSource,
  'Retail (Wholesale fallback)' | 'Retail (Special fallback)'
> {
  return selectedPriceLevel === 'Wholesale'
    ? 'Retail (Wholesale fallback)'
    : 'Retail (Special fallback)';
}

export function resolveProductPricing(
  product: InvProduct,
  customer?: PosCustomer | null,
  snapshotPriceLevel?: string | null,
): ResolvedProductPricing {
  const selectedPriceLevel = getActiveCustomerPriceLevel(customer, snapshotPriceLevel);
  const retailUnitPrice = getRetailPrice(product);
  const wholesalePrice = round2(toNum(product.wholesale_price));
  const specialPrice = round2(toNum(product.special_price));

  if (selectedPriceLevel !== 'Retail') {
    const selectedUnitPrice = selectedPriceLevel === 'Wholesale' ? wholesalePrice : specialPrice;
    if (selectedUnitPrice > 0) {
      return {
        selectedPriceLevel,
        appliedPriceLevel: selectedPriceLevel,
        priceSource: selectedPriceLevel,
        retailUnitPrice,
        unitPrice: selectedUnitPrice,
      };
    }
    return {
      selectedPriceLevel,
      appliedPriceLevel: 'Retail',
      priceSource: getFallbackPriceSource(selectedPriceLevel),
      retailUnitPrice,
      unitPrice: retailUnitPrice,
    };
  }

  return {
    selectedPriceLevel: 'Retail',
    appliedPriceLevel: 'Retail',
    priceSource: 'Retail',
    retailUnitPrice,
    unitPrice: retailUnitPrice,
  };
}

export function resolveCartLinePricing(
  product: InvProduct,
  context?: PricingContext,
  line?: { qty?: number; discountAmount?: number },
): ResolvedCartLinePricing {
  const pricing = resolveProductPricing(product, context?.customer, context?.snapshotPriceLevel);
  const unitPrice = round2(toNum(pricing.unitPrice));
  const qty = toNum(line?.qty ?? 1);
  const discountAmount = round2(toNum(line?.discountAmount));

  return {
    ...pricing,
    unitPrice,
    originalUnitPrice: unitPrice,
    subtotal: round2(Math.max(0, qty * unitPrice - discountAmount)),
  };
}
