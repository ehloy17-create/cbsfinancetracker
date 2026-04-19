import { useState, useRef } from 'react';
import { Upload, Download, CheckCircle, AlertCircle, FileText, X } from 'lucide-react';
import Papa from 'papaparse';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

type EntityType = 'categories' | 'suppliers' | 'products' | 'daily_sales';

const TABS: { id: EntityType; label: string; description: string }[] = [
  { id: 'categories', label: 'Categories', description: 'Import product categories with optional parent hierarchy' },
  { id: 'suppliers', label: 'Suppliers', description: 'Import supplier master data' },
  { id: 'products', label: 'Products', description: 'Import products with category, brand, unit and supplier links' },
  { id: 'daily_sales', label: 'Daily Sales', description: 'Import manual daily sales and cost of sales history' },
];

const TEMPLATES: Record<EntityType, { headers: string[]; sample: string[][] }> = {
  categories: {
    headers: ['code', 'name', 'parent_code', 'description', 'sort_order', 'is_active'],
    sample: [
      ['FMCG', 'FMCG Products', '', 'Fast moving consumer goods', '1', 'true'],
      ['BVNG', 'Beverages', 'FMCG', 'Drinks and beverages', '2', 'true'],
    ],
  },
  suppliers: {
    headers: ['code', 'name', 'contact_person', 'phone', 'email', 'address', 'city', 'terms', 'notes', 'is_active'],
    sample: [
      ['SUP001', 'ABC Trading', 'Juan Dela Cruz', '09171234567', 'abc@trading.com', '123 Main St', 'Manila', '30 days', '', 'true'],
    ],
  },
  products: {
    headers: ['code', 'barcode', 'name', 'short_name', 'category_code', 'brand_name', 'unit_code', 'location_code', 'qty', 'supplier_name', 'supplier_code', 'cost', 'retail_price', 'wholesale_price', 'special_price', 'reorder_level', 'expiry_tracked', 'is_active', 'notes'],
    sample: [
      ['COKE-1L', '4902102027359', 'Coca-Cola 1L', 'Coke 1L', 'BVNG', 'Coca-Cola', 'PCS', 'MAIN', '24', 'ABC Trading', 'SUP001', '45', '55', '52', '50', '10', 'false', 'true', 'Overwrites existing item if code already exists'],
    ],
  },
  daily_sales: {
    headers: ['date', 'description', 'sales', 'cost_of_sales', 'notes'],
    sample: [
      ['1/2/2026', '', '45636.00', '37296.53', 'Imported previous record'],
      ['1/3/2026', '', '22662.00', '18422.66', 'Imported previous record'],
    ],
  },
};

const OPTIONAL_HEADERS: Record<EntityType, string[]> = {
  categories: ['parent_code', 'description', 'sort_order', 'is_active'],
  suppliers: ['contact_person', 'phone', 'email', 'address', 'city', 'terms', 'notes', 'is_active'],
  products: ['barcode', 'short_name', 'category_code', 'brand_name', 'unit_code', 'location_code', 'qty', 'supplier_name', 'supplier_code', 'cost', 'retail_price', 'wholesale_price', 'special_price', 'reorder_level', 'expiry_tracked', 'is_active', 'notes'],
  daily_sales: ['description', 'notes'],
};

const PRODUCT_CODE_ALIASES = ['code', 'sku', 'sku_code', 'product_code'];

interface ImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export default function InvImportPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<EntityType>('categories');
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  function downloadTemplate(entity: EntityType) {
    const { headers, sample } = TEMPLATES[entity];
    const csv = Papa.unparse({ fields: headers, data: sample });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `import_${entity}_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleTabChange(tab: EntityType) {
    setActiveTab(tab);
    resetFile();
  }

  function resetFile() {
    setParsedRows([]);
    setParseErrors([]);
    setFileName('');
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const templateHeaders = TEMPLATES[activeTab].headers;
        const fileHeaders = (results.meta.fields ?? []).map((field) => String(field).trim().toLowerCase());
        const fileHeaderSet = new Set(fileHeaders);
        const optionalHeaders = new Set(OPTIONAL_HEADERS[activeTab] ?? []);

        const missing = templateHeaders.filter((header) => {
          const normalizedHeader = header.toLowerCase();
          if (optionalHeaders.has(header)) {
            return false;
          }
          if (activeTab === 'products' && normalizedHeader === 'code') {
            return !PRODUCT_CODE_ALIASES.some((alias) => fileHeaderSet.has(alias));
          }
          return !fileHeaderSet.has(normalizedHeader);
        });

        if (missing.length > 0) {
          setParseErrors([`Missing required columns: ${missing.join(', ')}`]);
          setParsedRows([]);
        } else {
          setParseErrors([]);
          setParsedRows(results.data as Record<string, string>[]);
        }
      },
      error: (err) => {
        setParseErrors([`Parse error: ${err.message}`]);
        setParsedRows([]);
      },
    });
  }

  async function handleImport() {
    if (parsedRows.length === 0) return;
    setImporting(true);
    setResult(null);
    try {
      const { data, error } = await supabase.rpc('bulk_import', {
        entity: activeTab,
        rows: parsedRows,
        created_by: user?.id ?? null,
      });
      if (error) throw new Error(error.message);
      setResult(data as ImportResult);
      showToast(
        `Import complete: ${data.inserted} added, ${data.updated} updated, ${data.skipped} skipped`,
        data.errors?.length > 0 ? 'warning' : 'success'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Import failed';
      showToast(msg, 'error');
    } finally {
      setImporting(false);
    }
  }

  const tab = TABS.find(t => t.id === activeTab)!;
  const previewCols = TEMPLATES[activeTab].headers;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Upload className="w-6 h-6 text-blue-600" />
          Import Data
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Bulk import products, categories, suppliers, and daily sales from CSV files. Existing matching records are updated during import.
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 flex gap-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => handleTabChange(t.id)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Upload Panel */}
        <div className="lg:col-span-1 space-y-4">
          {/* Step 1: Download Template */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Step 1 — Download Template
            </h3>
            <p className="text-sm text-gray-500">{tab.description}</p>
            <button
              onClick={() => downloadTemplate(activeTab)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <Download className="w-4 h-4" />
              Download CSV Template
            </button>
          </div>

          {/* Step 2: Upload File */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Step 2 — Upload CSV File
            </h3>
            <label className="w-full flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-6 cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
              <FileText className="w-8 h-8 text-gray-400 mb-2" />
              <span className="text-sm text-gray-600 text-center">
                {fileName ? fileName : 'Click to choose a CSV file'}
              </span>
              <span className="text-xs text-gray-400 mt-1">CSV format only</span>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFile}
              />
            </label>
            {fileName && (
              <button
                onClick={resetFile}
                className="text-xs text-red-500 hover:underline flex items-center gap-1"
              >
                <X className="w-3 h-3" /> Clear file
              </button>
            )}
          </div>

          {/* Step 3: Import */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Step 3 — Import
            </h3>
            {parsedRows.length > 0 && (
              <p className="text-sm text-gray-600">
                <span className="font-semibold text-blue-700">{parsedRows.length}</span> rows ready to import.
              </p>
            )}
            <button
              onClick={handleImport}
              disabled={parsedRows.length === 0 || importing}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {importing ? (
                <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Importing…</>
              ) : (
                <><Upload className="w-4 h-4" />Import {parsedRows.length > 0 ? `${parsedRows.length} Rows` : 'Data'}</>
              )}
            </button>
          </div>

          {/* Result Summary */}
          {result && (
            <div className={`rounded-lg p-4 border ${result.errors.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                {result.errors.length > 0
                  ? <AlertCircle className="w-4 h-4 text-amber-600" />
                  : <CheckCircle className="w-4 h-4 text-emerald-600" />}
                <span className="text-sm font-semibold">Import Complete</span>
              </div>
              <div className="text-sm space-y-0.5">
                <p><span className="font-medium text-emerald-700">{result.inserted}</span> inserted</p>
                <p><span className="font-medium text-blue-700">{result.updated}</span> updated</p>
                {result.skipped > 0 && <p><span className="font-medium text-amber-700">{result.skipped}</span> skipped</p>}
              </div>
              {result.errors.length > 0 && (
                <div className="mt-2 space-y-1">
                  {result.errors.slice(0, 5).map((e, i) => (
                    <p key={i} className="text-xs text-amber-700">{e}</p>
                  ))}
                  {result.errors.length > 5 && (
                    <p className="text-xs text-amber-600">…and {result.errors.length - 5} more</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Preview Panel */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">
                {parsedRows.length > 0 ? `Preview (${parsedRows.length} rows)` : 'Preview'}
              </h3>
              {parseErrors.length > 0 && (
                <span className="text-xs text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> {parseErrors[0]}
                </span>
              )}
            </div>
            {parsedRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <Upload className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm">Upload a CSV file to preview the data here</p>
                <p className="text-xs mt-1">Download the template to see the expected format</p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">#</th>
                      {previewCols.map(col => (
                        <th key={col} className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {parsedRows.slice(0, 100).map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
                        {previewCols.map(col => (
                          <td key={col} className="px-3 py-1.5 text-gray-700 max-w-[160px] truncate" title={row[col]}>
                            {row[col] || <span className="text-gray-300">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedRows.length > 100 && (
                  <p className="text-center text-xs text-gray-400 py-3">
                    Showing first 100 of {parsedRows.length} rows. All rows will be imported.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Column reference */}
          <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Column Reference</p>
            <div className="flex flex-wrap gap-2">
              {previewCols.map(col => (
                <span key={col} className="text-xs font-mono bg-white border border-gray-200 rounded px-2 py-0.5 text-gray-600">
                  {col}
                </span>
              ))}
            </div>
            {activeTab === 'products' && (
              <p className="text-xs text-gray-500 mt-2">
                <span className="font-medium">code</span> may also be uploaded as <span className="font-medium">sku</span>. If the code already exists, that product is updated. Optional <span className="font-medium">qty</span> sets the current stock balance for the chosen <span className="font-medium">location_code</span> during migration.
              </p>
            )}
            {activeTab === 'categories' && (
              <p className="text-xs text-gray-500 mt-2">
                <span className="font-medium">parent_code</span> must reference an existing category code. Leave blank for top-level categories.
              </p>
            )}
            {activeTab === 'daily_sales' && (
              <p className="text-xs text-gray-500 mt-2">
                <span className="font-medium">date</span> accepts import-friendly dates like <span className="font-medium">1/2/2026</span>. Matching dates update the existing <span className="font-medium">daily_sales</span> row instead of creating duplicates.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
