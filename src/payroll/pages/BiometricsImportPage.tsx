import { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { Upload, Download, CheckCircle, AlertCircle, FileText } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';

interface Cutoff {
  cutoff_id: number;
  period_name: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
  error_list: string[];
}

const REQUIRED_FIELDS = [
  'employee_code',
  'work_date',
  'time_in',
  'time_out',
  'hours_worked',
  'overtime_hours',
] as const;

type RequiredField = typeof REQUIRED_FIELDS[number];

function downloadTemplate() {
  const csv =
    'employee_code,work_date,time_in,time_out,hours_worked,overtime_hours\n' +
    'EMP001,2025-01-15,08:00,17:00,9,0';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'biometrics-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function BiometricsImportPage() {
  const { showToast } = useToast();

  const [cutoffs, setCutoffs] = useState<Cutoff[]>([]);
  const [selectedCutoffId, setSelectedCutoffId] = useState('');
  const [batchName, setBatchName] = useState('');

  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMap, setColumnMap] = useState<Record<RequiredField, string>>({
    employee_code: '',
    work_date: '',
    time_in: '',
    time_out: '',
    hours_worked: '',
    overtime_hours: '',
  });

  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  // Load cutoffs for the dropdown
  useEffect(() => {
    async function loadCutoffs() {
      try {
        const { data, error } = await supabase.rpc('search_payroll_cutoffs', {
          year: null,
          status: null,
          page: 1,
          page_size: 100,
        });
        if (error) throw error;
        const res = data as { cutoffs: Cutoff[] } | null;
        const list = res?.cutoffs ?? [];
        setCutoffs(list);
        if (list.length > 0) {
          setSelectedCutoffId(String(list[0].cutoff_id));
        }
      } catch {
        // silently ignore
      }
    }
    loadCutoffs();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsedRows([]);
    setHeaders([]);
    setResult(null);
    setColumnMap({
      employee_code: '',
      work_date: '',
      time_in: '',
      time_out: '',
      hours_worked: '',
      overtime_hours: '',
    });

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data;
        const fields = results.meta.fields ?? [];
        setParsedRows(rows);
        setHeaders(fields);

        // Auto-map if header names match required fields
        const autoMap: Record<RequiredField, string> = {
          employee_code: '',
          work_date: '',
          time_in: '',
          time_out: '',
          hours_worked: '',
          overtime_hours: '',
        };
        for (const field of REQUIRED_FIELDS) {
          if (fields.includes(field)) {
            autoMap[field] = field;
          }
        }
        setColumnMap(autoMap);

        showToast(`Parsed ${rows.length} row${rows.length !== 1 ? 's' : ''} from CSV`, 'success');
      },
      error: (err) => {
        showToast(err.message ?? 'Failed to parse CSV', 'error');
      },
    });

    // Reset input so same file can be re-uploaded
    e.target.value = '';
  };

  const mappedRows = parsedRows.map(row => {
    const mapped: Record<string, string> = {};
    for (const field of REQUIRED_FIELDS) {
      const col = columnMap[field];
      mapped[field] = col ? (row[col] ?? '') : '';
    }
    return mapped;
  });

  const handleImport = async () => {
    if (!selectedCutoffId) { showToast('Select a cutoff period first', 'error'); return; }
    if (parsedRows.length === 0) { showToast('No rows to import', 'error'); return; }

    const unmapped = REQUIRED_FIELDS.filter(f => !columnMap[f]);
    if (unmapped.length > 0) {
      showToast(`Map all required fields. Missing: ${unmapped.join(', ')}`, 'error');
      return;
    }

    setImporting(true);
    setResult(null);
    try {
      const { data, error } = await supabase.rpc('import_biometrics', {
        rows: mappedRows,
        cutoff_id: parseInt(selectedCutoffId),
        batch_name: batchName.trim() || `Import ${new Date().toISOString().slice(0, 10)}`,
        created_by: 'admin',
      });
      if (error) throw error;

      const res = data as ImportResult | null;
      setResult({
        imported: res?.imported ?? 0,
        skipped: res?.skipped ?? 0,
        errors: res?.errors ?? 0,
        error_list: res?.error_list ?? [],
      });
      showToast(
        `Import complete: ${res?.imported ?? 0} imported, ${res?.skipped ?? 0} skipped, ${res?.errors ?? 0} errors`,
        (res?.errors ?? 0) > 0 ? 'warning' : 'success',
      );
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Import failed', 'error');
    } finally {
      setImporting(false);
    }
  };

  const previewRows = parsedRows.slice(0, 50);
  const isMappingComplete = REQUIRED_FIELDS.every(f => columnMap[f]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Biometrics Import</h1>
        <p className="text-sm text-slate-500 mt-0.5">Import attendance records from a biometrics CSV export.</p>
      </div>

      {/* Step 1: Select Cutoff */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center">1</span>
          Select Cutoff Period &amp; Batch Name
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Cutoff Period <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedCutoffId}
              onChange={e => setSelectedCutoffId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select cutoff…</option>
              {cutoffs.map(c => (
                <option key={c.cutoff_id} value={c.cutoff_id}>{c.period_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Batch Name</label>
            <input
              type="text"
              value={batchName}
              onChange={e => setBatchName(e.target.value)}
              placeholder={`Import ${new Date().toISOString().slice(0, 10)}`}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Step 2: Download Template */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center">2</span>
          Download CSV Template
        </h2>
        <p className="text-sm text-slate-500">
          Use this template to format your biometrics data. Required columns:&nbsp;
          <code className="bg-slate-100 px-1 rounded text-xs">employee_code, work_date, time_in, time_out, hours_worked, overtime_hours</code>
        </p>
        <button
          onClick={downloadTemplate}
          className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50"
        >
          <Download className="w-4 h-4" />
          Download Template
        </button>
      </div>

      {/* Step 3: Upload CSV */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center">3</span>
          Upload CSV File
        </h2>
        <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl p-8 cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
          <Upload className="w-8 h-8 text-slate-400 mb-2" />
          <span className="text-sm font-medium text-slate-600">Click to upload CSV</span>
          <span className="text-xs text-slate-400 mt-1">CSV files only</span>
          <input
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileChange}
          />
        </label>
        {parsedRows.length > 0 && (
          <p className="text-sm text-green-600 flex items-center gap-1.5">
            <CheckCircle className="w-4 h-4" />
            {parsedRows.length} rows parsed ({headers.length} columns detected)
          </p>
        )}
      </div>

      {/* Step 4: Map Columns */}
      {headers.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center">4</span>
            Map CSV Columns
          </h2>
          <p className="text-sm text-slate-500">
            Match each required field to the corresponding column from your CSV.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {REQUIRED_FIELDS.map(field => (
              <div key={field}>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {field} <span className="text-red-500">*</span>
                </label>
                <select
                  value={columnMap[field]}
                  onChange={e =>
                    setColumnMap(prev => ({ ...prev, [field]: e.target.value }))
                  }
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— select column —</option>
                  {headers.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {isMappingComplete && (
            <p className="text-sm text-green-600 flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4" />
              All fields mapped
            </p>
          )}
        </div>
      )}

      {/* Preview Table */}
      {parsedRows.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-medium text-slate-700">
              Preview — first {previewRows.length} of {parsedRows.length} rows
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  {headers.map(h => (
                    <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                    {headers.map(h => (
                      <td key={h} className="px-3 py-2 text-slate-700 whitespace-nowrap">{row[h] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Step 5: Import */}
      {parsedRows.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center">5</span>
            Import
          </h2>
          <p className="text-sm text-slate-500">
            Ready to import <strong>{parsedRows.length}</strong> rows into the selected cutoff period.
          </p>
          <button
            onClick={handleImport}
            disabled={importing || !isMappingComplete || !selectedCutoffId}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60"
          >
            <Upload className="w-4 h-4" />
            {importing ? 'Importing…' : 'Import Records'}
          </button>

          {/* Import Result */}
          {result && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-700">{result.imported}</p>
                  <p className="text-xs text-green-600 font-medium mt-0.5">Imported</p>
                </div>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-yellow-700">{result.skipped}</p>
                  <p className="text-xs text-yellow-600 font-medium mt-0.5">Skipped</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-red-700">{result.errors}</p>
                  <p className="text-xs text-red-600 font-medium mt-0.5">Errors</p>
                </div>
              </div>

              {result.error_list && result.error_list.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-1">
                  <p className="text-sm font-medium text-red-700 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4" />
                    Error Details
                  </p>
                  <ul className="text-xs text-red-600 space-y-0.5 max-h-40 overflow-y-auto">
                    {result.error_list.map((e, i) => (
                      <li key={i} className="flex items-start gap-1">
                        <span className="text-red-400 mt-0.5">•</span>
                        {e}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
