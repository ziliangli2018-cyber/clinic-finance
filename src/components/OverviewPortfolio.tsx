import { ArrowRight, Building2, CalendarDays, PiggyBank, Target, Wallet } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import type { FinanceDataset, FinanceScope } from '../types/domain';
import { filterAccounts, formatMoney, isCashAccount } from '../domain/analytics';
import { usePlans } from '../hooks/usePlans';

export function OverviewPortfolio({ data, scope }: { data: FinanceDataset; scope: FinanceScope }) {
  const accounts = filterAccounts(data, scope);
  const assets = accounts.reduce((sum, account) => sum + Math.max(0, account.balanceCents), 0);
  const debt = accounts.reduce((sum, account) => sum + Math.max(0, -account.balanceCents), 0);
  const plans = usePlans(data);
  const scopedPlans = plans.items.filter(
    (item) => !scope.entityId || scope.entityId === 'all' || item.entityId === scope.entityId,
  );
  const budgets = scopedPlans.filter((item) => item.kind === 'budget');
  const goals = scopedPlans.filter((item) => item.kind === 'goal');

  return (
    <>
      <section className="portfolio-hero" aria-label="Account portfolio overview">
        <div className="portfolio-total">
          <span className="portfolio-kicker">
            <Wallet size={17} /> YOUR FINANCIAL PICTURE
          </span>
          <h2>Everything. In one place.</h2>
          <p className="portfolio-net-label">Net account position</p>
          <strong className="portfolio-net">{formatMoney(assets - debt)}</strong>
          <div className="portfolio-split">
            <span>
              Assets <b>{formatMoney(assets)}</b>
            </span>
            <span>
              Liabilities <b>{formatMoney(debt)}</b>
            </span>
          </div>
          <small>
            {data.organisation.dataSource === 'csv'
              ? 'Dated statement balances'
              : 'Connected account balances'}{' '}
            · property and other off-bank assets excluded
          </small>
        </div>
        <div className="portfolio-accounts">
          <div className="portfolio-account-heading">
            <h3>Your accounts</h3>
            <NavLink to="/accounts">
              View all <ArrowRight size={14} />
            </NavLink>
          </div>
          {accounts.slice(0, 3).map((account) => (
            <NavLink
              to={`/transactions?account=${account.id}`}
              key={account.id}
              className="portfolio-account"
            >
              <span
                className={`portfolio-bank ${account.institution.includes('NAB') ? 'nab' : ''}`}
              >
                <Building2 size={19} />
              </span>
              <span>
                <b>{account.name}</b>
                <small>
                  {data.entities.find((entity) => entity.id === account.entityId)?.name} ·{' '}
                  {account.institution}
                </small>
              </span>
              <strong>{formatMoney(account.balanceCents)}</strong>
            </NavLink>
          ))}
          {!accounts.length && (
            <p>
              {data.organisation.dataSource === 'csv'
                ? 'Import a statement to see your financial picture.'
                : 'Connect an account to see your financial picture.'}
            </p>
          )}
          <NavLink
            className="portfolio-connect"
            to={data.organisation.dataSource === 'csv' ? '/import' : '/settings'}
          >
            {data.organisation.dataSource === 'csv'
              ? '+ Import another account statement'
              : '+ Connect another bank account'}
          </NavLink>
        </div>
      </section>
      <div className="plan-shortcuts">
        <NavLink to="/budgets">
          <span className="shortcut-icon">
            <PiggyBank size={22} />
          </span>
          <span>
            <b>Stay on budget</b>
            <small>
              {budgets.length
                ? `${budgets.length} monthly budgets to keep spending in check`
                : 'Give every spending category a plan'}
            </small>
          </span>
          <ArrowRight size={18} />
        </NavLink>
        <NavLink to="/bills">
          <span className="shortcut-icon">
            <CalendarDays size={22} />
          </span>
          <span>
            <b>Know what’s coming</b>
            <small>Upcoming bills and recurring payments</small>
          </span>
          <ArrowRight size={18} />
        </NavLink>
        <NavLink to="/goals">
          <span className="shortcut-icon">
            <Target size={22} />
          </span>
          <span>
            <b>Make progress</b>
            <small>
              {goals.length
                ? `${goals.length} savings goals for your practices`
                : `${accounts.filter(isCashAccount).length} cash accounts ready for your savings goals`}
            </small>
          </span>
          <ArrowRight size={18} />
        </NavLink>
      </div>
    </>
  );
}
