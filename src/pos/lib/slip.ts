export const SLIP_STYLES = `
  .slip-paper { font-family: 'Courier New', monospace; font-size: 9px; width: 58mm; max-width: 58mm; padding: 2.5mm 2.5mm 1mm; color: #000; background: #fff; margin: 0 auto; line-height: 1.15; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .divider { border-top: 1px dashed #000; margin: 3px 0; }
  .row { display: flex; justify-content: space-between; margin: 1px 0; gap: 2mm; }
  .item-name { font-weight: bold; word-break: break-word; }
  .item-columns { display: grid; grid-template-columns: 1fr 16mm 17mm; gap: 1mm; align-items: start; margin-top: 1px; }
  .item-columns span:nth-child(2), .item-columns span:nth-child(3) { text-align: right; }
  .item-header { display: grid; grid-template-columns: 1fr 16mm 17mm; gap: 1mm; font-weight: bold; text-transform: uppercase; }
  .item-header span { white-space: nowrap; }
  .item-header span:nth-child(2), .item-header span:nth-child(3) { text-align: right; }
  .receipt-no, .store-name, .store-address, .slip-title, .header-meta, .footer-note { }
  .receipt-no { font-weight: bold; letter-spacing: 0.5px; }
  .total-row { font-weight: 800; }
  .store-name { text-align: center; font-weight: bold; }
  .store-address { text-align: center; }
  .slip-title { text-align: center; font-weight: bold; margin-top: 1px; letter-spacing: 0.5px; }
  .header-meta { margin-top: 1px; }
  .footer-note { margin-top: 0; }
  .cut-line { border-top: 1px dashed #000; margin: 2px 0 0; }
`;

export function formatSlipMoney(n: number) {
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatSlipDateTime(value: unknown) {
  if (!value) return '—';
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}
