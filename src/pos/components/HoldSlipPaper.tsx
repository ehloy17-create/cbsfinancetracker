import { SLIP_STYLES, formatSlipDateTime, formatSlipMoney } from '../lib/slip';

export interface HoldSlipPaperLine {
  id: string;
  productName: string;
  qty: number;
  unitPrice: number;
  subtotal: number;
  discountAmount?: number;
  selectedUnitName?: string;
  baseUnitName?: string;
  pricingBreakdown?: string;
}

interface Props {
  holdReference: string;
  customerName?: string;
  cashierName?: string;
  createdAt?: string;
  notes?: string;
  lines: HoldSlipPaperLine[];
  totalDue: number;
  showStyleTag?: boolean;
}

function formatQty(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export default function HoldSlipPaper({
  customerName,
  cashierName,
  createdAt,
  notes,
  lines,
  totalDue,
  showStyleTag = true,
}: Props) {
  const totalItems = lines.reduce((sum, line) => sum + Number(line.qty ?? 0), 0);
  const trimmedCustomerName = String(customerName ?? '').trim();
  const trimmedNotes = String(notes ?? '').trim();

  return (
    <div className="slip-paper">
      {showStyleTag && <style>{SLIP_STYLES}</style>}
      <div className="store-name">CEBU BAKERY SUPPLY</div>
      <div className="store-address">GY Dela Cerna St. Lapu Lapu City</div>
      <div className="slip-title">HOLD SLIP</div>

      <div className="divider" />

      <div className="center header-meta">{formatSlipDateTime(createdAt)}</div>

      <div className="divider" />

      {cashierName && (
        <div className="row">
          <span>Cashier</span>
          <span>{cashierName}</span>
        </div>
      )}
      {trimmedCustomerName && trimmedCustomerName.toLowerCase() !== 'walk-in' && (
        <div className="row">
          <span>Customer</span>
          <span>{trimmedCustomerName}</span>
        </div>
      )}
      {trimmedNotes && (
        <div style={{ marginTop: '2px' }}>
          <div className="header-meta bold">Notes</div>
          <div className="footer-note">{trimmedNotes}</div>
        </div>
      )}

      <div className="divider" />

      <div className="item-header" style={{ marginBottom: '2px' }}>
        <span>Item</span>
        <span>Unit Price</span>
        <span>Total Amount</span>
      </div>
      <div className="divider" />
      {lines.map(line => {
        const unitName = String(line.selectedUnitName ?? line.baseUnitName ?? '').trim();
        const pricingBreakdown = String(line.pricingBreakdown ?? '').trim();
        return (
          <div key={line.id} style={{ marginBottom: '3px' }}>
            <div className="item-name">{line.productName}</div>
            {unitName && <div className="header-meta">{unitName}</div>}
            {pricingBreakdown && <div className="header-meta">{pricingBreakdown}</div>}
            <div className="item-columns">
              <span>Qty {formatQty(Number(line.qty ?? 0))}</span>
              <span>₱{formatSlipMoney(Number(line.unitPrice ?? 0))}</span>
              <span>₱{formatSlipMoney(Number(line.subtotal ?? 0))}</span>
            </div>
            {Number(line.discountAmount ?? 0) > 0 && (
              <div className="item-columns" style={{ color: '#666' }}>
                <span style={{ paddingLeft: '2mm' }}>Discount</span>
                <span></span>
                <span>-₱{formatSlipMoney(Number(line.discountAmount))}</span>
              </div>
            )}
          </div>
        );
      })}

      <div className="divider" />

      <div className="row">
        <span>Total Items</span>
        <span>{formatQty(totalItems)}</span>
      </div>
      <div className="row total-row">
        <span>TOTAL DUE</span>
        <span>₱{formatSlipMoney(totalDue)}</span>
      </div>

      <div className="cut-line" />
    </div>
  );
}
