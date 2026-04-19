/**
 * Local API adapter — drop-in replacement for the Supabase client.
 *
 * This module exposes the same interface the frontend already uses:
 *   supabase.from(table).select() / .insert() / .update() / .delete()
 *   supabase.auth.signInWithPassword()  / .signOut() / .getSession()
 *   supabase.rpc(fnName, params)
 *
 * All calls are routed to the local Express server instead of Supabase.
 */

import { buildApiUrl } from './apiBase';

// ── Token storage ─────────────────────────────────────────────────
function getToken(): string | null {
  return localStorage.getItem('access_token');
}
function setToken(token: string | null) {
  if (token) localStorage.setItem('access_token', token);
  else        localStorage.removeItem('access_token');
}

// ── Auth state listeners ──────────────────────────────────────────
type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED';
type AuthListener = (event: AuthEvent, session: any) => void;
const authListeners: AuthListener[] = [];

function notifyAuth(event: AuthEvent, session: any) {
  authListeners.forEach(fn => fn(event, session));
}

// ── Base fetch helper ─────────────────────────────────────────────
async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<any> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(buildApiUrl(path), { ...options, headers });

  if (res.status === 401) {
    setToken(null);
    notifyAuth('SIGNED_OUT', null);
  }

  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: text };
  }
}

// ── Query builder ─────────────────────────────────────────────────
class QueryBuilder {
  private _table: string;
  private _filters: Record<string, string> = {};
  private _select: string = '*';
  private _order: string[] = [];
  private _limit?: number;
  private _offset?: number;
  private _single = false;
  private _maybeSingle = false;

  constructor(table: string) {
    this._table = table;
  }

  select(cols = '*'): this { this._select = cols; return this; }

  eq(col: string, val: any):     this { this._filters[col] = `eq.${val}`;               return this; }
  neq(col: string, val: any):    this { this._filters[col] = `neq.${val}`;              return this; }
  gt(col: string, val: any):     this { this._filters[col] = `gt.${val}`;               return this; }
  gte(col: string, val: any):    this { this._filters[col] = `gte.${val}`;              return this; }
  lt(col: string, val: any):     this { this._filters[col] = `lt.${val}`;               return this; }
  lte(col: string, val: any):    this { this._filters[col] = `lte.${val}`;              return this; }
  is(col: string, val: any):     this { this._filters[col] = `is.${val}`;               return this; }
  in(col: string, vals: any[]):  this { this._filters[col] = `in.(${vals.join(',')})`;  return this; }
  ilike(col: string, val: any):  this { this._filters[col] = `ilike.${val}`;            return this; }
  like(col: string, val: any):   this { this._filters[col] = `like.${val}`;             return this; }

  not(col: string, op: string, val: any): this {
    if (op === 'is' && val === null) this._filters[col] = 'not.is.null';
    else                             this._filters[col] = `neq.${val}`;
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    const dir = opts?.ascending === false ? 'desc' : 'asc';
    this._order.push(`${col}.${dir}`);
    return this;
  }

  limit(n: number): this { this._limit = n; return this; }
  range(from: number, to: number): this {
    this._offset = from;
    this._limit  = to - from + 1;
    return this;
  }

  single():      this { this._single      = true; return this; }
  maybeSingle(): this { this._maybeSingle = true; return this; }

  private _buildQS(extra: Record<string, string> = {}): string {
    const params: Record<string, string> = {
      select: this._select,
      ...this._filters,
      ...extra,
    };
    if (this._order.length)   params['order']  = this._order.join(',');
    if (this._limit != null)  params['limit']  = String(this._limit);
    if (this._offset != null) params['offset'] = String(this._offset);
    return new URLSearchParams(params).toString();
  }

  then(resolve: (result: any) => any, reject?: (err: any) => any): Promise<any> {
    return this._execute().then(resolve, reject);
  }

  private async _execute(): Promise<{ data: any; error: any }> {
    try {
      const qs  = this._buildQS();
      const { data, status } = await apiFetch(`/rest/v1/${this._table}?${qs}`);
      if (status >= 400) return { data: null, error: { message: data?.error || 'Error' } };

      if (this._single) {
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
        return { data: row, error: null };
      }
      if (this._maybeSingle) {
        const row = Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
        return { data: row, error: null };
      }
      return { data: Array.isArray(data) ? data : [data], error: null };
    } catch (err: any) {
      return { data: null, error: { message: err.message } };
    }
  }

  insert(body: any): InsertBuilder   { return new InsertBuilder(this._table, body); }
  update(body: any): UpdateBuilder   { return new UpdateBuilder(this._table, body, this._filters); }
  upsert(body: any, _opts?: any): InsertBuilder { return new InsertBuilder(this._table, body, true); }
  delete(): DeleteBuilder            { return new DeleteBuilder(this._table, this._filters); }
}

// ── InsertBuilder ─────────────────────────────────────────────────
class InsertBuilder {
  private _table: string;
  private _body: any;
  private _single = false;
  private _maybeSingle = false;

  constructor(table: string, body: any, _upsert = false) {
    this._table  = table;
    this._body   = body;
  }

  select(_cols = '*'): this { return this; }
  single(): this { this._single = true; return this; }
  maybeSingle(): this { this._maybeSingle = true; return this; }

  then(resolve: (result: any) => any, reject?: (err: any) => any): Promise<any> {
    return this._execute().then(resolve, reject);
  }

  private async _execute(): Promise<{ data: any; error: any }> {
    try {
      const { data, status } = await apiFetch(`/rest/v1/${this._table}`, {
        method: 'POST',
        body:   JSON.stringify(this._body),
      });
      if (status >= 400) return { data: null, error: { message: data?.error || 'Insert error' } };

      if (this._single) {
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
        return { data: row, error: null };
      }
      if (this._maybeSingle) {
        const row = Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
        return { data: row, error: null };
      }

      return { data, error: null };
    } catch (err: any) {
      return { data: null, error: { message: err.message } };
    }
  }
}

// ── UpdateBuilder ─────────────────────────────────────────────────
class UpdateBuilder {
  private _table: string;
  private _body: any;
  private _filters: Record<string, string>;
  private _extra: Record<string, string> = {};
  private _single = false;
  private _maybeSingle = false;

  constructor(table: string, body: any, filters: Record<string, string>) {
    this._table   = table;
    this._body    = body;
    this._filters = { ...filters };
  }

  eq(col: string, val: any):  this { this._extra[col] = `eq.${val}`;  return this; }
  neq(col: string, val: any): this { this._extra[col] = `neq.${val}`; return this; }
  is(col: string, val: any):  this { this._extra[col] = `is.${val}`;  return this; }
  not(col: string, op: string, val: any): this {
    if (op === 'is' && val === null) this._extra[col] = 'not.is.null';
    else                             this._extra[col] = `neq.${val}`;
    return this;
  }

  select(_cols = '*'): this { return this; }
  single(): this { this._single = true; return this; }
  maybeSingle(): this { this._maybeSingle = true; return this; }

  then(resolve: (result: any) => any, reject?: (err: any) => any): Promise<any> {
    return this._execute().then(resolve, reject);
  }

  private async _execute(): Promise<{ data: any; error: any }> {
    try {
      const allFilters = { ...this._filters, ...this._extra };
      const qs = new URLSearchParams(allFilters).toString();
      const { data, status } = await apiFetch(`/rest/v1/${this._table}?${qs}`, {
        method: 'PATCH',
        body:   JSON.stringify(this._body),
      });
      if (status >= 400) return { data: null, error: { message: data?.error || 'Update error' } };

      if (this._single) {
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
        return { data: row, error: null };
      }
      if (this._maybeSingle) {
        const row = Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
        return { data: row, error: null };
      }

      return { data, error: null };
    } catch (err: any) {
      return { data: null, error: { message: err.message } };
    }
  }
}

// ── DeleteBuilder ─────────────────────────────────────────────────
class DeleteBuilder {
  private _table: string;
  private _filters: Record<string, string>;
  private _extra: Record<string, string> = {};
  private _single = false;
  private _maybeSingle = false;

  constructor(table: string, filters: Record<string, string>) {
    this._table   = table;
    this._filters = { ...filters };
  }

  eq(col: string, val: any): this { this._extra[col] = `eq.${val}`; return this; }
  single(): this { this._single = true; return this; }
  maybeSingle(): this { this._maybeSingle = true; return this; }

  then(resolve: (result: any) => any, reject?: (err: any) => any): Promise<any> {
    return this._execute().then(resolve, reject);
  }

  private async _execute(): Promise<{ data: any; error: any }> {
    try {
      const allFilters = { ...this._filters, ...this._extra };
      const qs = new URLSearchParams(allFilters).toString();
      const { data, status } = await apiFetch(`/rest/v1/${this._table}?${qs}`, {
        method: 'DELETE',
      });
      if (status >= 400) return { data: null, error: { message: data?.error || 'Delete error' } };

      if (this._single) {
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
        return { data: row, error: null };
      }
      if (this._maybeSingle) {
        const row = Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
        return { data: row, error: null };
      }

      return { data, error: null };
    } catch (err: any) {
      return { data: null, error: { message: err.message } };
    }
  }
}

// ── Auth module ───────────────────────────────────────────────────
const auth = {
  async signInWithPassword(credentials: { email: string; password: string }) {
    try {
      const { data, status } = await apiFetch('/auth/sign-in', {
        method: 'POST',
        body:   JSON.stringify(credentials),
      });
      if (status >= 400) return { data: null, error: { message: data?.error || 'Sign-in failed' } };
      const token = data?.data?.session?.access_token;
      if (token) {
        setToken(token);
        notifyAuth('SIGNED_IN', data.data.session);
      }
      return { data: data?.data, error: null };
    } catch (err: any) {
      return { data: null, error: { message: err.message } };
    }
  },

  async signOut() {
    try { await apiFetch('/auth/sign-out', { method: 'POST' }); } finally {
      setToken(null);
      notifyAuth('SIGNED_OUT', null);
    }
  },

  async getSession() {
    const token = getToken();
    if (!token) return { data: { session: null }, error: null };
    try {
      const { data, status } = await apiFetch('/auth/session');
      if (status >= 400) { setToken(null); return { data: { session: null }, error: null }; }
      return { data: data?.data ?? { session: null }, error: null };
    } catch {
      return { data: { session: null }, error: null };
    }
  },

  onAuthStateChange(callback: AuthListener) {
    authListeners.push(callback);
    const token = getToken();
    if (token) {
      auth.getSession().then(({ data }) => {
        if (data?.session) callback('SIGNED_IN', data.session);
      });
    }
    return {
      data: {
        subscription: {
          unsubscribe() {
            const idx = authListeners.indexOf(callback);
            if (idx !== -1) authListeners.splice(idx, 1);
          },
        },
      },
    };
  },

  async signUp(credentials: { email: string; password: string; options?: any }) {
    try {
      const { data, status } = await apiFetch('/auth/sign-up', {
        method: 'POST',
        body:   JSON.stringify({
          email:    credentials.email,
          password: credentials.password,
          name:     credentials.options?.data?.name,
          role:     credentials.options?.data?.role,
        }),
      });
      if (status >= 400) return { data: null, error: { message: data?.error || 'Sign-up failed' } };
      return { data: data?.data, error: null };
    } catch (err: any) {
      return { data: null, error: { message: err.message } };
    }
  },

  admin: {
    async listUsers() {
      try {
        const { data, status } = await apiFetch('/rest/v1/profiles?select=*');
        if (status >= 400) return { data: null, error: { message: data?.error } };
        return { data: { users: data }, error: null };
      } catch (err: any) {
        return { data: null, error: { message: err.message } };
      }
    },
    async updateUserById(userId: string, attrs: { password?: string }) {
      try {
        const { data, status } = await apiFetch('/auth/admin/update-user', {
          method: 'POST',
          body:   JSON.stringify({ userId, ...attrs }),
        });
        if (status >= 400) return { data: null, error: { message: data?.error } };
        return { data: data?.data, error: null };
      } catch (err: any) {
        return { data: null, error: { message: err.message } };
      }
    },
  },
};

// ── RPC ───────────────────────────────────────────────────────────
async function rpc(fnName: string, params: Record<string, any> = {}) {
  try {
    const { data, status } = await apiFetch(`/rpc/${fnName}`, {
      method: 'POST',
      body:   JSON.stringify(params),
    });
    if (status >= 400) return { data: null, error: { message: data?.error || 'RPC error' } };
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: { message: err.message } };
  }
}

// ── Realtime channels (no-op for local adapter) ─────────────────
class RealtimeChannel {
  name: string;
  private listeners: Array<() => void> = [];

  constructor(name: string) {
    this.name = name;
  }

  on(_event: string, _options: any, callback?: () => void): this {
    if (callback) this.listeners.push(callback);
    return this;
  }

  subscribe(): this {
    return this;
  }
}

// ── Main export ───────────────────────────────────────────────────
export const supabase = {
  from: (table: string) => new QueryBuilder(table),
  auth,
  rpc,
  channel: (name: string) => new RealtimeChannel(name),
  removeChannel: (_channel: RealtimeChannel) => Promise.resolve(),
};
