import { useEffect, useRef, useState } from 'react';
import { X, Printer, CheckCircle2 } from 'lucide-react';
import { fetchSaleForReceipt } from '../lib/posCheckout';
import { PAYMENT_METHOD_LABELS } from '../lib/posUtils';
import { SalePaymentMethod } from '../../lib/types';
import { SLIP_STYLES, formatSlipDateTime, formatSlipMoney } from '../lib/slip';
import { openPrintPreviewWindow } from '../lib/printPreview';
import { useCompanySettings } from '../../contexts/CompanySettingsContext';
import { resolveApiBase } from '../../lib/apiBase';

interface Props {
  saleId: string;
  receiptNo: string;
  deviceTimestamp?: string;
  onClose: () => void;
}

function normalizeReceiptLabel(value: unknown) {
  const label = String(value ?? '').trim();
  return label;
}

function isRetailLabel(value: unknown) {
  return normalizeReceiptLabel(value).toLowerCase() === 'retail';
}

function formatQty(value: unknown) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return '0';
  return Number.isInteger(num) ? String(num) : num.toFixed(2);
}

function normalizeReceiptPaymentMethod(value: unknown): SalePaymentMethod | undefined {
  const method = String(value ?? '').trim().toLowerCase();
  if (method === 'cash') return 'cash';
  if (method === 'gcash' || method === 'card' || method === 'bank') return 'gcash';
  if (method === 'charge' || method === 'credit' || method === 'account') return 'charge';
  return undefined;
}

export default function ReceiptModal({ saleId, receiptNo, deviceTimestamp, onClose }: Props) {
  const [sale, setSale] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCustomerPhone, setShowCustomerPhone] = useState(false);
  const [showCustomerAddress, setShowCustomerAddress] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const { settings: companySettings } = useCompanySettings();

  const apiBase = resolveApiBase();
  const logoSrc = companySettings.logo_url
    ? companySettings.logo_url.startsWith('http') ? companySettings.logo_url : `${apiBase}${companySettings.logo_url}`
    : null;
  const showHeader = companySettings.show_company_header_in_reports;
  const showLogo = companySettings.show_logo_in_reports && !!logoSrc;

  useEffect(() => {
    fetchSaleForReceipt(saleId).then(data => {
      setSale(data as Record<string, unknown>);
      setLoading(false);
    });
  }, [saleId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function handlePrint() {
    if (!printRef.current) return;
    openPrintPreviewWindow({
      title: `Order Slip Preview - ${receiptNo}`,
      windowTitle: `Order Slip ${receiptNo}`,
      contentHtml: printRef.current.innerHTML,
      documentStyles: `
        @page { size: 58mm auto; margin: 0; }
        ${SLIP_STYLES}
        .preview-slip { width: 58mm; margin: 0 auto; background: #fff; color: #111827; }
      `,
      previewScale: 1.85,
      contentClassName: 'preview-slip',
      width: 1100,
      height: 920,
    });
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!sale) return null;

  const items = (sale.sale_items as Array<Record<string, unknown>>) ?? [];
  const payments = (sale.sale_payments as Array<Record<string, unknown>>) ?? [];
  const cashier = sale.cashier as Record<string, unknown> | undefined;
  const customer = sale.customer as Record<string, unknown> | undefined;
  const normalizedPayments = payments.map((payment) => {
    const method = normalizeReceiptPaymentMethod(payment.payment_method);
    const amount = Number(payment.amount ?? 0);
    const referenceNo = String(payment.reference_no ?? '').trim();
    return { method, amount, referenceNo };
  });
  const primaryPayment = normalizedPayments[0];
  const primaryMethod = primaryPayment?.method;
  const hasSplitPayments = normalizedPayments.length > 1;
  const hasCashPayment = normalizedPayments.some(payment => payment.method === 'cash') || primaryMethod === 'cash';
  const totalItems = items.reduce((sum, item) => sum + Number((item.qty as number | undefined) ?? 0), 0);
  const customerName = customer
    ? `${String(customer.first_name ?? '').trim()} ${String(customer.last_name ?? '').trim()}`.trim() || 'Walkin'
    : 'Walkin';
  const customerPhone = customer ? String(customer.phone ?? '').trim() : '';
  const customerAddress = customer ? String(customer.address ?? '').trim() : '';
  const customerPriceLevel = normalizeReceiptLabel(customer?.price_level);

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <h2 className="text-white font-bold">Order Slip Preview</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Receipt Preview */}
        <div className="px-5 pt-4 pb-0 border-b border-slate-700/60">
          <div className="flex flex-wrap gap-3 text-sm text-slate-200">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={showCustomerPhone}
                onChange={e => setShowCustomerPhone(e.target.checked)}
                className="rounded border-slate-500"
              />
              Show contact number
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={showCustomerAddress}
                onChange={e => setShowCustomerAddress(e.target.checked)}
                className="rounded border-slate-500"
              />
              Show address
            </label>
          </div>
          <p className="mt-2 text-xs text-slate-400">These are optional for privacy and only appear on the printed receipt when checked.</p>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="bg-slate-900/40 rounded-xl p-4 shadow-inner overflow-auto">
            <div className="mx-auto w-fit min-h-[320mm]">
            <div className="origin-top scale-[1.7]">
            <div className="mx-auto w-[58mm] min-h-[120mm] bg-white text-gray-900 rounded-md shadow-sm overflow-hidden">
            <div ref={printRef} className="slip-paper">
              <style>{SLIP_STYLES}</style>
              {/* Store header */}
              {showHeader && (
                <>
                  {showLogo && <div className="center" style={{ marginBottom: '3px' }}><img src={logoSrc!} alt="Logo" style={{ maxWidth: '28mm', maxHeight: '12.6mm', objectFit: 'contain', margin: '0 auto', display: 'block' }} /></div>}
                  <div className="store-name">{companySettings.company_name}</div>
                  {companySettings.company_address && <div className="store-address">{companySettings.company_address}</div>}
                  {companySettings.contact_number && <div className="store-address">{companySettings.contact_number}</div>}
                </>
              )}
              <div className="slip-title">ORDER SLIP</div>

              <div className="divider" />

              {/* Receipt number + datetime */}
              <div className="center receipt-no">{receiptNo}</div>
              <div className="center header-meta">
                 {formatSlipDateTime(deviceTimestamp ?? sale.created_at ?? sale.sale_datetime)}
              </div>

              <div className="divider" />

              {/* Cashier / Terminal */}
              <div className="row">
                <span>Cashier:</span>
                <span>{(cashier?.name as string) ?? '—'}</span>
              </div>
              <div className="row">
                <span>Customer:</span>
                <span>{customerName}</span>
              </div>
              {customer && customerPriceLevel && !isRetailLabel(customerPriceLevel) && (
                <div className="row">
                  <span>Price Level:</span>
                  <span>{customerPriceLevel}</span>
                </div>
              )}
              {showCustomerPhone && customerPhone && (
                <div className="row">
                  <span>Contact:</span>
                  <span>{customerPhone}</span>
                </div>
              )}
              {showCustomerAddress && customerAddress && (
                <div className="row">
                  <span>Address:</span>
                  <span style={{ textAlign: 'right', wordBreak: 'break-word', maxWidth: '60%' }}>{customerAddress}</span>
                </div>
              )}

              <div className="divider" />

              {/* Line items */}
              <div className="item-header" style={{ marginBottom: '2px' }}>
                <span>Item</span>
                <span>Unit Price</span>
                <span>Total Amount</span>
              </div>
              <div className="divider" />
              {items.map((item, i) => (
                  <div key={i} style={{ marginBottom: '3px' }}>
                    <div className="item-name">{item.product_name_snapshot as string}</div>
                    {(() => {
                      const unitName = normalizeReceiptLabel(item.selected_unit_name ?? item.base_unit_name ?? 'Unit');
                      return <div className="header-meta">{unitName}</div>;
                    })()}
                    {(() => {
                      const qty = Number(item.qty ?? 0);
                      const totalBaseQtyDeducted = Number(item.total_base_qty_deducted ?? 0);
                      const selectedUnitName = normalizeReceiptLabel(item.selected_unit_name ?? item.base_unit_name ?? 'Unit');
                      const baseUnitName = normalizeReceiptLabel(item.base_unit_name);
                      const showBaseQty = totalBaseQtyDeducted > 0
                        && (
                          Math.abs(totalBaseQtyDeducted - qty) > 0.000001
                          || (baseUnitName && baseUnitName !== selectedUnitName)
                        );
                      const itemDiscount = Number(item.discount_amount ?? 0);
                      return (
                        <>
                          <div className="item-columns">
                            <span>
                              Qty {formatQty(qty)}{showBaseQty ? ` (${formatQty(totalBaseQtyDeducted)} ${baseUnitName})` : ''}
                            </span>
                            <span>₱{formatSlipMoney(Number(item.unit_price))}</span>
                            <span>₱{formatSlipMoney(Number(item.subtotal))}</span>
                          </div>
                          {itemDiscount > 0 && (
                            <div className="item-columns" style={{ color: '#666' }}>
                              <span style={{ paddingLeft: '2mm' }}>Discount</span>
                              <span></span>
                              <span>-₱{formatSlipMoney(itemDiscount)}</span>
                            </div>
                          )}
                        </>
                      );
                    })()}
                 </div>
               ))}

              <div className="divider" />

              {/* Subtotal / Discount */}
              <div className="row">
                <span>Subtotal</span>
                 <span>₱{formatSlipMoney(Number(sale.subtotal))}</span>
              </div>
              <div className="row">
                <span>Total Items</span>
                <span>{Number.isInteger(totalItems) ? totalItems : totalItems.toFixed(2)}</span>
              </div>

              <div className="divider" />

              {/* Grand total */}
              <div className="row total-row">
                <span>TOTAL</span>
                 <span>₱{formatSlipMoney(Number(sale.total_amount))}</span>
              </div>

              <div className="divider" />

              {/* Payment */}
               {hasSplitPayments ? (
                 normalizedPayments.map((payment, index) => (
                   <div key={`${payment.method ?? 'unknown'}-${index}`}>
                     <div className="row">
                       <span>{payment.method ? PAYMENT_METHOD_LABELS[payment.method] : `Payment ${index + 1}`}</span>
                       <span>₱{formatSlipMoney(payment.amount)}</span>
                     </div>
                     {payment.referenceNo && (
                       <div className="row header-meta">
                         <span>Ref #</span>
                         <span>{payment.referenceNo}</span>
                       </div>
                     )}
                   </div>
                 ))
               ) : (
                 <>
                   <div className="row">
                     <span>Method</span>
                     <span>{primaryMethod ? PAYMENT_METHOD_LABELS[primaryMethod] : '—'}</span>
                   </div>
                   <div className="row">
                     <span>Tendered</span>
                     <span>₱{formatSlipMoney(Number(sale.amount_tendered))}</span>
                   </div>
                   {primaryPayment?.referenceNo && (
                     <div className="row header-meta">
                       <span>Ref #</span>
                       <span>{primaryPayment.referenceNo}</span>
                     </div>
                   )}
                 </>
               )}
               {hasCashPayment && Number(sale.change_amount) > 0 && (
                 <div className="row bold">
                   <span>Change</span>
                    <span>₱{formatSlipMoney(Number(sale.change_amount))}</span>
                 </div>
               )}

               <div className="divider" />

              {companySettings.receipt_notes ? (
                <div className="center footer-note">{companySettings.receipt_notes}</div>
              ) : (
                <>
                  <div className="center footer-note">Thank you for your purchase!</div>
                  <div className="center footer-note">Please come again.</div>
                </>
              )}
              <div className="cut-line" />
            </div>
            </div>
            </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 py-4 border-t border-slate-700 flex gap-3 flex-shrink-0">
          <button
            onClick={handlePrint}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold text-sm rounded-xl border border-slate-600 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Print to PDF
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm rounded-xl transition-colors"
          >
            New Sale
          </button>
        </div>
      </div>
    </div>
  );
}
