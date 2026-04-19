import { Account, Transaction } from './types';
import { calculateGcashNetChange } from './cashTransactions';
import { round2 } from './utils';

export function calculateGcashRunningBalance(account: Pick<Account, 'current_beginning_balance'>, txns: Pick<Transaction, 'transaction_type' | 'amount' | 'transaction_fee' | 'fee_type' | 'cash_out_type'>[]): number {
  let balance = round2(Number(account.current_beginning_balance ?? 0));

  for (const txn of txns) {
    balance = round2(balance + calculateGcashNetChange(txn as Pick<Transaction, 'transaction_type' | 'amount' | 'transaction_fee' | 'fee_type'>));
  }

  return balance;
}

export function mapGcashRunningBalances(accounts: Account[], txns: Pick<Transaction, 'account_id' | 'transaction_type' | 'amount' | 'transaction_fee' | 'fee_type' | 'cash_out_type'>[]): Record<string, number> {
  return Object.fromEntries(
    accounts.map(account => [
      account.id,
      calculateGcashRunningBalance(
        account,
        txns.filter(txn => txn.account_id === account.id)
      ),
    ])
  );
}
