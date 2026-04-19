import { useState, useCallback, useMemo, useRef } from 'react';
import { CustomerPriceLevel, InvProduct, PosCustomer, PriceSource } from '../../lib/types';
import { ProductUnitBundle, resolveSellingUnitPricing, resolveUnitPriceRule } from '../../lib/productUnits';
import { generateUUID, round2, toNum } from '../../lib/utils';

export interface CartLine {
  lineId: string;
  productId: string;
  productName: string;
  sku: string;
  barcode: string;
  selectedUnitId: string | null;
  selectedUnitName: string;
  baseUnitName: string;
  qtyInBaseUnitPerUnit: number;
  totalBaseQtyDeducted: number;
  retailUnitPrice: number;
  legacyWholesaleUnitPrice: number;
  specialUnitPrice: number;
  unitPrice: number;
  originalUnitPrice: number;
  lineBaseAmount: number;
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
  priceOverridden: boolean;
  priceModeLocked: boolean;
  qty: number;
  discountAmount: number;
  discountPct: number;
  subtotal: number;
  sortOrder: number;
  voided: boolean;
}

function buildLine(product: InvProduct, line: Omit<CartLine, 'lineId' | 'productId' | 'productName' | 'sku' | 'barcode' | 'sortOrder' | 'voided'>, sortOrder: number): CartLine {
  return {
    lineId: generateUUID(),
    productId: product.id,
    productName: product.name,
    sku: product.sku_code,
    barcode: product.barcode ?? '',
    sortOrder,
    voided: false,
    ...line,
  };
}

function recalcLine(line: CartLine): CartLine {
  if (line.voided) return { ...line, subtotal: 0, totalBaseQtyDeducted: 0 };
  const qty = toNum(line.qty);
  const discountAmount = round2(toNum(line.discountAmount));
  const qtyInBaseUnitPerUnit = toNum(line.qtyInBaseUnitPerUnit) || 1;
  const specialUnitPrice = round2(toNum(line.specialUnitPrice));
  const legacyWholesaleUnitPrice = round2(toNum(line.legacyWholesaleUnitPrice));
  const resolvedPricing = !line.priceOverridden
    ? resolveUnitPriceRule({
        qty,
        qtyInBaseUnitPerUnit,
        retailUnitPrice: toNum(line.retailUnitPrice),
        wholesaleUnitPrice: legacyWholesaleUnitPrice,
        specialUnitPrice,
        baseUnitName: line.baseUnitName,
        wholesaleEnabled: line.wholesaleEnabled,
        wholesaleBreakQtyInBaseUnit: line.wholesaleBreakQtyInBaseUnit,
        wholesaleBlockPrice: line.wholesaleBlockPrice,
        selectedPriceLevel: line.selectedPriceLevel,
        lockSelectedPriceLevel: line.priceModeLocked,
      })
    : null;
  const unitPrice = round2(
    line.priceOverridden
      ? toNum(line.unitPrice)
      : toNum(resolvedPricing?.unitPrice ?? line.unitPrice)
  );
  const subtotalBeforeDiscount = round2(
    line.priceOverridden
      ? qty * unitPrice
      : toNum(resolvedPricing?.computedLineTotal ?? qty * unitPrice)
  );
  const appliedPriceLevel = line.priceOverridden
    ? line.appliedPriceLevel
    : (resolvedPricing?.appliedPriceLevel ?? 'Retail');
  const priceSource: PriceSource = line.priceOverridden
    ? line.priceSource
    : (resolvedPricing?.priceSource ?? 'Retail');
  return {
    ...line,
    qty,
    qtyInBaseUnitPerUnit,
    totalBaseQtyDeducted: round2(qty * qtyInBaseUnitPerUnit),
    retailUnitPrice: round2(toNum(line.retailUnitPrice)),
    legacyWholesaleUnitPrice,
    specialUnitPrice,
    unitPrice,
    originalUnitPrice: unitPrice,
    lineBaseAmount: subtotalBeforeDiscount,
    wholesaleEnabled: Boolean(line.wholesaleEnabled),
    wholesaleBreakQtyInBaseUnit: round2(toNum(line.wholesaleBreakQtyInBaseUnit)),
    wholesaleBlockPrice: round2(toNum(line.wholesaleBlockPrice)),
    wholesaleBlocksApplied: resolvedPricing?.wholesaleBlocksApplied ?? 0,
    wholesaleBaseQtyApplied: round2(toNum(resolvedPricing?.wholesaleBaseQtyApplied)),
    retailRemainderBaseQty: round2(toNum(resolvedPricing?.retailRemainderBaseQty ?? qty * qtyInBaseUnitPerUnit)),
    pricingBreakdown: line.priceOverridden ? '' : (resolvedPricing?.pricingBreakdown ?? ''),
    appliedPriceLevel,
    priceSource,
    discountAmount,
    subtotal: round2(Math.max(0, subtotalBeforeDiscount - discountAmount)),
  };
}

function resolveLineDraft(
  product: InvProduct,
  bundle: ProductUnitBundle | undefined,
  customer: PosCustomer | null | undefined,
  snapshotPriceLevel: string | null | undefined,
  selectedUnitId?: string | null,
  qty = 1,
  discountAmount = 0,
  priceModeLocked = false,
): Omit<CartLine, 'lineId' | 'productId' | 'productName' | 'sku' | 'barcode' | 'sortOrder' | 'voided'> {
  const pricing = resolveSellingUnitPricing(
    product,
    bundle,
    selectedUnitId,
    qty,
    customer?.price_level ?? snapshotPriceLevel ?? 'Retail',
    { lockSelectedPriceLevel: priceModeLocked },
  );
  const unitPrice = round2(toNum(pricing.unitPrice));
  return {
    selectedUnitId: pricing.selectedUnitId,
    selectedUnitName: pricing.selectedUnitName,
    baseUnitName: pricing.baseUnitName,
    qtyInBaseUnitPerUnit: round2(toNum(pricing.qtyInBaseUnitPerUnit)),
    totalBaseQtyDeducted: round2(toNum(pricing.totalBaseQty)),
    retailUnitPrice: round2(toNum(pricing.retailUnitPrice)),
    legacyWholesaleUnitPrice: round2(toNum(pricing.legacyWholesaleUnitPrice)),
    specialUnitPrice: round2(toNum(pricing.specialUnitPrice)),
    unitPrice,
    originalUnitPrice: unitPrice,
    lineBaseAmount: round2(toNum(pricing.computedLineTotal)),
    wholesaleEnabled: Boolean(pricing.wholesaleEnabled),
    wholesaleBreakQtyInBaseUnit: round2(toNum(pricing.wholesaleBreakQtyInBaseUnit)),
    wholesaleBlockPrice: round2(toNum(pricing.wholesaleBlockPrice)),
    wholesaleBlocksApplied: pricing.wholesaleBlocksApplied,
    wholesaleBaseQtyApplied: round2(toNum(pricing.wholesaleBaseQtyApplied)),
    retailRemainderBaseQty: round2(toNum(pricing.retailRemainderBaseQty)),
    pricingBreakdown: pricing.pricingBreakdown,
    selectedPriceLevel: pricing.selectedPriceLevel,
    appliedPriceLevel: pricing.appliedPriceLevel,
    priceSource: pricing.priceSource,
    priceOverridden: false,
    priceModeLocked,
    qty,
    discountAmount: round2(toNum(discountAmount)),
    discountPct: 0,
    subtotal: round2(Math.max(0, toNum(pricing.computedLineTotal) - discountAmount)),
  };
}

export interface CartTotals {
  itemCount: number;
  lineCount: number;
  activeLineCount: number;
  subtotal: number;
  discountTotal: number;
  grandTotal: number;
}

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const addingRef = useRef<Set<string>>(new Set());

  const totals = useMemo<CartTotals>(() => {
    const active = lines.filter(l => !l.voided);
    const subtotal = round2(active.reduce((s, l) => s + toNum(l.lineBaseAmount ?? (toNum(l.subtotal) + toNum(l.discountAmount))), 0));
    const discountTotal = round2(active.reduce((s, l) => s + toNum(l.discountAmount), 0));
    const grandTotal = round2(active.reduce((s, l) => s + toNum(l.subtotal), 0));
    const itemCount = round2(active.reduce((s, l) => s + toNum(l.qty), 0));
    return { itemCount, lineCount: lines.length, activeLineCount: active.length, subtotal, discountTotal, grandTotal };
  }, [lines]);

  const addProduct = useCallback((
    product: InvProduct,
    bundle?: ProductUnitBundle,
    customer?: PosCustomer | null,
    snapshotPriceLevel?: string | null,
    selectedUnitId?: string | null,
    priceModeLocked = false,
    qtyToAdd = 1,
  ) => {
    const key = `${product.id}:${selectedUnitId ?? bundle?.defaultSellingUnitId ?? 'default'}`;
    if (addingRef.current.has(key)) return -1;
    const normalizedQtyToAdd = Math.max(toNum(qtyToAdd), 0);
    const draft = resolveLineDraft(product, bundle, customer, snapshotPriceLevel, selectedUnitId, normalizedQtyToAdd, 0, priceModeLocked);

    let affectedIdx = -1;
    addingRef.current.add(key);
    setLines(prev => {
      const idx = prev.findIndex(l =>
        l.productId === product.id &&
        l.selectedUnitId === draft.selectedUnitId &&
        !l.voided &&
        !l.priceOverridden &&
        l.priceModeLocked === priceModeLocked &&
        l.discountAmount === 0 &&
        l.selectedPriceLevel === draft.selectedPriceLevel
      );
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = recalcLine({ ...updated[idx], qty: updated[idx].qty + normalizedQtyToAdd });
        affectedIdx = idx;
        addingRef.current.delete(key);
        return updated;
      }
      affectedIdx = prev.length;
      addingRef.current.delete(key);
      return [...prev, buildLine(product, draft, prev.length)];
    });
    return affectedIdx;
  }, []);

  const updateLineUnit = useCallback((
    lineIdx: number,
    product: InvProduct,
    bundle: ProductUnitBundle | undefined,
    customer?: PosCustomer | null,
    snapshotPriceLevel?: string | null,
    selectedUnitId?: string | null,
  ) => {
    setLines(prev => {
      const updated = [...prev];
      const current = updated[lineIdx];
      const draft = resolveLineDraft(
        product,
        bundle,
        current.priceModeLocked ? null : customer,
        current.priceModeLocked ? current.selectedPriceLevel : snapshotPriceLevel,
        selectedUnitId,
        current.qty,
        current.discountAmount,
        current.priceModeLocked,
      );
      updated[lineIdx] = recalcLine({
        ...current,
        ...draft,
        discountPct: current.discountPct,
        priceOverridden: false,
        priceModeLocked: current.priceModeLocked,
      });
      return updated;
    });
  }, []);

  const removeLineByIdx = useCallback((lineIdx: number) => {
    setLines(prev => prev.filter((_, i) => i !== lineIdx));
  }, []);

  const updateQty = useCallback((lineIdx: number, qty: number) => {
    if (qty <= 0) {
      setLines(prev => prev.filter((_, i) => i !== lineIdx));
      return;
    }
    setLines(prev => {
      const updated = [...prev];
      updated[lineIdx] = recalcLine({ ...updated[lineIdx], qty });
      return updated;
    });
  }, []);

  const voidLine = useCallback((lineIdx: number) => {
    setLines(prev => {
      const updated = [...prev];
      updated[lineIdx] = recalcLine({ ...updated[lineIdx], voided: true });
      return updated;
    });
  }, []);

  const applyDiscount = useCallback((lineIdx: number, pct: number, fixedAmount: number) => {
    setLines(prev => {
      const updated = [...prev];
      const line = updated[lineIdx];
      const lineTotal = toNum(line.lineBaseAmount ?? (toNum(line.subtotal) + toNum(line.discountAmount)));
      const discountAmount = pct > 0
        ? Math.min(lineTotal * pct / 100, lineTotal)
        : Math.min(fixedAmount, lineTotal);
      updated[lineIdx] = recalcLine({ ...line, discountAmount: round2(discountAmount), discountPct: toNum(pct) });
      return updated;
    });
  }, []);

  const overridePrice = useCallback((lineIdx: number, newPrice: number) => {
    setLines(prev => {
      const updated = [...prev];
      updated[lineIdx] = recalcLine({
        ...updated[lineIdx],
        unitPrice: round2(toNum(newPrice)),
        priceOverridden: true,
      });
      return updated;
    });
  }, []);

  const clearCart = useCallback(() => setLines([]), []);

  const replaceLines = useCallback((nextLines: CartLine[]) => {
    setLines(nextLines.map((line, i) => recalcLine({
      ...line,
      lineId: line.lineId || generateUUID(),
      sortOrder: i,
    })));
  }, []);

  const loadFromHeld = useCallback((heldLines: CartLine[]) => {
    replaceLines(heldLines.map((line, i) => ({
      ...line,
      lineId: generateUUID(),
      qty: toNum(line.qty),
      qtyInBaseUnitPerUnit: round2(toNum(line.qtyInBaseUnitPerUnit ?? 1)),
       totalBaseQtyDeducted: round2(toNum(line.totalBaseQtyDeducted ?? toNum(line.qty) * toNum(line.qtyInBaseUnitPerUnit ?? 1))),
       retailUnitPrice: round2(toNum(line.retailUnitPrice ?? line.originalUnitPrice ?? line.unitPrice)),
       legacyWholesaleUnitPrice: round2(toNum(line.legacyWholesaleUnitPrice ?? (line.selectedPriceLevel === 'Wholesale' ? line.unitPrice : 0))),
       specialUnitPrice: round2(toNum(line.specialUnitPrice ?? (line.selectedPriceLevel === 'Special' ? line.unitPrice : 0))),
       unitPrice: round2(toNum(line.unitPrice)),
       originalUnitPrice: round2(toNum(line.originalUnitPrice)),
       lineBaseAmount: round2(toNum(line.lineBaseAmount ?? (toNum(line.subtotal) + toNum(line.discountAmount)))),
       wholesaleEnabled: Boolean(line.wholesaleEnabled),
       wholesaleBreakQtyInBaseUnit: round2(toNum(line.wholesaleBreakQtyInBaseUnit)),
       wholesaleBlockPrice: round2(toNum(line.wholesaleBlockPrice)),
       wholesaleBlocksApplied: Math.max(0, Math.trunc(toNum(line.wholesaleBlocksApplied))),
       wholesaleBaseQtyApplied: round2(toNum(line.wholesaleBaseQtyApplied)),
       retailRemainderBaseQty: round2(toNum(line.retailRemainderBaseQty)),
       pricingBreakdown: String(line.pricingBreakdown ?? ''),
       selectedPriceLevel: line.selectedPriceLevel ?? 'Retail',
      appliedPriceLevel: line.appliedPriceLevel ?? 'Retail',
      priceSource: line.priceSource ?? 'Retail',
      priceModeLocked: Boolean(line.priceModeLocked),
      discountAmount: round2(toNum(line.discountAmount)),
      discountPct: toNum(line.discountPct),
      subtotal: round2(toNum(line.subtotal)),
      sortOrder: i,
    })));
  }, [replaceLines]);

  return {
    lines,
    totals,
    addProduct,
    updateLineUnit,
    removeLineByIdx,
    updateQty,
    clearCart,
    loadFromHeld,
    replaceLines,
    voidLine,
    applyDiscount,
    overridePrice,
  };
}
