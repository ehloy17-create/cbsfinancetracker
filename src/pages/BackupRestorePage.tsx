import { useState, useEffect, useRef } from 'react';
import {
  Download, Upload, Database, FolderOpen,
  AlertTriangle, CheckCircle2, RefreshCw, Info,
} from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { resolveApiBase } from '../lib/apiBase';

interface BackupInfo {
  dbName: string;
  dbHost: string;
  dbPort: string;
  tableCount: number;
}

function getAuthHeader(): Record<string, string> {
  const directToken = localStorage.getItem('access_token');
  if (directToken) {
    return { Authorization: `Bearer ${directToken}` };
  }

  const legacyRaw = localStorage.getItem('sb-session');
  if (!legacyRaw) return {};

  try {
    const session = JSON.parse(legacyRaw);
    const token = session?.access_token || session?.token;
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {
    // fall through
  }

  return {};
}

export default function BackupRestorePage() {
  const { showToast } = useToast();
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [restoreResult, setRestoreResult] = useState<{ ok: boolean; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadInfo();
  }, []);

  async function loadInfo() {
    setInfoLoading(true);
    try {
      const base = resolveApiBase();
      const res = await fetch(`${base}/backup/info`, {
        headers: { ...getAuthHeader() },
      });
      if (!res.ok) throw new Error(await res.text());
      setInfo(await res.json());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Could not load backup info: ${msg}`, 'error');
    } finally {
      setInfoLoading(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const base = resolveApiBase();
      const res = await fetch(`${base}/backup/download`, {
        headers: { ...getAuthHeader() },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || res.statusText);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const dateStr = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `biztracker-backup-${dateStr}.sql`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Backup downloaded successfully', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Download failed: ${msg}`, 'error');
    } finally {
      setDownloading(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setRestoreFile(f);
    setRestoreResult(null);
    setShowConfirm(false);
  }

  async function handleRestore() {
    if (!restoreFile) return;
    setRestoring(true);
    setRestoreResult(null);
    try {
      const base = resolveApiBase();
      const form = new FormData();
      form.append('backup', restoreFile);
      const res = await fetch(`${base}/backup/restore`, {
        method: 'POST',
        headers: { ...getAuthHeader() },
        body: form,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.statusText);
      setRestoreResult({ ok: true, message: body.message });
      setRestoreFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      showToast('Restore successful — please reload the app', 'success');
      await loadInfo();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRestoreResult({ ok: false, message: msg });
      showToast(`Restore failed: ${msg}`, 'error');
    } finally {
      setRestoring(false);
      setShowConfirm(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-1">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Backup &amp; Restore</h1>
        <p className="text-sm text-slate-500 mt-1">
          Export your entire database to a <code>.sql</code> file, or restore from a previous backup.
        </p>
      </div>

      {/* Data location info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2 text-blue-700 font-semibold text-sm">
          <FolderOpen className="w-4 h-4" />
          Where is my data stored?
        </div>
        <div className="text-sm text-blue-700 space-y-1">
          <div className="flex items-start gap-2">
            <Database className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Database files</p>
              <p className="font-mono text-xs bg-blue-100 rounded px-2 py-1 mt-0.5">
                C:\ProgramData\BizTracker\mariadb-data\
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Config / credentials</p>
              <p className="font-mono text-xs bg-blue-100 rounded px-2 py-1 mt-0.5">
                C:\ProgramData\BizTracker\config\app.env
              </p>
            </div>
          </div>
          <p className="text-xs text-blue-600 mt-1">
            ⚠ When moving to a new device: always use the Backup feature below to export your data,
            install BizTracker on the new device, then use Restore to import your data.
          </p>
        </div>
      </div>

      {/* DB status */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-700 text-sm flex items-center gap-2">
            <Database className="w-4 h-4" /> Database Status
          </h2>
          <button
            onClick={loadInfo}
            disabled={infoLoading}
            className="text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-4 h-4 ${infoLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {infoLoading ? (
          <p className="text-sm text-slate-400">Loading...</p>
        ) : info ? (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-slate-500 text-xs">Database</p>
              <p className="font-semibold text-slate-800">{info.dbName}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-slate-500 text-xs">Tables</p>
              <p className="font-semibold text-slate-800">{info.tableCount}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 col-span-2">
              <p className="text-slate-500 text-xs">Connection</p>
              <p className="font-semibold text-slate-800">{info.dbHost}:{info.dbPort}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-red-500">Could not load database info.</p>
        )}
      </div>

      {/* Download backup */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <h2 className="font-semibold text-slate-700 text-sm flex items-center gap-2">
          <Download className="w-4 h-4 text-green-600" /> Download Backup
        </h2>
        <p className="text-sm text-slate-500">
          Exports all tables and data as a <code>.sql</code> file you can keep as a safe copy
          or use to migrate to another device.
        </p>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-semibold text-sm rounded-lg transition-colors"
        >
          {downloading ? (
            <><RefreshCw className="w-4 h-4 animate-spin" /> Generating…</>
          ) : (
            <><Download className="w-4 h-4" /> Download Backup (.sql)</>
          )}
        </button>
      </div>

      {/* Restore */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h2 className="font-semibold text-slate-700 text-sm flex items-center gap-2">
          <Upload className="w-4 h-4 text-blue-600" /> Restore from Backup
        </h2>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2 text-amber-700 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            <strong>Warning:</strong> Restoring will overwrite all current data in the database.
            This cannot be undone. Make sure you have downloaded a fresh backup first.
          </span>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Select backup file (.sql)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".sql,text/plain,application/octet-stream"
            onChange={handleFileChange}
            className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          {restoreFile && (
            <p className="mt-1.5 text-xs text-slate-500">
              Selected: <span className="font-medium">{restoreFile.name}</span>{' '}
              ({(restoreFile.size / 1024).toFixed(1)} KB)
            </p>
          )}
        </div>

        {restoreFile && !showConfirm && (
          <button
            onClick={() => setShowConfirm(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-lg transition-colors"
          >
            <Upload className="w-4 h-4" /> Restore Database
          </button>
        )}

        {showConfirm && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-red-700">
              Are you sure? This will replace ALL current data with the contents of{' '}
              <span className="font-mono">{restoreFile?.name}</span>.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleRestore}
                disabled={restoring}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-semibold text-sm rounded-lg transition-colors"
              >
                {restoring ? (
                  <><RefreshCw className="w-4 h-4 animate-spin" /> Restoring…</>
                ) : (
                  'Yes, Restore Now'
                )}
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                disabled={restoring}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {restoreResult && (
          <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${restoreResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {restoreResult.ok
              ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              : <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
            <span>{restoreResult.message}</span>
          </div>
        )}
      </div>

      {/* Migration guide */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-600 space-y-2">
        <p className="font-semibold text-slate-700">📦 Moving to a new device?</p>
        <ol className="list-decimal list-inside space-y-1 text-slate-600">
          <li>On this device: click <strong>Download Backup</strong> and save the .sql file</li>
          <li>On the new device: run <strong>biztracker-setup-x.x.x.exe</strong> to install</li>
          <li>Open the app on the new device and log in</li>
          <li>Go to <strong>Settings → Backup &amp; Restore</strong></li>
          <li>Upload the .sql file and click <strong>Restore Database</strong></li>
          <li>Reload the app — all your data will be there</li>
        </ol>
      </div>
    </div>
  );
}
