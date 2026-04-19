import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const targetDate: string = body.date ?? (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d.toISOString().split("T")[0];
    })();

    const { data: accounts } = await supabase
      .from("accounts")
      .select("*")
      .eq("is_active", true);

    if (!accounts || accounts.length === 0) {
      return new Response(JSON.stringify({ message: "No active accounts" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = [];

    for (const account of accounts) {
      const { data: txns } = await supabase
        .from("transactions")
        .select("*")
        .eq("account_id", account.id)
        .eq("date", targetDate)
        .eq("is_deleted", false);

      const totals = (txns || []).reduce(
        (a: {
          total_cash_in: number;
          total_cash_out: number;
          total_transaction_fee: number;
          total_cash_fees: number;
          total_delivery_fee: number;
        }, t: {
          transaction_type: string;
          amount: number;
          transaction_fee: number;
          delivery_fee: number;
          fee_type: string;
        }) => {
          if (t.transaction_type === "cash_in") {
            a.total_cash_in += Number(t.amount);
          } else {
            a.total_cash_out += Number(t.amount);
          }
          const fee = Number(t.transaction_fee || 0);
          if (t.fee_type === "cash") {
            a.total_cash_fees += fee;
          } else {
            a.total_transaction_fee += fee;
          }
          a.total_delivery_fee += Number(t.delivery_fee || 0);
          return a;
        },
        { total_cash_in: 0, total_cash_out: 0, total_transaction_fee: 0, total_cash_fees: 0, total_delivery_fee: 0 }
      );

      const { data: existing } = await supabase
        .from("daily_history")
        .select("id, beginning_balance")
        .eq("account_id", account.id)
        .eq("date", targetDate)
        .maybeSingle();

      if (existing) {
        const beginningBalance = Number(existing.beginning_balance);
        const endingBalance = Math.round((
          beginningBalance +
          totals.total_cash_in -
          totals.total_cash_out +
          totals.total_transaction_fee
        ) * 100) / 100;

        await supabase
          .from("daily_history")
          .update({
            total_cash_in: totals.total_cash_in,
            total_cash_out: totals.total_cash_out,
            total_transaction_fee: totals.total_transaction_fee,
            total_cash_fees: totals.total_cash_fees,
            total_delivery_fee: totals.total_delivery_fee,
            ending_balance: endingBalance,
          })
          .eq("id", existing.id);

        await supabase
          .from("accounts")
          .update({
            current_beginning_balance: endingBalance,
            current_running_balance: endingBalance,
            last_closed_date: targetDate,
            updated_at: new Date().toISOString(),
          })
          .eq("id", account.id);

        await supabase
          .from("transactions")
          .update({ is_closed: true, updated_at: new Date().toISOString() })
          .eq("account_id", account.id)
          .eq("date", targetDate)
          .eq("is_deleted", false)
          .eq("is_closed", false);

        results.push({ account: account.name, status: "updated", ending_balance: endingBalance });
        continue;
      }

      const beginningBalance = Number(account.current_beginning_balance);
      const endingBalance = Math.round((
        beginningBalance +
        totals.total_cash_in -
        totals.total_cash_out +
        totals.total_transaction_fee
      ) * 100) / 100;

      const { error: insertError } = await supabase.from("daily_history").insert({
        date: targetDate,
        account_id: account.id,
        beginning_balance: beginningBalance,
        total_cash_in: totals.total_cash_in,
        total_cash_out: totals.total_cash_out,
        total_transaction_fee: totals.total_transaction_fee,
        total_cash_fees: totals.total_cash_fees,
        total_delivery_fee: totals.total_delivery_fee,
        ending_balance: endingBalance,
        posted_by: null,
      });

      if (insertError) {
        results.push({ account: account.name, status: "error", error: insertError.message });
        continue;
      }

      await supabase
        .from("transactions")
        .update({ is_closed: true, updated_at: new Date().toISOString() })
        .eq("account_id", account.id)
        .eq("date", targetDate)
        .eq("is_deleted", false);

      await supabase
        .from("accounts")
        .update({
          current_beginning_balance: endingBalance,
          current_running_balance: endingBalance,
          last_closed_date: targetDate,
          updated_at: new Date().toISOString(),
        })
        .eq("id", account.id);

      await supabase.from("audit_logs").insert({
        user_id: null,
        action: "DAILY_CLOSE",
        module: "DailyHistory",
        record_id: account.id,
        details: { date: targetDate, ending_balance: endingBalance, triggered_by: "auto" },
      });

      results.push({ account: account.name, status: "posted", ending_balance: endingBalance });
    }

    return new Response(JSON.stringify({ success: true, date: targetDate, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
