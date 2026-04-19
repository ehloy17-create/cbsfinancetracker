import { supabase } from './supabase';
import type {
  CustomerPriceLevel,
  InvProduct,
  InvProductSellingUnit,
  InvProductUnitConversion,
  InvUnit,
  PriceSource,
} from './types';
import { round2, toNum } from './utils';

export interface ProductUnitBundle {
  productId: string;
  baseUnitId: string | null;
  baseUnitName: string;
  baseUnitCode: string;
  defaultPurchaseUnitId: string | null;
  defaultPurchaseUnitName: string;
  defaultPurchaseUnitCode: string;
  defaultSellingUnitId: string | null;
  defaultSellingUnitName: string;
  defaultSellingUnitCode: string;
  conversions: InvProductUnitConversion[];
  sellingUnits: InvProductSellingUnit[];
}

export interface ResolvedSellingUnit {
  selectedUnitId: string | null;
  selectedUnitName: string;
  qtyInBaseUnitPerUnit: number;
  totalBaseQty: number;
  retailUnitPrice: number;
  legacyWholesaleUnitPrice: number;
  specialUnitPrice: number;
  unitPrice: number;
  computedLineTotal: number;
  wholesaleEnabled: boolean;
  wholesaleBreakQtyInBaseUnit: number;
  wholesaleBlockPrice: number;
  wholesaleBlocksApplied: number;
  wholesaleBaseQtyApplied: number;
  retailRemainderBaseQty: number;
  pricingBreakdown: string;
  selectedPriceLevel: CustomerPriceLevel;
  appliedPriceLevel: CustomerPriceLevel;
  priceSource: PriceSource;
  baseUnitName: string;
  missingPriceLevel: CustomerPriceLevel | null;
  validationError: string | null;
}

export interface QuantityBreakPricingResult {
  lineTotal: number;
  effectiveUnitPrice: number;
  wholesaleEnabled: boolean;
  wholesaleBreakQtyInBaseUnit: number;
  wholesaleBlockPrice: number;
  wholesaleBlocksApplied: number;
  wholesaleBaseQtyApplied: number;
  retailRemainderBaseQty: number;
  pricingBreakdown: string;
}

export interface ResolvedUnitPriceRule extends QuantityBreakPricingResult {
  unitPrice: number;
  computedLineTotal: number;
  appliedPriceLevel: CustomerPriceLevel;
  priceSource: PriceSource;
  missingPriceLevel: CustomerPriceLevel | null;
  validationError: string | null;
}

export interface ResolveSellingUnitPricingOptions {
  lockSelectedPriceLevel?: boolean;
  strictSelectedPriceLevel?: boolean;
}

interface UnitRow extends InvUnit {
  abbreviation?: string;
}

function normalizePriceLevel(priceLevel?: string | null): CustomerPriceLevel {
  if (priceLevel === 'Wholesale' || priceLevel === 'Special') return priceLevel;
  return 'Retail';
}

function preferredUnitName(unit?: UnitRow | null): string {
  return String(unit?.abbreviation ?? unit?.short_name ?? unit?.code ?? unit?.name ?? '').trim();
}

function formatBaseQtyLabel(value: number, baseUnitName: string): string {
  const qty = toNum(value);
  const normalized = Number.isInteger(qty) ? String(qty) : qty.toFixed(6).replace(/\.?0+$/, '');
  return baseUnitName ? `${normalized} ${baseUnitName}` : normalized;
}

function coerceSellingUnit(product: InvProduct, row: InvProductSellingUnit): InvProductSellingUnit {
  const retail = round2(toNum(row.retail_price ?? row.selling_price ?? product.retail_price ?? product.selling_price));
  return {
    ...row,
    qty_in_base_unit: toNum(row.qty_in_base_unit) || 1,
    retail_price: retail,
    selling_price: retail,
    wholesale_price: round2(toNum(row.wholesale_price)),
    special_price: round2(toNum(row.special_price)),
    wholesale_enabled: Boolean(row.wholesale_enabled),
    wholesale_break_qty_in_base_unit: toNum(row.wholesale_break_qty_in_base_unit),
    wholesale_block_price: round2(toNum(row.wholesale_block_price)),
    is_default: Boolean(row.is_default),
  };
}

export function computeQuantityBreakPricing(params: {
  qty: number;
  qtyInBaseUnitPerUnit: number;
  retailUnitPrice: number;
  baseUnitName?: string;
  wholesaleEnabled?: boolean;
  wholesaleBreakQtyInBaseUnit?: number;
  wholesaleBlockPrice?: number;
}): QuantityBreakPricingResult {
  const qty = toNum(params.qty);
  const qtyInBaseUnitPerUnit = toNum(params.qtyInBaseUnitPerUnit) || 1;
  const retailUnitPrice = round2(toNum(params.retailUnitPrice));
  const wholesaleEnabled = Boolean(params.wholesaleEnabled);
  const wholesaleBreakQtyInBaseUnit = toNum(params.wholesaleBreakQtyInBaseUnit);
  const wholesaleBlockPrice = round2(toNum(params.wholesaleBlockPrice));
  const totalBaseQty = computeBaseQuantity(qty, qtyInBaseUnitPerUnit);

  if (!wholesaleEnabled || wholesaleBreakQtyInBaseUnit <= 0 || wholesaleBlockPrice <= 0 || qty <= 0) {
    return {
      lineTotal: round2(qty * retailUnitPrice),
      effectiveUnitPrice: retailUnitPrice,
      wholesaleEnabled: wholesaleEnabled && wholesaleBreakQtyInBaseUnit > 0 && wholesaleBlockPrice > 0,
      wholesaleBreakQtyInBaseUnit,
      wholesaleBlockPrice,
      wholesaleBlocksApplied: 0,
      wholesaleBaseQtyApplied: 0,
      retailRemainderBaseQty: totalBaseQty,
      pricingBreakdown: '',
    };
  }

  const retailPricePerBaseUnit = retailUnitPrice / qtyInBaseUnitPerUnit;
  const wholesaleBlocksApplied = Math.floor(totalBaseQty / wholesaleBreakQtyInBaseUnit);
  const wholesaleBaseQtyApplied = wholesaleBlocksApplied * wholesaleBreakQtyInBaseUnit;
  const retailRemainderBaseQty = Math.max(0, totalBaseQty - wholesaleBaseQtyApplied);
  const lineTotal = round2(
    wholesaleBlocksApplied * wholesaleBlockPrice +
    retailRemainderBaseQty * retailPricePerBaseUnit
  );
  const parts: string[] = [];
  if (wholesaleBaseQtyApplied > 0) {
    parts.push(`${formatBaseQtyLabel(wholesaleBaseQtyApplied, params.baseUnitName ?? '')} wholesale`);
  }
  if (retailRemainderBaseQty > 0) {
    parts.push(`${formatBaseQtyLabel(retailRemainderBaseQty, params.baseUnitName ?? '')} retail`);
  }

  return {
    lineTotal,
    effectiveUnitPrice: qty > 0 ? round2(lineTotal / qty) : retailUnitPrice,
    wholesaleEnabled: true,
    wholesaleBreakQtyInBaseUnit,
    wholesaleBlockPrice,
    wholesaleBlocksApplied,
    wholesaleBaseQtyApplied: round2(wholesaleBaseQtyApplied),
    retailRemainderBaseQty: round2(retailRemainderBaseQty),
    pricingBreakdown: parts.join(' + '),
  };
}

export function resolveUnitPriceRule(params: {
  qty: number;
  qtyInBaseUnitPerUnit: number;
  retailUnitPrice: number;
  wholesaleUnitPrice?: number;
  specialUnitPrice?: number;
  baseUnitName?: string;
  wholesaleEnabled?: boolean;
  wholesaleBreakQtyInBaseUnit?: number;
  wholesaleBlockPrice?: number;
  selectedPriceLevel?: string | null;
  lockSelectedPriceLevel?: boolean;
  strictSelectedPriceLevel?: boolean;
}): ResolvedUnitPriceRule {
  const qty = toNum(params.qty);
  const qtyInBaseUnitPerUnit = toNum(params.qtyInBaseUnitPerUnit) || 1;
  const retailUnitPrice = round2(toNum(params.retailUnitPrice));
  const wholesaleUnitPrice = round2(toNum(params.wholesaleUnitPrice));
  const specialUnitPrice = round2(toNum(params.specialUnitPrice));
  const selectedPriceLevel = normalizePriceLevel(params.selectedPriceLevel);
  const lockSelectedPriceLevel = Boolean(params.lockSelectedPriceLevel);
  const strictSelectedPriceLevel = Boolean(params.strictSelectedPriceLevel);
  const quantityBreakPricing = computeQuantityBreakPricing({
    qty,
    qtyInBaseUnitPerUnit,
    retailUnitPrice,
    baseUnitName: params.baseUnitName,
    wholesaleEnabled: params.wholesaleEnabled,
    wholesaleBreakQtyInBaseUnit: params.wholesaleBreakQtyInBaseUnit,
    wholesaleBlockPrice: params.wholesaleBlockPrice,
  });
  const totalBaseQty = computeBaseQuantity(qty, qtyInBaseUnitPerUnit);
  const wholesalePackageQtyInBaseUnit = round2(toNum(params.wholesaleBreakQtyInBaseUnit));
  const qualifiesWholesaleQty =
    quantityBreakPricing.wholesaleBreakQtyInBaseUnit > 0 &&
    wholesaleUnitPrice > 0 &&
    totalBaseQty >= quantityBreakPricing.wholesaleBreakQtyInBaseUnit;
  const missingPriceLevel =
    selectedPriceLevel === 'Retail'
      ? retailUnitPrice <= 0
      : selectedPriceLevel === 'Wholesale'
        ? wholesaleUnitPrice <= 0
        : specialUnitPrice <= 0;

  if (lockSelectedPriceLevel) {
    if (selectedPriceLevel === 'Wholesale') {
      if (strictSelectedPriceLevel && wholesaleUnitPrice <= 0) {
        return {
          ...quantityBreakPricing,
          unitPrice: 0,
          computedLineTotal: 0,
          appliedPriceLevel: 'Wholesale',
          priceSource: 'Wholesale',
          missingPriceLevel: 'Wholesale',
          validationError: 'No wholesale price set',
        };
      }
      if (strictSelectedPriceLevel && wholesalePackageQtyInBaseUnit <= 0) {
        return {
          ...quantityBreakPricing,
          unitPrice: 0,
          computedLineTotal: 0,
          appliedPriceLevel: 'Wholesale',
          priceSource: 'Wholesale',
          missingPriceLevel: null,
          validationError: 'No wholesale minimum quantity set',
        };
      }
      if (quantityBreakPricing.wholesaleBlocksApplied > 0) {
        return {
          ...quantityBreakPricing,
          unitPrice: quantityBreakPricing.effectiveUnitPrice,
          computedLineTotal: quantityBreakPricing.lineTotal,
          appliedPriceLevel: 'Wholesale',
          priceSource: quantityBreakPricing.retailRemainderBaseQty > 0 ? 'Wholesale break + Retail' : 'Wholesale break',
          missingPriceLevel: null,
          validationError: null,
        };
      }
      if (qualifiesWholesaleQty) {
        return {
          ...quantityBreakPricing,
          unitPrice: wholesaleUnitPrice,
          computedLineTotal: round2(qty * wholesaleUnitPrice),
          appliedPriceLevel: 'Wholesale',
          priceSource: 'Wholesale qty',
          missingPriceLevel: null,
          validationError: null,
        };
      }
      return {
        ...quantityBreakPricing,
        unitPrice: retailUnitPrice,
        computedLineTotal: round2(qty * retailUnitPrice),
        appliedPriceLevel: 'Retail',
        priceSource: 'Retail (Wholesale fallback)',
        missingPriceLevel: null,
        validationError: null,
        pricingBreakdown: wholesalePackageQtyInBaseUnit > 0
          ? `Below wholesale minimum (${formatBaseQtyLabel(wholesalePackageQtyInBaseUnit, params.baseUnitName ?? '')}), retail price applied`
          : quantityBreakPricing.pricingBreakdown,
      };
    }

    if (strictSelectedPriceLevel && missingPriceLevel) {
      return {
        ...quantityBreakPricing,
        unitPrice: 0,
        computedLineTotal: 0,
        appliedPriceLevel: selectedPriceLevel,
        priceSource: selectedPriceLevel === 'Special' ? 'Special' : selectedPriceLevel,
        missingPriceLevel: selectedPriceLevel,
        validationError: `No price set for ${selectedPriceLevel}`,
      };
    }

    if (selectedPriceLevel === 'Special' && specialUnitPrice > 0) {
      return {
        ...quantityBreakPricing,
        unitPrice: specialUnitPrice,
        computedLineTotal: round2(qty * specialUnitPrice),
        appliedPriceLevel: 'Special',
        priceSource: 'Special',
        missingPriceLevel: null,
        validationError: null,
      };
    }

    return {
      ...quantityBreakPricing,
      unitPrice: retailUnitPrice,
      computedLineTotal: round2(qty * retailUnitPrice),
      appliedPriceLevel: 'Retail',
      priceSource: 'Retail',
      missingPriceLevel: null,
      validationError: null,
    };
  }

  if (selectedPriceLevel === 'Special') {
    if (specialUnitPrice > 0) {
      return {
        ...quantityBreakPricing,
        unitPrice: specialUnitPrice,
        computedLineTotal: round2(qty * specialUnitPrice),
        appliedPriceLevel: 'Special',
        priceSource: 'Special',
        missingPriceLevel: null,
        validationError: null,
      };
    }
    return {
      ...quantityBreakPricing,
      unitPrice: quantityBreakPricing.effectiveUnitPrice,
      computedLineTotal: quantityBreakPricing.lineTotal,
      appliedPriceLevel: quantityBreakPricing.wholesaleBlocksApplied > 0 ? 'Wholesale' : 'Retail',
      priceSource: 'Retail (Special fallback)',
      missingPriceLevel: null,
      validationError: null,
    };
  }

  if (selectedPriceLevel === 'Wholesale' && !quantityBreakPricing.wholesaleEnabled) {
    if (wholesaleUnitPrice > 0) {
      return {
        ...quantityBreakPricing,
        unitPrice: wholesaleUnitPrice,
        computedLineTotal: round2(qty * wholesaleUnitPrice),
        appliedPriceLevel: 'Wholesale',
        priceSource: 'Wholesale',
        missingPriceLevel: null,
        validationError: null,
      };
    }
    return {
      ...quantityBreakPricing,
      unitPrice: quantityBreakPricing.effectiveUnitPrice,
      computedLineTotal: quantityBreakPricing.lineTotal,
      appliedPriceLevel: quantityBreakPricing.wholesaleBlocksApplied > 0 ? 'Wholesale' : 'Retail',
      priceSource: 'Retail (Wholesale fallback)',
      missingPriceLevel: null,
      validationError: null,
    };
  }

  if (quantityBreakPricing.wholesaleBlocksApplied > 0) {
    return {
      ...quantityBreakPricing,
      unitPrice: quantityBreakPricing.effectiveUnitPrice,
      computedLineTotal: quantityBreakPricing.lineTotal,
      appliedPriceLevel: 'Wholesale',
      priceSource: quantityBreakPricing.retailRemainderBaseQty > 0 ? 'Wholesale break + Retail' : 'Wholesale break',
      missingPriceLevel: null,
      validationError: null,
    };
  }

  if (qualifiesWholesaleQty) {
    return {
      ...quantityBreakPricing,
      unitPrice: wholesaleUnitPrice,
      computedLineTotal: round2(qty * wholesaleUnitPrice),
      appliedPriceLevel: 'Wholesale',
      priceSource: 'Wholesale qty',
      missingPriceLevel: null,
      validationError: null,
    };
  }

  return {
    ...quantityBreakPricing,
    unitPrice: quantityBreakPricing.effectiveUnitPrice,
    computedLineTotal: quantityBreakPricing.lineTotal,
    appliedPriceLevel: 'Retail',
    priceSource: 'Retail',
    missingPriceLevel: null,
    validationError: null,
  };
}

export async function fetchProductUnitBundles(productIds: string[]): Promise<Map<string, ProductUnitBundle>> {
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  if (ids.length === 0) return new Map();

  const [productsRes, conversionsRes, sellingUnitsRes] = await Promise.all([
    supabase
      .from('inv_products')
      .select('id, unit_id, base_unit_id, default_purchase_unit_id, default_selling_unit_id')
      .in('id', ids),
    supabase
      .from('inv_product_unit_conversions')
      .select('*')
      .in('product_id', ids)
      .order('sort_order', { ascending: true }),
    supabase
      .from('inv_product_selling_units')
      .select('*')
      .in('product_id', ids)
      .order('sort_order', { ascending: true }),
  ]);

  const unitIds = new Set<string>();
  for (const product of (productsRes.data ?? []) as Array<Record<string, unknown>>) {
    const baseUnitId = String(product.base_unit_id ?? product.unit_id ?? '');
    const purchaseUnitId = String(product.default_purchase_unit_id ?? baseUnitId ?? '');
    if (baseUnitId) unitIds.add(baseUnitId);
    if (purchaseUnitId) unitIds.add(purchaseUnitId);
  }
  for (const row of (conversionsRes.data ?? []) as Array<Record<string, unknown>>) {
    const unitId = String(row.unit_id ?? '');
    if (unitId) unitIds.add(unitId);
  }
  for (const row of (sellingUnitsRes.data ?? []) as Array<Record<string, unknown>>) {
    const unitId = String(row.unit_id ?? '');
    if (unitId) unitIds.add(unitId);
  }

  const unitsRes = unitIds.size > 0
    ? await supabase.from('inv_units').select('*').in('id', Array.from(unitIds))
    : { data: [] as UnitRow[] };
  const unitMap = new Map<string, UnitRow>(((unitsRes.data ?? []) as UnitRow[]).map(unit => [unit.id, unit]));

  const conversionsByProduct = new Map<string, InvProductUnitConversion[]>();
  for (const row of (conversionsRes.data ?? []) as InvProductUnitConversion[]) {
    const list = conversionsByProduct.get(row.product_id) ?? [];
    list.push({
      ...row,
      equivalent_qty_in_base_unit: toNum(row.equivalent_qty_in_base_unit) || 1,
      allow_purchase: Boolean(row.allow_purchase),
      allow_sale: Boolean(row.allow_sale),
      inv_units: unitMap.get(row.unit_id),
    });
    conversionsByProduct.set(row.product_id, list);
  }

  const sellingUnitsByProduct = new Map<string, InvProductSellingUnit[]>();
  for (const row of (sellingUnitsRes.data ?? []) as InvProductSellingUnit[]) {
    const list = sellingUnitsByProduct.get(row.product_id) ?? [];
    list.push({
      ...row,
      qty_in_base_unit: toNum(row.qty_in_base_unit) || 1,
      selling_price: round2(toNum(row.selling_price)),
      retail_price: round2(toNum(row.retail_price ?? row.selling_price)),
      wholesale_price: round2(toNum(row.wholesale_price)),
      special_price: round2(toNum(row.special_price)),
      wholesale_enabled: Boolean(row.wholesale_enabled),
      wholesale_break_qty_in_base_unit: toNum(row.wholesale_break_qty_in_base_unit),
      wholesale_block_price: round2(toNum(row.wholesale_block_price)),
      is_default: Boolean(row.is_default),
      inv_units: unitMap.get(row.unit_id),
    });
    sellingUnitsByProduct.set(row.product_id, list);
  }

  const bundles = new Map<string, ProductUnitBundle>();
  for (const product of (productsRes.data ?? []) as Array<Record<string, unknown>>) {
    const productId = String(product.id ?? '');
    const baseUnitId = String(product.base_unit_id ?? product.unit_id ?? '') || null;
    const defaultPurchaseUnitId = String(product.default_purchase_unit_id ?? baseUnitId ?? '') || null;
    const sellingUnits = sellingUnitsByProduct.get(productId) ?? [];
    const defaultSellingUnit =
      sellingUnits.find(unit => unit.is_default) ??
      sellingUnits.find(unit => unit.id === product.default_selling_unit_id) ??
      sellingUnits[0];
    const baseUnit = baseUnitId ? unitMap.get(baseUnitId) : null;
    const purchaseUnit = defaultPurchaseUnitId ? unitMap.get(defaultPurchaseUnitId) : null;
    const sellingUnit = defaultSellingUnit?.unit_id ? unitMap.get(defaultSellingUnit.unit_id) : null;

    bundles.set(productId, {
      productId,
      baseUnitId,
      baseUnitName: baseUnit?.name ?? '',
      baseUnitCode: preferredUnitName(baseUnit),
      defaultPurchaseUnitId,
      defaultPurchaseUnitName: purchaseUnit?.name ?? baseUnit?.name ?? '',
      defaultPurchaseUnitCode: preferredUnitName(purchaseUnit ?? baseUnit),
      defaultSellingUnitId: defaultSellingUnit?.id ?? null,
      defaultSellingUnitName: sellingUnit?.name ?? baseUnit?.name ?? '',
      defaultSellingUnitCode: preferredUnitName(sellingUnit ?? baseUnit),
      conversions: conversionsByProduct.get(productId) ?? [],
      sellingUnits,
    });
  }

  return bundles;
}

export function resolvePurchaseConversion(
  bundle: ProductUnitBundle | undefined,
  purchaseUnitId?: string | null,
): { purchaseUnitId: string | null; purchaseUnitName: string; qtyInBaseUnitPerPurchase: number; baseUnitName: string } {
  const fallbackName = bundle?.baseUnitName ?? '';
  const requestedUnitId = purchaseUnitId ?? bundle?.defaultPurchaseUnitId ?? bundle?.baseUnitId ?? null;
  const conversion =
    bundle?.conversions.find(row => row.unit_id === requestedUnitId) ??
    bundle?.conversions.find(row => row.unit_id === bundle.defaultPurchaseUnitId) ??
    bundle?.conversions[0];

  return {
    purchaseUnitId: requestedUnitId,
    purchaseUnitName: conversion?.inv_units?.name ?? bundle?.defaultPurchaseUnitName ?? fallbackName,
    qtyInBaseUnitPerPurchase: toNum(conversion?.equivalent_qty_in_base_unit) || 1,
    baseUnitName: bundle?.baseUnitName ?? fallbackName,
  };
}

export function computeBaseQuantity(qty: number, qtyInBaseUnitPerUnit: number): number {
  return round2(toNum(qty) * toNum(qtyInBaseUnitPerUnit));
}

export function computeCostPerBase(unitCost: number, qtyInBaseUnitPerUnit: number): number {
  const divisor = toNum(qtyInBaseUnitPerUnit) || 1;
  return round2(toNum(unitCost) / divisor);
}

export function resolveSellingUnitPricing(
  product: InvProduct,
  bundle: ProductUnitBundle | undefined,
  selectedUnitId?: string | null,
  qty = 1,
  priceLevel?: string | null,
  options?: ResolveSellingUnitPricingOptions,
): ResolvedSellingUnit {
  const selectedPriceLevel = normalizePriceLevel(priceLevel);
  const defaultRetail = round2(toNum(product.retail_price ?? product.selling_price));
  const sellingUnits = (bundle?.sellingUnits ?? []).map(unit => coerceSellingUnit(product, unit));
  const selectedUnit =
    sellingUnits.find(unit => unit.id === selectedUnitId) ??
    sellingUnits.find(unit => unit.is_default) ??
    sellingUnits[0];

  const rawQtyInBaseUnitPerUnit = toNum(selectedUnit?.qty_in_base_unit) || 1;
  const retailUnitPrice = round2(toNum(selectedUnit?.retail_price ?? defaultRetail));
  const wholesalePrice = round2(toNum(selectedUnit?.wholesale_price));
  const specialPrice = round2(toNum(selectedUnit?.special_price));
  const baseUnitName = bundle?.baseUnitName ?? product.base_unit_name ?? product.inv_units?.name ?? '';
  const qtyInBaseUnitPerUnit = rawQtyInBaseUnitPerUnit;
  const resolvedPricing = resolveUnitPriceRule({
    qty,
    qtyInBaseUnitPerUnit,
    retailUnitPrice,
    wholesaleUnitPrice: wholesalePrice,
    specialUnitPrice: specialPrice,
    baseUnitName,
    wholesaleEnabled: Boolean(selectedUnit?.wholesale_enabled),
    wholesaleBreakQtyInBaseUnit: toNum(selectedUnit?.wholesale_break_qty_in_base_unit),
    wholesaleBlockPrice: round2(toNum(selectedUnit?.wholesale_block_price)),
    selectedPriceLevel,
    lockSelectedPriceLevel: options?.lockSelectedPriceLevel,
    strictSelectedPriceLevel: options?.strictSelectedPriceLevel,
  });

  const unitMeta = selectedUnit?.inv_units;
  const resolvedUnitName = unitMeta?.name ?? bundle?.defaultSellingUnitName ?? product.base_unit_name ?? product.name;

  return {
    selectedUnitId: selectedUnit?.id ?? bundle?.defaultSellingUnitId ?? null,
    selectedUnitName: resolvedUnitName,
    qtyInBaseUnitPerUnit,
    totalBaseQty: computeBaseQuantity(qty, qtyInBaseUnitPerUnit),
    retailUnitPrice,
    legacyWholesaleUnitPrice: wholesalePrice,
    specialUnitPrice: specialPrice,
    unitPrice: resolvedPricing.unitPrice,
    computedLineTotal: resolvedPricing.computedLineTotal,
    wholesaleEnabled: resolvedPricing.wholesaleEnabled,
    wholesaleBreakQtyInBaseUnit: resolvedPricing.wholesaleBreakQtyInBaseUnit,
    wholesaleBlockPrice: resolvedPricing.wholesaleBlockPrice,
    wholesaleBlocksApplied: resolvedPricing.wholesaleBlocksApplied,
    wholesaleBaseQtyApplied: resolvedPricing.wholesaleBaseQtyApplied,
    retailRemainderBaseQty: resolvedPricing.retailRemainderBaseQty,
    pricingBreakdown: resolvedPricing.pricingBreakdown,
    selectedPriceLevel,
    appliedPriceLevel: resolvedPricing.appliedPriceLevel,
    priceSource: resolvedPricing.priceSource,
    baseUnitName,
    missingPriceLevel: resolvedPricing.missingPriceLevel,
    validationError: resolvedPricing.validationError,
  };
}
