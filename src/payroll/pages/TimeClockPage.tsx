import { useState, useEffect, useRef } from 'react';
import { LogIn, LogOut, RefreshCw, MonitorSmartphone, Maximize, Minimize } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface ClockResult {
  employee_name: string;
  log_date: string;
  log_time: string;
  log_type: 'TIME_IN' | 'TIME_OUT';
}

interface EmployeeClockStatus {
  can_time_in: boolean;
  can_time_out: boolean;
  message: string;
  first_time_in?: string | null;
  last_time_out?: string | null;
}

export default function TimeClockPage({ kioskMode = false }: { kioskMode?: boolean }) {
  const [now, setNow] = useState(new Date());
  const [employeeCode, setEmployeeCode] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [clockStatus, setClockStatus] = useState<EmployeeClockStatus | null>(null);
  const [result, setResult] = useState<ClockResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Live clock
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    handleFullscreenChange();
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Auto-clear result after 5 seconds
  useEffect(() => {
    if (result || error) {
      const t = setTimeout(() => {
        setResult(null);
        setError('');
        setEmployeeCode('');
        setEmployeeName('');
        setClockStatus(null);
        inputRef.current?.focus();
      }, 5000);
      return () => clearTimeout(t);
    }
  }, [result, error]);

  const formatTime = (d: Date) =>
    d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  const formatDate = (d: Date) =>
    d.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  useEffect(() => {
    const code = employeeCode.trim().toUpperCase();
    if (!code) {
      setEmployeeName('');
      setClockStatus(null);
      return;
    }

    const timer = window.setTimeout(async () => {
      setStatusLoading(true);
      try {
        const { data, error: lookupError } = await supabase.rpc('get_employee_by_code', {
          employee_code: code,
        });
        if (lookupError) throw lookupError;

        const employee = (data as { employee?: { first_name?: string; last_name?: string }; clock_status?: EmployeeClockStatus })?.employee;
        const status = (data as { clock_status?: EmployeeClockStatus })?.clock_status ?? null;
        setEmployeeName(employee ? `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim() : '');
        setClockStatus(status);
      } catch {
        setEmployeeName('');
        setClockStatus(null);
      } finally {
        setStatusLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [employeeCode]);

  const handleClock = async (logType: 'TIME_IN' | 'TIME_OUT') => {
    if (!employeeCode.trim()) {
      setError('Please enter your Employee ID');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('employee_clock', {
        employee_code: employeeCode.trim().toUpperCase(),
        log_type: logType,
        device_name: window.location.hostname,
      });
      if (rpcError) throw rpcError;
      setResult(data as ClockResult);
      setClockStatus(
        logType === 'TIME_IN'
          ? { can_time_in: false, can_time_out: true, message: 'Already timed in today — only Time Out is enabled' }
          : { can_time_in: false, can_time_out: false, message: 'Attendance already completed for today' }
      );
    } catch (err: unknown) {
      setError((err as Error).message ?? 'Failed to record time');
    } finally {
      setLoading(false);
    }
  };

  const canTimeIn = Boolean(clockStatus?.can_time_in);
  const canTimeOut = Boolean(clockStatus?.can_time_out);

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // ignore fullscreen errors
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-8 select-none relative">

      {kioskMode && (
        <div className="absolute top-4 right-4 flex items-center gap-2">
          <span className="hidden md:inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300 border border-emerald-500/30">
            <MonitorSmartphone className="w-3.5 h-3.5" />
            Kiosk Mode
          </span>
          <button
            onClick={toggleFullscreen}
            className="inline-flex items-center gap-2 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-2 text-xs font-semibold text-white border border-white/20"
          >
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
        </div>
      )}

      {/* Clock display */}
      <div className="text-center mb-10">
        <div className="text-7xl font-bold text-white tabular-nums tracking-tight mb-2">
          {formatTime(now)}
        </div>
        <div className="text-2xl text-slate-300 font-medium">
          {formatDate(now)}
        </div>
      </div>

      {/* Input card */}
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="flex items-center justify-center gap-2 mb-6">
          <h1 className="text-2xl font-bold text-slate-800 text-center">
            Employee Time Clock
          </h1>
          {!kioskMode && (
            <a
              href="/timeclock/kiosk"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 hover:bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              <MonitorSmartphone className="w-3.5 h-3.5" />
              Open Kiosk Mode
            </a>
          )}
        </div>

        <div className="mb-6">
          <label className="block text-sm font-semibold text-slate-600 mb-2 text-center">
            Enter Your Employee ID
          </label>
          <input
            ref={inputRef}
            type="text"
            value={employeeCode}
            onChange={e => setEmployeeCode(e.target.value.toUpperCase())}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                if (canTimeIn) handleClock('TIME_IN');
                else if (canTimeOut) handleClock('TIME_OUT');
              }
            }}
            placeholder="e.g. EMP-001"
            autoFocus
            className="w-full border-2 border-slate-300 rounded-xl px-4 py-4 text-2xl font-bold text-center tracking-widest focus:outline-none focus:border-blue-500 uppercase"
            disabled={loading}
          />
        </div>

        {(employeeName || clockStatus?.message || statusLoading) && (
          <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
            {employeeName && <div className="text-lg font-bold text-slate-800">{employeeName}</div>}
            <div className="text-sm text-slate-600 mt-1">
              {statusLoading ? 'Checking today\'s time log…' : (clockStatus?.message ?? 'Ready')}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => handleClock('TIME_IN')}
            disabled={loading || statusLoading || !employeeCode.trim() || !canTimeIn}
            className="flex items-center justify-center gap-3 py-5 bg-green-600 hover:bg-green-700 text-white text-xl font-bold rounded-xl transition-colors disabled:opacity-50"
          >
            <LogIn className="w-7 h-7" />
            Time In
          </button>
          <button
            onClick={() => handleClock('TIME_OUT')}
            disabled={loading || statusLoading || !employeeCode.trim() || !canTimeOut}
            className="flex items-center justify-center gap-3 py-5 bg-blue-600 hover:bg-blue-700 text-white text-xl font-bold rounded-xl transition-colors disabled:opacity-50"
          >
            <LogOut className="w-7 h-7" />
            Time Out
          </button>
        </div>

        {loading && (
          <div className="mt-6 flex items-center justify-center gap-2 text-slate-500">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>Recording…</span>
          </div>
        )}

        {result && (
          <div className="mt-6 bg-green-50 border-2 border-green-400 rounded-xl p-5 text-center animate-pulse-once">
            <div className="text-3xl font-bold text-green-700 mb-1">
              {result.log_type === 'TIME_IN' ? '✓ Clocked In' : '✓ Clocked Out'}
            </div>
            <div className="text-xl font-semibold text-slate-800">{result.employee_name}</div>
            <div className="text-lg text-slate-600 mt-1">
              {result.log_date} at{' '}
              <span className="font-bold text-green-700">{result.log_time}</span>
            </div>
            <div className="text-xs text-slate-400 mt-2">This will close automatically in 5 seconds</div>
          </div>
        )}

        {error && (
          <div className="mt-6 bg-red-50 border-2 border-red-400 rounded-xl p-4 text-center">
            <div className="text-red-700 font-semibold text-lg">{error}</div>
            <div className="text-xs text-slate-400 mt-1">This will close automatically in 5 seconds</div>
          </div>
        )}
      </div>

      <p className="mt-6 text-slate-500 text-sm text-center">
        {kioskMode
          ? 'Shared attendance kiosk is active — keep this screen open for employee Time In and Time Out.'
          : 'This is a shared workstation — please do not close this browser tab.'}
      </p>
    </div>
  );
}
