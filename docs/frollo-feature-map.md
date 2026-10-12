# Frollo-inspired money management

This release uses the public Frollo product and help documentation to implement
financial workflows in Clinic Finance's own code. It does not embed Frollo,
copy its proprietary code, or use its consumer account credentials.

## REA investigation

REA (`rea-agents@6.4.0`) was installed in the separate local
`clinic-finance-rea` research directory and used through its static JavaScript
CLI. Nine public same-origin scripts plus HTML from
<https://frollo.com.au/frollo-app/> were inspected as inert text.

The full capture parsed nine JavaScript sources with zero syntax failures. Its
semantic graph is partial because three large minified assets hit the selected
512 MiB memory limit. The focused public UI script analysis completed: 12,013
bytes and 3,396 AST nodes. It identified marketing navigation, carousels and
forms. These findings describe the public website; they do not establish the
mobile app's categorisation algorithms or bank-sync internals.

Full captures, hashes, commands and limitations are kept in the local research
directory, outside the published website. Public vendor scripts are not shipped
with Clinic Finance.

## Implemented behavior

| Publicly documented Frollo capability | Clinic Finance implementation                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Accounts in one portfolio             | Current balances, available cash, assets and liabilities, entity ownership and account transaction links        |
| Transaction organisation              | Search, account/category/status/review/amount filters, detail review, bulk and matching-merchant category edits |
| Budgets                               | Editable monthly category budgets, actual posted spending, remaining balance and progress                       |
| Bills                                 | Detected recurring-payment suggestions and editable recurring schedules with upcoming due dates                 |
| Goals                                 | Editable target amounts and dates, account-linked or manually recorded savings progress                         |
| Insights                              | Quantified spending changes and cash/bill signals derived from the current ledger                               |
| Export                                | Filtered CSV download, spreadsheet escaping and internal-transfer direction                                     |
| Cashflow                              | Historical inflows/outflows/category charts plus Clinic Finance's own 30/60/90-day indicative projection        |

Plans persist in browser storage for the public demonstration and in the
tenant-protected Supabase `finance_plans` table for authenticated workspaces.
Plans never move funds or change a bank balance. Bills inferred from transaction
patterns are suggestions rather than confirmed bank instructions.

Kilcoy and Burpengary retain separate legal ownership. The BOQ Specialist loan
must be connected through the actual borrower's consent. Group finance is a
reporting entity, not a presumption of legal ownership.

## Sources and remaining differences

- [Frollo consumer product](https://frollo.com.au/frollo-app/)
- [Budgets](https://help.frollo.com.au/hc/en-au/articles/13896193644175-How-to-manage-your-Budgets)
- [Bills](https://help.frollo.com.au/hc/en-au/articles/13898331399695-How-to-manage-your-Bills)
- [Goals](https://help.frollo.com.au/hc/en-au/articles/13900638327567-How-to-manage-your-Goals)
- [Transaction management](https://help.frollo.com.au/hc/en-au/articles/13411715531919-How-to-manage-your-transactions)
- [REA source and documentation](https://github.com/morluto/rea)

This is a feature-inspired implementation, not full app parity. Account balance
history, manual off-bank assets, tags/notes, automatic future categorisation
rules, bill-payment matching and financial PDF sharing are not implemented in
this release. Live bank data remains dependent on Basiq production enablement,
server credentials and the account holders' consent.
