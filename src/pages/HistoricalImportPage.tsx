import { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, X, Download, ChevronDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { formatCurrency } from '../lib/utils';

type ImportType = 'checks' | 'expenses';

interface ParsedCheck {
  date: string;
  check_number: string;
  check_date: string;
  supplier_name: string;
  amount: string;
  description: string;
  _error?: string;
}

interface ParsedExpense {
  date: string;
  payee: string;
  amount: string;
  description: string;
  _error?: string;
}

type ParsedRow = ParsedCheck | ParsedExpense;

const CHECK_HEADERS = ['date', 'check_number', 'check_date', 'supplier_name', 'amount', 'description'];
const EXPENSE_HEADERS = ['date', 'payee', 'amount', 'description'];

const CHECK_TEMPLATE = `date,check_number,check_date,supplier_name,amount,description
2024-01-15,CHK-001,2024-01-20,ABC Trading,15000,Office supplies
2024-02-10,CHK-002,2024-02-15,XYZ Corp,8500,Freight charges`;

const EXPENSE_TEMPLATE = `date,payee,amount,description
2024-01-10,Meralco,5200,Electricity - January
2024-01-15,PLDT,2500,Internet - January
2024-02-01,Water district,1800,Water bill`;

function parseCSV(text: string): string[][] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line =>
      line.split(',').map(cell => cell.trim().replace(/^"|"$/g, ''))
    );
}

function validateDate(val: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(val.trim());
}

function parseRows(raw: string[][], type: ImportType): ParsedRow[] {
  if (raw.length < 2) return [];
  const headers = raw[0].map(h => h.toLowerCase().replace(/\s+/g, '_'));
  const get = (row: string[], key: string) => row[headers.indexOf(key)] ?? '';

  return raw.slice(1).map(row => {
    const date = get(row, 'date').trim();
    const amount = get(row, 'amount').trim();
    const errors: string[] = [];

    if (!validateDate(date)) errors.push('invalid date');
    const num = parseFloat(amount.replace(/,/g, ''));
    if (isNaN(num) || num <= 0) errors.push('invalid amount');

    if (type === 'checks') {
      const checkNumber = get(row, 'check_number').trim();
      const checkDate = get(row, 'check_date').trim() || date;
      if (!checkNumber) errors.push('check_number required');
      if (checkDate && !validateDate(checkDate)) errors.push('invalid check_date');
      return {
        date,
        check_number: checkNumber,
        check_date: checkDate,
        supplier_name: get(row, 'supplier_name').trim(),
        amount,
        description: get(row, 'description').trim(),
        _error: errors.length ? errors.join(', ') : undefined,
      } as ParsedCheck;
    } else {
      return {
        date,
        payee: get(row, 'payee').trim() || get(row, 'supplier_name').trim(),
        amount,
        description: get(row, 'description').trim(),
        _error: errors.length ? errors.join(', ') : undefined,
      } as ParsedExpense;
    }
  });
}

export default function HistoricalImportPage() {
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<ImportType>('checks');
  const [csvText, setCsvText] = useState('');
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null);

  function handleTextChange(text: string) {
    setCsvText(text);
    setResult(null);
    if (!text.trim()) { setParsed([]); return; }
    const raw = parseCSV(text);
    setParsed(parseRows(raw, type));
  }

  function handleTypeChange(t: ImportType) {
    setType(t);
    setCsvText('');
    setParsed([]);
    setResult(null);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => handleTextChange(String(ev.target?.result ?? ''));
    reader.readAsText(file);
    e.target.value = '';
  }

  function loadTemplate() {
    const tmpl = type === 'checks' ? CHECK_TEMPLATE : EXPENSE_TEMPLATE;
    handleTextChange(tmpl);
  }

  function downloadTemplate() {
    const tmpl = type === 'checks' ? CHECK_TEMPLATE : EXPENSE_TEMPLATE;
    const blob = new Blob([tmpl], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `historical-${type}-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const validRows = parsed.filter(r => !r._error);
  const errorRows = parsed.filter(r => r._error);

  async function doImport() {
    if (validRows.length === 0) return;
    setImporting(true);
    setResult(null);
    try {
      const { data, error } = await supabase.rpc('import_historical_records', {
        type,
        rows: validRows,
      }) as { data: { imported: number; errors: string[] } | null; error: unknown };
      if (error) throw new Error(String((error as { message?: string })?.message ?? error));
      const res = data ?? { imported: 0, errors: [] };
      setResult(res);
      if (res.imported > 0) {
        showToast(`${res.imported} record${res.imported !== 1 ? 's' : ''} imported`, 'success');
        setCsvText('');
        setParsed([]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg, 'error');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Historical Import</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          Import old checks and expenses for P&amp;L reporting only — no effect on cash balances or outstanding checks.
        </p>
      </div>

      {/* Info banner */}
      <div className="bg-blue-600/10 border border-blue-500/20 rounded-xl px-4 py-3 text-sm text-blue-300">
        <strong className="text-blue-200">What this does:</strong> Records are saved with <code className="bg-blue-900/40 px-1 rounded">affects_cashflow = false</code> and status <em>cleared</em>. They appear in the <strong>Profit &amp; Loss</strong> report as overhead expenses and in the <strong>Supplier Ledger</strong> as cleared checks — but they never change your bank balance or check outstanding totals.
      </div>

      {/* Type tabs */}
      <div className="flex gap-2">
        {(['checks', 'expenses'] as ImportType[]).map(t => (
          <button
            key={t}
            onClick={() => handleTypeChange(t)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
              type === t
                ? 'bg-blue-600 text-white'
                : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
            }`}
          >
            {t === 'checks' ? 'Check Issuances' : 'Expenses / Bills'}
          </button>
        ))}
      </div>

      {/* Template row */}
      <div className="flex items-center gap-3">
        <button
          onClick={loadTemplate}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
        >
          <ChevronDown className="w-3.5 h-3.5" /> Load example data
        </button>
        <span className="text-slate-700">·</span>
        <button
          onClick={downloadTemplate}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
        >
          <Download className="w-3.5 h-3.5" /> Download CSV template
        </button>
        <span className="text-slate-700">·</span>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
        >
          <Upload className="w-3.5 h-3.5" /> Upload CSV file
        </button>
        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
      </div>

      {/* CSV column guide */}
      <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-400">
        <span className="text-slate-300 font-semibold">Required columns: </span>
        {type === 'checks' ? (
          <>
            <code className="text-blue-300">date</code>,{' '}
            <code className="text-blue-300">check_number</code>,{' '}
            <code className="text-blue-300">amount</code>
            <span className="text-slate-600 mx-2">·</span>
            <span className="text-slate-500">Optional: </span>
            <code>check_date</code>, <code>supplier_name</code>, <code>description</code>
          </>
        ) : (
          <>
            <code className="text-blue-300">date</code>,{' '}
            <code className="text-blue-300">amount</code>
            <span className="text-slate-600 mx-2">·</span>
            <span className="text-slate-500">Optional: </span>
            <code>payee</code>, <code>description</code>
          </>
        )}
        <span className="text-slate-600 mx-2">·</span>
        <span className="text-slate-500">Date format: </span>
        <code>YYYY-MM-DD</code>
      </div>

      {/* CSV paste area */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Paste CSV</label>
        <textarea
          value={csvText}
          onChange={e => handleTextChange(e.target.value)}
          placeholder={type === 'checks'
            ? 'date,check_number,check_date,supplier_name,amount,description\n2024-01-15,CHK-001,2024-01-20,ABC Trading,15000,Office supplies'
            : 'date,payee,amount,description\n2024-01-10,Meralco,5200,Electricity bill'}
          rows={7}
          className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-slate-200 placeholder-slate-600 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          spellCheck={false}
        />
      </div>

      {/* Preview table */}
      {parsed.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">
              Preview — {parsed.length} row{parsed.length !== 1 ? 's' : ''}
              {errorRows.length > 0 && (
                <span className="ml-2 text-amber-400">({errorRows.length} with errors — will be skipped)</span>
              )}
            </p>
            {csvText && (
              <button onClick={() => { setCsvText(''); setParsed([]); setResult(null); }}
                className="text-xs text-slate-500 hover:text-red-400 flex items-center gap-1">
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>

          <div className="bg-[#0f172a] border border-white/10 rounded-xl overflow-hidden">
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#0f172a]">
                  <tr className="border-b border-white/10">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">#</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Date</th>
                    {type === 'checks' && (
                      <>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Check #</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Check Date</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Supplier</th>
                      </>
                    )}
                    {type === 'expenses' && (
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Payee</th>
                    )}
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Amount</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Description</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {parsed.map((row, idx) => {
                    const check = row as ParsedCheck;
                    const expense = row as ParsedExpense;
                    const num = parseFloat(String(row.amount).replace(/,/g, ''));
                    return (
                      <tr key={idx} className={row._error ? 'bg-red-900/10' : 'hover:bg-white/5'}>
                        <td className="px-4 py-2 text-slate-500 text-xs">{idx + 1}</td>
                        <td className="px-4 py-2 text-slate-300 text-xs font-mono">{row.date}</td>
                        {type === 'checks' && (
                          <>
                            <td className="px-4 py-2 text-white text-xs font-mono font-medium">{check.check_number}</td>
                            <td className="px-4 py-2 text-slate-300 text-xs font-mono">{check.check_date}</td>
                            <td className="px-4 py-2 text-slate-300 text-xs">{check.supplier_name || '—'}</td>
                          </>
                        )}
                        {type === 'expenses' && (
                          <td className="px-4 py-2 text-slate-300 text-xs">{expense.payee || '—'}</td>
                        )}
                        <td className="px-4 py-2 text-right font-semibold text-white text-xs">
                          {isNaN(num) ? row.amount : formatCurrency(num)}
                        </td>
                        <td className="px-4 py-2 text-slate-400 text-xs max-w-[200px] truncate">
                          {type === 'checks' ? check.description : expense.description}
                        </td>
                        <td className="px-4 py-2">
                          {row._error ? (
                            <span className="inline-flex items-center gap-1 text-xs text-red-400">
                              <AlertCircle className="w-3 h-3" />{row._error}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                              <CheckCircle2 className="w-3 h-3" />OK
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Summary footer */}
            <div className="border-t border-white/10 px-4 py-2.5 flex items-center justify-between bg-white/5">
              <p className="text-xs text-slate-400">
                <span className="text-emerald-400 font-semibold">{validRows.length} valid</span>
                {errorRows.length > 0 && <span className="text-red-400 ml-3 font-semibold">{errorRows.length} will be skipped</span>}
              </p>
              <p className="text-xs font-semibold text-white">
                Total: {formatCurrency(validRows.reduce((s, r) => s + parseFloat(String(r.amount).replace(/,/g, '') || '0'), 0))}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Import result */}
      {result && (
        <div className={`rounded-xl px-4 py-3 text-sm ${result.imported > 0 ? 'bg-emerald-600/10 border border-emerald-500/20 text-emerald-300' : 'bg-red-600/10 border border-red-500/20 text-red-300'}`}>
          {result.imported > 0 && (
            <p className="flex items-center gap-2 font-semibold mb-1">
              <CheckCircle2 className="w-4 h-4" />
              {result.imported} record{result.imported !== 1 ? 's' : ''} imported successfully
            </p>
          )}
          {result.errors.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-red-400 list-disc list-inside">
              {result.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
              {result.errors.length > 10 && <li>… and {result.errors.length - 10} more</li>}
            </ul>
          )}
        </div>
      )}

      {/* Import button */}
      {validRows.length > 0 && (
        <div className="flex items-center gap-4">
          <button
            onClick={doImport}
            disabled={importing}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
          >
            {importing
              ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <FileText className="w-4 h-4" />}
            {importing ? 'Importing…' : `Import ${validRows.length} Record${validRows.length !== 1 ? 's' : ''}`}
          </button>
          <p className="text-xs text-slate-500">
            These records will appear in P&amp;L reports but will not affect your cash balances.
          </p>
        </div>
      )}
    </div>
  );
}
