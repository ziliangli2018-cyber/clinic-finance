import { useEffect, useRef, useState } from 'react';
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Building2,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CalendarDays,
  CreditCard,
  Download,
  LayoutDashboard,
  LogOut,
  Menu,
  Pause,
  PiggyBank,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  Target,
  Wallet,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { CashflowPoint, FinanceDataset, FinanceScope, Transaction } from './types/domain';
import {
  calculateCategoryBreakdown,
  calculateDailyCashflow,
  calculateSummary,
  filterTransactions,
  formatCompactMoney,
  formatMoney,
  isCashAccount,
} from './domain/analytics';
import { useFinance } from './hooks/useFinance';
import { isMock, isProduction, supabase } from './services/supabase';
import { csvCell } from './utils/csv';
import { CashflowForecast } from './components/CashflowForecast';
import { BankingConnections } from './components/BankingConnections';
import { MoneyPlanning } from './components/MoneyPlanning';
import { OverviewPortfolio } from './components/OverviewPortfolio';

type FinanceState = ReturnType<typeof useFinance>;
const isoToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Brisbane',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const dateLabel = (
  date: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' },
) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-AU', { ...options, timeZone: 'UTC' });

export function App() {
  const finance = useFinance();
  const { data, loading, error } = finance;
  const [entityId, setEntityId] = useState('all');
  const [days, setDays] = useState(30);
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const pageTitle = location.pathname.startsWith('/transactions')
    ? 'Transactions'
    : location.pathname.startsWith('/accounts')
      ? 'Accounts'
      : location.pathname.startsWith('/forecast')
        ? 'Forecast'
        : location.pathname.startsWith('/budgets')
          ? 'Budgets'
          : location.pathname.startsWith('/bills')
            ? 'Bills'
            : location.pathname.startsWith('/goals')
              ? 'Goals'
              : location.pathname.startsWith('/insights')
                ? 'Insights'
                : location.pathname.startsWith('/analytics')
                  ? 'Analytics'
                  : location.pathname.startsWith('/settings')
                    ? 'Workspace'
                    : 'Overview';
  const demoAsOf = data?.transactions
    .map((transaction) => transaction.postedAt)
    .sort()
    .at(-1);
  const to = data?.organisation.isDemo ? demoAsOf || '2026-09-20' : isoToday();
  const fromDate = new Date(`${to}T00:00:00Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - days + 1);
  const validEntityId = data?.entities.some((entity) => entity.id === entityId) ? entityId : 'all';
  const scope: FinanceScope = {
    entityId: validEntityId,
    from: fromDate.toISOString().slice(0, 10),
    to,
  };
  const entityName =
    data?.entities.find((entity) => entity.id === entityId)?.name || 'All business';
  return (
    <div className="app-shell">
      {menu && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? 'open' : ''}`}>
        <a className="brand" href="#/">
          <span className="brand-icon">
            <ChartNoAxesCombined size={23} />
          </span>
          clinic<span>finance</span>
        </a>
        <div className="workspace-switch">
          <span className="workspace-avatar">
            <Building2 size={19} />
          </span>
          <div>
            <strong>{data?.organisation.name || 'Your workspace'}</strong>
            <span>Business group</span>
          </div>
        </div>
        <p className="nav-caption">WORKSPACE</p>
        <nav aria-label="Main navigation" onClick={() => setMenu(false)}>
          <NavLink to="/" end>
            <LayoutDashboard size={19} />
            Overview
          </NavLink>
          <NavLink to="/transactions">
            <ArrowDownLeft size={19} />
            Transactions
          </NavLink>
          <NavLink to="/accounts">
            <Wallet size={19} />
            Accounts
          </NavLink>
          <NavLink to="/forecast">
            <Sparkles size={19} />
            Forecast
          </NavLink>
          <NavLink to="/analytics">
            <ChartNoAxesCombined size={19} />
            Analytics
          </NavLink>
          <NavLink to="/budgets">
            <PiggyBank size={19} />
            Budgets
          </NavLink>
          <NavLink to="/bills">
            <CalendarDays size={19} />
            Bills
          </NavLink>
          <NavLink to="/goals">
            <Target size={19} />
            Goals
          </NavLink>
          <NavLink to="/insights">
            <Sparkles size={19} />
            Insights
          </NavLink>
        </nav>
        <div className="sidebar-lower">
          <div className="workspace-note">
            <ShieldCheck size={22} />
            <strong>
              {data?.organisation.isDemo || isMock
                ? 'A safe place to explore'
                : 'Your data, your workspace'}
            </strong>
            <p>
              {isMock
                ? 'Sample data. No bank connection required.'
                : 'Access is limited to members of your organisation.'}
            </p>
          </div>
          <nav>
            <NavLink to="/settings">
              <Settings2 size={18} />
              Workspace settings
            </NavLink>
          </nav>
          <div className="profile">
            <span>CF</span>
            <div>
              <strong>{isMock ? 'Demo workspace' : 'Signed in securely'}</strong>
              <small>Version 0.4</small>
            </div>
            {!isMock && (
              <button
                title="Sign out"
                aria-label="Sign out"
                onClick={() => void supabase?.auth.signOut()}
              >
                <LogOut size={17} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={22} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{pageTitle}</strong>
          </div>
          <div className="topbar-right">
            <span className={`status-pill ${data?.organisation.isDemo || isMock ? 'demo' : ''}`}>
              {data?.organisation.isDemo || isMock ? 'Demo environment' : 'Live workspace'}
            </span>
            <span className="currency-label">AUD</span>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">YOUR PRACTICE, AT A GLANCE</span>
              <h1>{pageTitle === 'Overview' ? 'Financial overview' : pageTitle}</h1>
              <p>
                {pageTitle === 'Overview'
                  ? 'A clearer picture of where your money moves.'
                  : pageTitle === 'Transactions'
                    ? 'Every movement, organised and easy to find.'
                    : pageTitle === 'Accounts'
                      ? 'Your connected accounts, in one place.'
                      : pageTitle === 'Forecast'
                        ? 'See how recurring movements and recent spending may shape your cash position.'
                        : pageTitle === 'Analytics'
                          ? 'Understand the patterns behind your cash flow.'
                          : pageTitle === 'Budgets'
                            ? 'Set spending limits and see how your practices are tracking.'
                            : pageTitle === 'Bills'
                              ? 'See recurring payments before they arrive.'
                              : pageTitle === 'Goals'
                                ? 'Build your reserves, one goal at a time.'
                                : pageTitle === 'Insights'
                                  ? 'Turn your financial activity into useful next steps.'
                                  : 'Manage your organisation and data connections.'}
              </p>
            </div>
            {data && (
              <button
                className="button secondary"
                disabled={
                  finance.busy ||
                  (!isMock &&
                    !data.connections.some(
                      (connection) =>
                        connection.provider === 'basiq' && connection.status === 'active',
                    ))
                }
                onClick={() => void finance.sync()}
                title={isMock ? 'Generate the next fictitious activity update' : 'Refresh data'}
              >
                <RefreshCw size={16} className={finance.busy ? 'spin' : ''} />
                {finance.busy ? 'Updating…' : isMock ? 'Simulate update' : 'Refresh data'}
              </button>
            )}
          </div>
          {data && isMock && <DemoNotice finance={finance} />}
          {error && (
            <div role="alert" className="error-box">
              {error}
              <button className="text-button" onClick={() => void finance.refresh()}>
                Try again
              </button>
            </div>
          )}
          {loading ? (
            <div className="empty-state">
              <RefreshCw className="spin" />
              <h2>Loading your workspace</h2>
              <p>Bringing your accounts and transactions together.</p>
            </div>
          ) : !data ? (
            <Onboarding finance={finance} />
          ) : (
            <>
              {pageTitle !== 'Workspace' && (
                <div className="filterbar">
                  <div className="entity-tabs" role="group" aria-label="Business entity">
                    <button
                      className={entityId === 'all' ? 'selected' : ''}
                      onClick={() => setEntityId('all')}
                    >
                      <Building2 size={15} />
                      All business
                    </button>
                    {data.entities.map((entity) => (
                      <button
                        className={entityId === entity.id ? 'selected' : ''}
                        key={entity.id}
                        onClick={() => setEntityId(entity.id)}
                      >
                        {entity.name}
                      </button>
                    ))}
                  </div>
                  <label className="period-select">
                    <span className="sr-only">Reporting period</span>
                    <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
                      <option value={30}>Last 30 days</option>
                      <option value={60}>Last 60 days</option>
                      <option value={90}>Last 90 days</option>
                    </select>
                  </label>
                </div>
              )}
              <Routes>
                <Route
                  path="/"
                  element={
                    <Dashboard data={data} scope={scope} entityName={entityName} days={days} />
                  }
                />
                <Route
                  path="/transactions"
                  element={<Transactions data={data} scope={scope} finance={finance} />}
                />
                <Route path="/accounts" element={<Accounts data={data} scope={scope} />} />
                <Route path="/forecast" element={<CashflowForecast data={data} scope={scope} />} />
                <Route path="/analytics" element={<Analytics data={data} scope={scope} />} />
                {(['budgets', 'bills', 'goals', 'insights'] as const).map((view) => (
                  <Route
                    key={view}
                    path={`/${view}`}
                    element={
                      <MoneyPlanning
                        key={`${data.organisation.id}:${view}`}
                        view={view}
                        data={data}
                        scope={scope}
                      />
                    }
                  />
                ))}
                <Route path="/settings" element={<Workspace finance={finance} />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
              <footer className="page-footer">
                <span>
                  {data.organisation.isDemo
                    ? `Fictitious data · ${dateLabel(to, { day: 'numeric', month: 'long', year: 'numeric' })}`
                    : 'Secure organisation workspace'}{' '}
                  · All amounts in AUD
                </span>
                <span>
                  Clinic Finance <span className="footer-version">0.4</span>
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function DemoNotice({ finance }: { finance: FinanceState }) {
  const updated = finance.lastUpdatedAt
    ? new Intl.DateTimeFormat('en-AU', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Australia/Brisbane',
      }).format(new Date(finance.lastUpdatedAt))
    : 'ready';
  return (
    <section className="demo-notice" aria-label="Demonstration mode">
      <span className="demo-notice-icon">
        <Sparkles size={20} />
      </span>
      <div className="demo-notice-copy">
        <strong>Live demo · fictional data only</strong>
        <p>
          No bank is connected and no credentials are requested. Changes stay in this browser. For
          demonstration only — not financial advice.
        </p>
        <span className="demo-live-status" role="status" aria-live="polite">
          <i className={finance.simulationPaused ? 'paused' : ''} />
          {finance.simulationPaused
            ? 'Simulation paused'
            : `Simulation active · updated ${updated}`}
          {finance.simulationMessage ? ` · ${finance.simulationMessage}` : ''}
        </span>
      </div>
      <div className="demo-notice-actions">
        <button className="button tertiary" onClick={finance.toggleSimulation}>
          {finance.simulationPaused ? <Play size={15} /> : <Pause size={15} />}
          {finance.simulationPaused ? 'Resume' : 'Pause'}
        </button>
        <button className="button tertiary" onClick={finance.resetDemo}>
          <RotateCcw size={15} />
          Reset demo
        </button>
      </div>
    </section>
  );
}

function Onboarding({ finance }: { finance: FinanceState }) {
  const [name, setName] = useState('Kilcoy & Burpengary Dental Group');
  return (
    <section className="empty-state onboarding">
      <span className="empty-icon">
        <Building2 size={30} />
      </span>
      <h2>Make room for a clearer picture</h2>
      <p>
        {isProduction
          ? 'Create a private workspace for Kilcoy, Burpengary and your group finance accounts. Bank consent is completed after the workspace is ready.'
          : 'Create a demo organisation with two clinics, a group loan, personal examples and 90 days of realistic Australian transactions.'}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void (isProduction ? finance.createLive(name) : finance.createDemo(name));
        }}
      >
        <label>
          Organisation name
          <input
            value={name}
            maxLength={120}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button className="button primary" disabled={finance.busy}>
          {finance.busy
            ? 'Creating workspace…'
            : isProduction
              ? 'Create secure workspace'
              : 'Create demo workspace'}
          <ArrowRight size={17} />
        </button>
      </form>
    </section>
  );
}

function Metric({
  label,
  value,
  caption,
  icon,
  primary = false,
}: {
  label: string;
  value: string;
  caption: string;
  icon: ReactNode;
  primary?: boolean;
}) {
  return (
    <article className={`metric-card ${primary ? 'metric-primary' : ''}`}>
      <div className="metric-label">
        {label}
        <span>{icon}</span>
      </div>
      <strong className="metric-value">{value}</strong>
      <span className="metric-caption">{caption}</span>
    </article>
  );
}

function Dashboard({
  data,
  scope,
  entityName,
  days,
}: {
  data: FinanceDataset;
  scope: FinanceScope;
  entityName: string;
  days: number;
}) {
  const summary = calculateSummary(data, scope);
  const transactions = filterTransactions(data, scope)
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    .slice(0, 5);
  const accounts = scopedAccounts(data, scope);
  const cashAccounts = accounts.filter(isCashAccount);
  const cashAccountIds = new Set(cashAccounts.map((account) => account.id));
  const cash = cashAccounts.reduce((sum, account) => sum + account.balanceCents, 0);
  const pendingByAccount = new Map<string, number>();
  for (const transaction of data.transactions.filter(
    (transaction) =>
      transaction.status === 'pending' &&
      transaction.amountCents < 0 &&
      cashAccountIds.has(transaction.accountId),
  ))
    pendingByAccount.set(
      transaction.accountId,
      (pendingByAccount.get(transaction.accountId) ?? 0) - transaction.amountCents,
    );
  const pendingOutflows = [...pendingByAccount.values()].reduce((sum, amount) => sum + amount, 0);
  const availableCash = cashAccounts.reduce(
    (sum, account) =>
      sum +
      (account.availableFundsCents ??
        account.balanceCents - (pendingByAccount.get(account.id) ?? 0)),
    0,
  );
  return (
    <>
      <OverviewPortfolio data={data} scope={scope} />
      <div className="metric-grid">
        <Metric
          label="Available cash"
          value={formatMoney(availableCash)}
          caption={`${formatMoney(cash)} current · ${formatMoney(pendingOutflows)} pending out`}
          icon={<Wallet size={19} />}
          primary
        />
        <Metric
          label="Money in"
          value={formatMoney(summary.incomeCents)}
          caption={`Posted inflows · last ${days} days`}
          icon={<ArrowDownLeft size={19} />}
        />
        <Metric
          label="Money out"
          value={formatMoney(summary.expenseCents)}
          caption={`Posted outflows · last ${days} days`}
          icon={<ArrowUpRight size={19} />}
        />
        <Metric
          label="Net cash flow"
          value={formatMoney(summary.netCashflowCents)}
          caption="Internal transfers excluded"
          icon={<Activity size={19} />}
        />
      </div>
      <div className="dashboard-charts">
        <section className="panel cashflow-panel">
          <PanelHeading
            title="Cash flow"
            subtitle={`${entityName} · ${dateLabel(scope.from!)} – ${dateLabel(scope.to!)}`}
          />
          <CashflowChart points={calculateDailyCashflow(data, scope)} />
        </section>
        <section className="panel">
          <PanelHeading title="Where it goes" subtitle="Expenses by category" />
          <CategoryChart data={data} scope={scope} compact />
        </section>
      </div>
      <div className="attention-strip">
        <span className="attention-icon">
          <SlidersHorizontal size={20} />
        </span>
        <div>
          <strong>A little attention goes a long way</strong>
          <p>
            {summary.uncategorisedCount} uncategorised transactions · {summary.missingReceiptCount}{' '}
            expenses without receipts
          </p>
        </div>
        <NavLink to="/transactions?review=uncategorised" className="text-button">
          Review transactions
          <ArrowRight size={16} />
        </NavLink>
      </div>
      <section className="panel recent-panel">
        <PanelHeading
          title="Recent transactions"
          subtitle={`${entityName} · latest activity`}
          action={
            <NavLink className="text-button" to="/transactions">
              View all
              <ArrowRight size={16} />
            </NavLink>
          }
        />
        <TransactionTable data={data} transactions={transactions} />
      </section>
    </>
  );
}

function PanelHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function CashflowChart({ points }: { points: CashflowPoint[] }) {
  const grouped: CashflowPoint[] = [];
  const size = Math.max(1, Math.ceil(points.length / 12));
  for (let i = 0; i < points.length; i += size) {
    const slice = points.slice(i, i + size);
    grouped.push({
      date: slice[0].date,
      incomeCents: slice.reduce((sum, item) => sum + item.incomeCents, 0),
      expenseCents: slice.reduce((sum, item) => sum + item.expenseCents, 0),
      netCashflowCents: 0,
    });
  }
  const max = Math.max(
    10000,
    ...grouped.flatMap((point) => [point.incomeCents, point.expenseCents]),
  );
  const chartW = 670,
    chartH = 210;
  const x = (index: number) => 58 + (index / Math.max(1, grouped.length - 1)) * (chartW - 86);
  const y = (value: number) => chartH - 28 - (value / max) * (chartH - 55);
  const line = (field: 'incomeCents' | 'expenseCents') =>
    grouped.map((point, index) => `${index ? 'L' : 'M'}${x(index)},${y(point[field])}`).join(' ');
  return (
    <div className="cashflow-chart">
      <div className="chart-legend">
        <span>
          <i className="income-dot" />
          Money in
        </span>
        <span>
          <i className="expense-dot" />
          Money out
        </span>
      </div>
      <svg
        viewBox={`0 0 ${chartW} ${chartH}`}
        role="img"
        aria-label="Money in and money out across the selected period"
      >
        <title>
          Posted cash flow, excluding internal transfers. Values grouped into {size}-day periods.
        </title>
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <g key={fraction}>
            <line
              x1="58"
              x2={chartW - 20}
              y1={y(max * fraction)}
              y2={y(max * fraction)}
              stroke="#edf0f2"
              strokeDasharray="4 5"
            />
            <text x="46" y={y(max * fraction) + 4} textAnchor="end" fill="#829198" fontSize="10">
              {formatCompactMoney(max * fraction)}
            </text>
          </g>
        ))}
        {grouped.length > 0 && (
          <>
            <path
              d={`${line('incomeCents')} L${x(grouped.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
              fill="#edf6f0"
            />
            <path
              d={line('incomeCents')}
              fill="none"
              stroke="#2c876a"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            <path
              d={line('expenseCents')}
              fill="none"
              stroke="#9eafc3"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            {grouped.map(
              (point, index) =>
                (index % Math.max(1, Math.floor(grouped.length / 5)) === 0 ||
                  index === grouped.length - 1) && (
                  <text
                    key={point.date}
                    x={x(index)}
                    y={chartH - 4}
                    textAnchor="middle"
                    fill="#829198"
                    fontSize="10"
                  >
                    {dateLabel(point.date)}
                  </text>
                ),
            )}
          </>
        )}
      </svg>
      <p className="chart-note">Grouped in {size}-day periods · pending entries excluded</p>
    </div>
  );
}

function CategoryChart({
  data,
  scope,
  compact = false,
}: {
  data: FinanceDataset;
  scope: FinanceScope;
  compact?: boolean;
}) {
  const all = calculateCategoryBreakdown(data, scope);
  const total = all.reduce((sum, row) => sum + row.amountCents, 0);
  const rows = compact ? all.slice(0, 4) : all;
  if (!total) return <p className="empty-small">No expenses in this period.</p>;
  const gradient = all
    .map((row, index) => {
      const start =
        (all.slice(0, index).reduce((sum, prior) => sum + prior.amountCents, 0) / total) * 100;
      return `${row.colour} ${start}% ${start + (row.amountCents / total) * 100}%`;
    })
    .join(',');
  return (
    <div className={`category-chart ${compact ? 'compact' : ''}`}>
      <div
        className="donut"
        style={{ background: `conic-gradient(${gradient})` }}
        role="img"
        aria-label={`Total expenses ${formatMoney(total)}`}
      >
        <div>
          <small>Total expenses</small>
          <strong>{formatCompactMoney(total)}</strong>
        </div>
      </div>
      <div className="category-legend">
        {rows.map((row) => (
          <div key={row.categoryId || 'none'}>
            <span>
              <i style={{ background: row.colour }} />
              {row.name}
            </span>
            <strong>{Math.round((row.amountCents / total) * 100)}%</strong>
            {!compact && <span>{formatMoney(row.amountCents)}</span>}
          </div>
        ))}
        {compact && all.length > 4 && (
          <div>
            <span>
              <i style={{ background: '#bdc8c7' }} />
              Other categories
            </span>
            <strong>
              {Math.round(
                (all.slice(4).reduce((sum, row) => sum + row.amountCents, 0) / total) * 100,
              )}
              %
            </strong>
          </div>
        )}
      </div>
    </div>
  );
}

function TransactionTable({
  data,
  transactions,
  onSelect,
  selectedIds,
  onToggleSelection,
  onSelectVisible,
}: {
  data: FinanceDataset;
  transactions: Transaction[];
  onSelect?: (transaction: Transaction) => void;
  selectedIds?: Set<string>;
  onToggleSelection?: (transactionId: string) => void;
  onSelectVisible?: (selected: boolean) => void;
}) {
  const selectedCount = transactions.filter((transaction) =>
    selectedIds?.has(transaction.id),
  ).length;
  return (
    <div className="table-scroll">
      <table className="transaction-table">
        <thead>
          <tr>
            {onToggleSelection && (
              <th className="selection-cell">
                <input
                  type="checkbox"
                  aria-label="Select all visible transactions"
                  aria-checked={
                    selectedCount > 0 && selectedCount < transactions.length
                      ? 'mixed'
                      : selectedCount > 0
                  }
                  ref={(input) => {
                    if (input)
                      input.indeterminate =
                        selectedCount > 0 && selectedCount < transactions.length;
                  }}
                  checked={transactions.length > 0 && selectedCount === transactions.length}
                  disabled={!transactions.length}
                  onChange={(event) => onSelectVisible?.(event.target.checked)}
                />
              </th>
            )}
            <th>Transaction</th>
            <th>Account</th>
            <th>Category</th>
            <th>Date</th>
            <th className="number">Amount</th>
            {onSelect && (
              <th>
                <span className="sr-only">Details</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => {
            const account = data.accounts.find((item) => item.id === transaction.accountId);
            const entity = data.entities.find((item) => item.id === account?.entityId);
            const category = data.categories.find((item) => item.id === transaction.categoryId);
            return (
              <tr key={transaction.id}>
                {onToggleSelection && (
                  <td data-label="Select" className="selection-cell">
                    <input
                      type="checkbox"
                      aria-label={`Select ${transaction.description}`}
                      checked={selectedIds?.has(transaction.id) || false}
                      onChange={() => onToggleSelection(transaction.id)}
                    />
                  </td>
                )}
                <td data-label="Transaction">
                  <div className="transaction-name">
                    <span
                      className={`transaction-icon ${transaction.amountCents > 0 ? 'incoming' : ''}`}
                    >
                      {transaction.amountCents > 0 ? (
                        <ArrowDownLeft size={17} />
                      ) : (
                        <ArrowUpRight size={17} />
                      )}
                    </span>
                    <div>
                      {onSelect ? (
                        <button className="transaction-link" onClick={() => onSelect(transaction)}>
                          {transaction.merchant || transaction.description}
                        </button>
                      ) : (
                        <strong>{transaction.merchant || transaction.description}</strong>
                      )}
                      <small>
                        {transaction.transferPairId
                          ? 'Matched internal transfer'
                          : transaction.status === 'pending'
                            ? 'Pending'
                            : entity?.name}
                      </small>
                    </div>
                  </div>
                </td>
                <td data-label="Account">
                  <span className="account-label">{account?.name}</span>
                </td>
                <td data-label="Category">
                  <span className={`category-tag ${!category ? 'uncategorised' : ''}`}>
                    <i style={{ background: category?.colour || '#bc8740' }} />
                    {category?.name || 'Uncategorised'}
                  </span>
                </td>
                <td data-label="Date" className="nowrap muted">
                  {dateLabel(transaction.postedAt)}
                </td>
                <td
                  data-label="Amount"
                  className={`number amount ${transaction.amountCents > 0 ? 'positive' : ''}`}
                >
                  {transaction.amountCents > 0 ? '+' : '−'}
                  {formatMoney(Math.abs(transaction.amountCents))}
                </td>
                {onSelect && (
                  <td className="transaction-action">
                    <button
                      className="icon-button"
                      aria-label={`Review ${transaction.description}`}
                      onClick={() => onSelect(transaction)}
                    >
                      <ChevronRight size={17} />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!transactions.length && (
        <div className="empty-small">No transactions match these filters.</div>
      )}
    </div>
  );
}

function Transactions({
  data,
  scope,
  finance,
}: {
  data: FinanceDataset;
  scope: FinanceScope;
  finance: FinanceState;
}) {
  const [search, setSearch] = useState('');
  const [params, setParams] = useSearchParams();
  const requestedAccount = params.get('account') || 'all';
  const accountOptions = data.accounts.filter(
    (account) => scope.entityId === 'all' || account.entityId === scope.entityId,
  );
  const accountId = accountOptions.some((account) => account.id === requestedAccount)
    ? requestedAccount
    : 'all';
  const setAccountId = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'all') next.delete('account');
    else next.set('account', value);
    setParams(next);
  };
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const requestedCategory = params.get('category') || 'all';
  const categoryFilter = data.categories.some((category) => category.id === requestedCategory)
    ? requestedCategory
    : 'all';
  const setCategoryFilter = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'all') next.delete('category');
    else next.set('category', value);
    setParams(next);
  };
  const [statusFilter, setStatusFilter] = useState('all');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkError, setBulkError] = useState('');
  const minCents = amountMin === '' ? null : Math.round(Number(amountMin) * 100);
  const maxCents = amountMax === '' ? null : Math.round(Number(amountMax) * 100);
  const amountRangeInvalid = minCents !== null && maxCents !== null && minCents > maxCents;
  const review = params.get('review') || 'all';
  const selected = data.transactions.find((transaction) => transaction.id === selectedId);
  const transactions = filterTransactions(data, { ...scope, accountId })
    .filter(
      (transaction) =>
        (review === 'all' ||
          (review === 'uncategorised' && !transaction.categoryId) ||
          (review === 'receipts' && transaction.receiptStatus === 'missing') ||
          (review === 'transfers' && transaction.transferPairId)) &&
        (categoryFilter === 'all' || transaction.categoryId === categoryFilter) &&
        (statusFilter === 'all' || transaction.status === statusFilter) &&
        !amountRangeInvalid &&
        (minCents === null || Math.abs(transaction.amountCents) >= minCents) &&
        (maxCents === null || Math.abs(transaction.amountCents) <= maxCents) &&
        `${transaction.description} ${transaction.merchant || ''}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt) || a.id.localeCompare(b.id));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(transactions.length / 15) - 1));
  const visibleTransactions = transactions.slice(currentPage * 15, currentPage * 15 + 15);
  const visibleIds = new Set(visibleTransactions.map((transaction) => transaction.id));
  const visibleSelectedIds = new Set(selectedIds.filter((id) => visibleIds.has(id)));
  const selectedTransactions = visibleTransactions.filter((transaction) =>
    visibleSelectedIds.has(transaction.id),
  );
  const bulkCategories = data.categories.filter(
    (category) =>
      category.kind !== 'transfer' ||
      (selectedTransactions.length > 0 &&
        selectedTransactions.every((transaction) => transaction.transferPairId)),
  );
  function resetSelection() {
    setSelectedIds([]);
    setBulkError('');
    setBulkMessage('');
  }
  async function saveSelectedCategory() {
    setBulkMessage('');
    setBulkError('');
    const count = await finance.categoriseMany([...visibleSelectedIds], bulkCategoryId);
    if (count === undefined) {
      setBulkError('Categories could not be saved. Your selection is still available to retry.');
      return;
    }
    setSelectedIds([]);
    setBulkMessage(`Category saved for ${count} ${count === 1 ? 'transaction' : 'transactions'}.`);
  }
  function exportCsv() {
    const safe = csvCell;
    const csv = [
      'Date,Entity,Description,Merchant,Account,Category,Amount AUD,Direction,Status',
      ...transactions.map((transaction) =>
        (() => {
          const account = data.accounts.find((candidate) => candidate.id === transaction.accountId);
          const entity = data.entities.find((candidate) => candidate.id === account?.entityId);
          return [
            transaction.postedAt,
            safe(entity?.name || ''),
            safe(transaction.description),
            safe(transaction.merchant || ''),
            safe(account?.name || ''),
            safe(
              data.categories.find((category) => category.id === transaction.categoryId)?.name ||
                'Uncategorised',
            ),
            (transaction.amountCents / 100).toFixed(2),
            transaction.transferPairId
              ? 'Transfer'
              : transaction.amountCents >= 0
                ? 'Income'
                : 'Expense',
            transaction.status,
          ].join(',');
        })(),
      ),
    ].join('\r\n');
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    link.href = url;
    link.download = `clinic-finance-transactions-${isoToday()}.csv`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return (
    <>
      <section className="panel">
        <div className="transaction-toolbar">
          <label className="search-input">
            <Search size={17} />
            <input
              aria-label="Search transactions"
              placeholder="Search transactions…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
                resetSelection();
              }}
            />
          </label>
          <label>
            <span className="sr-only">Account filter</span>
            <select
              value={accountId}
              onChange={(event) => {
                setAccountId(event.target.value);
                setPage(0);
                resetSelection();
              }}
            >
              <option value="all">All accounts</option>
              {accountOptions.map((account) => (
                <option key={account.id} value={account.id}>
                  {data.entities.find((entity) => entity.id === account.entityId)?.name} ·{' '}
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Category filter</span>
            <select
              value={categoryFilter}
              onChange={(event) => {
                setCategoryFilter(event.target.value);
                setPage(0);
                resetSelection();
              }}
            >
              <option value="all">All categories</option>
              {data.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Status filter</span>
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(0);
                resetSelection();
              }}
            >
              <option value="all">Any status</option>
              <option value="posted">Posted</option>
              <option value="pending">Pending</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Review filter</span>
            <select
              value={review}
              onChange={(event) => {
                const next = new URLSearchParams(params);
                if (event.target.value === 'all') next.delete('review');
                else next.set('review', event.target.value);
                setParams(next);
                setPage(0);
                resetSelection();
              }}
            >
              <option value="all">All transactions</option>
              <option value="uncategorised">Uncategorised</option>
              <option value="receipts">Missing receipt</option>
              <option value="transfers">Internal transfers</option>
            </select>
          </label>
          <label className="amount-filter">
            <span>Min amount (AUD)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              aria-label="Minimum amount (AUD)"
              placeholder="0.00"
              value={amountMin}
              onChange={(event) => {
                setAmountMin(event.target.value);
                setPage(0);
                resetSelection();
              }}
            />
          </label>
          <label className="amount-filter">
            <span>Max amount (AUD)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              aria-label="Maximum amount (AUD)"
              placeholder="Any amount"
              value={amountMax}
              onChange={(event) => {
                setAmountMax(event.target.value);
                setPage(0);
                resetSelection();
              }}
            />
          </label>
          <button
            className="text-button"
            onClick={() => {
              setSearch('');
              setStatusFilter('all');
              setAmountMin('');
              setAmountMax('');
              const next = new URLSearchParams(params);
              next.delete('account');
              next.delete('review');
              next.delete('category');
              setParams(next);
              setPage(0);
              resetSelection();
            }}
          >
            Clear filters
          </button>
          <button className="button secondary" onClick={exportCsv}>
            <Download size={15} />
            Export
          </button>
        </div>
        <div className="bulk-category-toolbar">
          <span>{visibleSelectedIds.size} selected on this page</span>
          <label>
            <span className="sr-only">Category for selected transactions</span>
            <select
              aria-label="Category for selected transactions"
              value={bulkCategoryId}
              onChange={(event) => setBulkCategoryId(event.target.value)}
              disabled={!visibleSelectedIds.size || finance.busy}
            >
              <option value="">Choose category</option>
              {bulkCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button secondary"
            disabled={
              !visibleSelectedIds.size ||
              !bulkCategories.some((category) => category.id === bulkCategoryId) ||
              finance.busy
            }
            onClick={() => void saveSelectedCategory()}
          >
            Save selected categories
          </button>
          <button
            className="text-button"
            disabled={!selectedIds.length || finance.busy}
            onClick={resetSelection}
          >
            Clear selection
          </button>
          <small className="muted">
            Amount filters use absolute values, for both money in and out.
          </small>
        </div>
        {amountRangeInvalid && (
          <p role="alert" className="transaction-feedback">
            Minimum amount must not exceed maximum amount.
          </p>
        )}
        {bulkMessage && (
          <p role="status" className="transaction-feedback saved-message">
            {bulkMessage}
          </p>
        )}
        {bulkError && (
          <p role="alert" className="transaction-feedback">
            {bulkError}
          </p>
        )}
        <TransactionTable
          data={data}
          transactions={visibleTransactions}
          onSelect={(transaction) => setSelectedId(transaction.id)}
          selectedIds={visibleSelectedIds}
          onToggleSelection={(id) => {
            setBulkMessage('');
            setBulkError('');
            setSelectedIds((current) => {
              const selected = current.filter((candidate) => visibleIds.has(candidate));
              return selected.includes(id)
                ? selected.filter((candidate) => candidate !== id)
                : [...selected, id];
            });
          }}
          onSelectVisible={(checked) => {
            setBulkMessage('');
            setBulkError('');
            setSelectedIds(checked ? [...visibleIds] : []);
          }}
        />
        <div className="pagination">
          <span>
            {transactions.length
              ? `${currentPage * 15 + 1}–${Math.min(transactions.length, currentPage * 15 + 15)} of ${transactions.length}`
              : '0'}{' '}
            transactions
          </span>
          <div>
            <button
              className="icon-button"
              disabled={currentPage === 0}
              aria-label="Previous page"
              onClick={() => {
                setPage(currentPage - 1);
                resetSelection();
              }}
            >
              <ChevronLeft size={18} />
            </button>
            <span>Page {currentPage + 1}</span>
            <button
              className="icon-button"
              disabled={(currentPage + 1) * 15 >= transactions.length}
              aria-label="Next page"
              onClick={() => {
                setPage(currentPage + 1);
                resetSelection();
              }}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </section>
      {selected && (
        <TransactionDetail
          key={selected.id}
          transaction={selected}
          data={data}
          finance={finance}
          close={() => setSelectedId(null)}
        />
      )}
    </>
  );
}

function TransactionDetail({
  transaction,
  data,
  finance,
  close,
}: {
  transaction: Transaction;
  data: FinanceDataset;
  finance: FinanceState;
  close: () => void;
}) {
  const [categoryId, setCategoryId] = useState(transaction.categoryId || '');
  const [applyMatching, setApplyMatching] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [saveError, setSaveError] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => trigger?.focus();
  }, []);
  const account = data.accounts.find((item) => item.id === transaction.accountId);
  const normalise = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const merchant = normalise(transaction.merchant || '');
  const matching = data.transactions.filter(
    (candidate) =>
      transaction.status === 'posted' &&
      candidate.organisationId === data.organisation.id &&
      candidate.status === 'posted' &&
      Math.sign(candidate.amountCents) === Math.sign(transaction.amountCents) &&
      (merchant
        ? normalise(candidate.merchant || '') === merchant
        : normalise(candidate.description) === normalise(transaction.description)),
  );
  const categoryAllowed = data.categories.some(
    (category) =>
      category.id === categoryId &&
      (category.kind !== 'transfer' ||
        (transaction.transferPairId &&
          (!applyMatching || matching.every((candidate) => candidate.transferPairId)))),
  );
  const changeNeeded = applyMatching
    ? matching.some((candidate) => candidate.categoryId !== categoryId)
    : categoryId !== transaction.categoryId;
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
          if (event.key === 'Tab') {
            const controls = event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), select, input',
            );
            const first = controls[0],
              last = controls[controls.length - 1];
            if (
              event.shiftKey &&
              (document.activeElement === first || document.activeElement === event.currentTarget)
            ) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <button className="icon-button close-button" aria-label="Close transaction" onClick={close}>
          <X size={20} />
        </button>
        <span className="eyebrow">TRANSACTION DETAILS</span>
        <h2 id="detail-title">{transaction.merchant || transaction.description}</h2>
        <strong className={`detail-amount ${transaction.amountCents > 0 ? 'positive' : ''}`}>
          {formatMoney(transaction.amountCents)}
        </strong>
        <dl>
          <div>
            <dt>Date</dt>
            <dd>
              {dateLabel(transaction.postedAt, { day: 'numeric', month: 'long', year: 'numeric' })}
            </dd>
          </div>
          <div>
            <dt>Account</dt>
            <dd>
              {account?.name} {account?.maskedNumber}
            </dd>
          </div>
          <div>
            <dt>Bank description</dt>
            <dd>{transaction.description}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{transaction.status}</dd>
          </div>
          <div>
            <dt>Receipt</dt>
            <dd>{transaction.receiptStatus.replace('_', ' ')}</dd>
          </div>
          <div>
            <dt>Transfer</dt>
            <dd>
              {transaction.transferPairId
                ? 'Matched between owned accounts'
                : 'No matched transfer'}
            </dd>
          </div>
        </dl>
        <label>
          Category
          <select
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
              setSavedCount(null);
              setSaveError('');
            }}
          >
            <option value="" disabled>
              Choose a category
            </option>
            {data.categories
              .filter(
                (category) =>
                  category.kind !== 'transfer' ||
                  (transaction.transferPairId &&
                    (!applyMatching || matching.every((candidate) => candidate.transferPairId))),
              )
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
          </select>
        </label>
        {transaction.status === 'posted' && matching.length > 1 && (
          <label className="matching-category-option">
            <input
              type="checkbox"
              checked={applyMatching}
              disabled={finance.busy || matching.length > 1000}
              onChange={(event) => {
                setApplyMatching(event.target.checked);
                setSavedCount(null);
                setSaveError('');
              }}
            />
            <span>
              Apply to all {matching.length} matching posted transactions in{' '}
              {data.organisation.name}
              <small>
                Same {merchant ? 'merchant' : 'bank description'} and money direction. This changes
                existing transactions in this workspace only.
                {matching.length > 1000 && ' Narrow the selection to 1,000 transactions or fewer.'}
              </small>
            </span>
          </label>
        )}
        <p className="muted detail-hint">
          {isMock
            ? 'Category changes are saved only in this browser until you reset the demo.'
            : 'Category changes are saved to your organisation and recorded in the audit log.'}
        </p>
        <button
          className="button primary"
          disabled={!categoryAllowed || finance.busy || !changeNeeded}
          onClick={async () => {
            setSaveError('');
            if (applyMatching) {
              const count = await finance.categoriseMany(
                matching.map((candidate) => candidate.id),
                categoryId,
              );
              if (count === undefined)
                setSaveError('Matching categories could not be saved. Please try again.');
              else setSavedCount(count);
            } else {
              await finance.categorise(transaction.id, categoryId);
            }
            dialogRef.current?.focus();
          }}
        >
          Save category
        </button>
        {saveError && (
          <p role="alert" className="detail-hint">
            {saveError}
          </p>
        )}
        {(savedCount !== null || transaction.categorySource === 'manual') && (
          <p role="status" className="saved-message">
            {savedCount === null
              ? 'Category saved.'
              : `Category saved for ${savedCount} matching transactions.`}
          </p>
        )}
      </section>
    </div>
  );
}

function scopedAccounts(data: FinanceDataset, scope: FinanceScope) {
  const entityIds = data.entities
    .filter((entity) =>
      scope.entityId && scope.entityId !== 'all'
        ? entity.id === scope.entityId
        : scope.includePersonal || entity.kind !== 'personal',
    )
    .map((entity) => entity.id);
  return data.accounts.filter((account) => entityIds.includes(account.entityId));
}

function isLiabilityAccount(kind: FinanceDataset['accounts'][number]['kind']) {
  return kind === 'credit_card' || kind === 'loan' || kind === 'mortgage';
}

function Accounts({ data, scope }: { data: FinanceDataset; scope: FinanceScope }) {
  const accounts = scopedAccounts(data, scope);
  const navigate = useNavigate();
  const entities = data.entities.filter((entity) =>
    accounts.some((account) => account.entityId === entity.id),
  );
  return (
    <>
      <div className="account-summary">
        <span>
          <Wallet size={20} /> {accounts.length} accounts
        </span>
        <span>
          Net account balance{' '}
          <strong>
            {formatMoney(accounts.reduce((sum, account) => sum + account.balanceCents, 0))}
          </strong>
        </span>
        <span className="muted">Includes credit cards, loans and term deposits</span>
      </div>
      {entities.map((entity) => (
        <section key={entity.id} className="entity-section">
          <div className="section-title">
            <h2>{entity.name}</h2>
            <span>
              {entity.kind === 'clinic'
                ? 'Dental practice'
                : entity.kind === 'group'
                  ? 'Shared group finance'
                  : 'Personal finances'}
            </span>
          </div>
          <div className="account-grid">
            {accounts
              .filter((account) => account.entityId === entity.id)
              .map((account) => (
                <article className="account-card" key={account.id}>
                  <div className="account-card-top">
                    <span
                      className={`bank-symbol ${isLiabilityAccount(account.kind) ? 'card-symbol' : ''}`}
                    >
                      {account.kind === 'credit_card' ? (
                        <CreditCard size={24} />
                      ) : (
                        <Building2 size={24} />
                      )}
                    </span>
                    <span className="small-badge">
                      {data.connections.find((connection) => connection.id === account.connectionId)
                        ?.provider === 'mock'
                        ? 'Mock connection'
                        : 'Connected'}
                    </span>
                  </div>
                  <h3>{account.name}</h3>
                  <p>
                    {account.institution} <span>· {account.maskedNumber}</span>
                  </p>
                  <div className="account-balance">
                    <small>
                      {account.kind === 'credit_card'
                        ? 'Credit card balance'
                        : account.kind === 'loan' || account.kind === 'mortgage'
                          ? 'Outstanding balance'
                          : account.kind === 'term_deposit'
                            ? 'Term deposit balance'
                            : 'Current balance'}
                    </small>
                    <strong>
                      {formatMoney(
                        account.kind === 'loan' || account.kind === 'mortgage'
                          ? Math.abs(account.balanceCents)
                          : account.balanceCents,
                      )}
                    </strong>
                    {account.kind !== 'loan' &&
                      account.kind !== 'mortgage' &&
                      account.availableFundsCents !== null &&
                      account.availableFundsCents !== undefined && (
                        <span className="account-available">
                          Available {formatMoney(account.availableFundsCents)}
                        </span>
                      )}
                  </div>
                  {!isMock && (
                    <p className="account-ownership-lock">
                      Legal owner fixed by {entity.name}'s bank consent
                    </p>
                  )}
                  <div className="account-card-footer">
                    <span>
                      {new Date(account.updatedAt).toLocaleDateString('en-AU', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                    <button
                      className="text-button"
                      onClick={() => navigate('/transactions?account=' + account.id)}
                    >
                      Transactions
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </article>
              ))}
          </div>
        </section>
      ))}
    </>
  );
}

function Analytics({ data, scope }: { data: FinanceDataset; scope: FinanceScope }) {
  const summary = calculateSummary(data, scope);
  const entities = data.entities.filter((entity) =>
    scope.entityId === 'all' ? entity.kind === 'clinic' : entity.id === scope.entityId,
  );
  return (
    <>
      <section className="panel analytics-main">
        <PanelHeading
          title="Cash flow over time"
          subtitle={`${dateLabel(scope.from!)} – ${dateLabel(scope.to!)} · posted transactions`}
        />
        <CashflowChart points={calculateDailyCashflow(data, scope)} />
        <div className="analytics-totals">
          <div>
            <span>Money in</span>
            <strong>{formatMoney(summary.incomeCents)}</strong>
          </div>
          <div>
            <span>Money out</span>
            <strong>{formatMoney(summary.expenseCents)}</strong>
          </div>
          <div>
            <span>Net movement</span>
            <strong>{formatMoney(summary.netCashflowCents)}</strong>
          </div>
        </div>
      </section>
      <div className="analytics-grid">
        <section className="panel">
          <PanelHeading title="Expense breakdown" subtitle="Cash outflows by assigned category" />
          <CategoryChart data={data} scope={scope} />
        </section>
        <section className="panel">
          <PanelHeading title="Entity comparison" subtitle="A consistent view across your group" />
          <div className="comparison-list">
            {entities.map((entity) => {
              const entitySummary = calculateSummary(data, { ...scope, entityId: entity.id });
              const max = Math.max(entitySummary.incomeCents, entitySummary.expenseCents, 1);
              return (
                <div className="comparison-item" key={entity.id}>
                  <h3>
                    {entity.name}
                    <span>{formatMoney(entitySummary.netCashflowCents)} net</span>
                  </h3>
                  <div className="comparison-row">
                    <span>In</span>
                    <div>
                      <i style={{ width: `${(entitySummary.incomeCents / max) * 100}%` }} />
                    </div>
                    <strong>{formatCompactMoney(entitySummary.incomeCents)}</strong>
                  </div>
                  <div className="comparison-row expense">
                    <span>Out</span>
                    <div>
                      <i style={{ width: `${(entitySummary.expenseCents / max) * 100}%` }} />
                    </div>
                    <strong>{formatCompactMoney(entitySummary.expenseCents)}</strong>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="method-note">
            <CircleHelp size={18} />
            <p>
              These are cash movements, not accounting profit. Loan principal, tax payments and
              other bank outflows are included. Matched internal transfers and pending entries are
              excluded.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}

function Workspace({ finance }: { finance: FinanceState }) {
  const { data } = finance;
  if (!data) return null;
  return (
    <div className="settings-grid">
      <section className="panel">
        <PanelHeading title="Organisation" subtitle="Your finance workspace" />
        <div className="settings-body">
          <label>
            Active organisation
            <select
              value={data.organisation.id}
              onChange={(event) => finance.setOrganisationId(event.target.value)}
            >
              {finance.organisations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
          <dl>
            <div>
              <dt>Data source</dt>
              <dd>{isMock ? 'Browser demo (saved on this device)' : 'Supabase PostgreSQL'}</dd>
            </div>
            <div>
              <dt>Environment</dt>
              <dd>{import.meta.env.VITE_APP_ENV || 'development'}</dd>
            </div>
            <div>
              <dt>Currency</dt>
              <dd>Australian dollars (AUD)</dd>
            </div>
            <div>
              <dt>Reporting timezone</dt>
              <dd>Australia / Brisbane</dd>
            </div>
          </dl>
        </div>
      </section>
      {isMock ? (
        <section className="panel">
          <PanelHeading
            title="Banking connections"
            subtitle="Fictional provider data · Version 0.4"
          />
          <div className="settings-body">
            {data.connections.map((connection) => (
              <div className="connection-row" key={connection.id}>
                <span className="bank-symbol">
                  <Building2 size={21} />
                </span>
                <div>
                  <strong>
                    {data.entities.find((entity) => entity.id === connection.entityId)?.name}
                  </strong>
                  <span>Mock financial provider · {connection.status}</span>
                </div>
                <ShieldCheck size={18} />
              </div>
            ))}
            <div className="method-note">
              <CircleHelp size={18} />
              <p>
                This public demonstration never connects to a bank or requests credentials. The
                secure hosted workspace uses consent-based Open Banking.
              </p>
            </div>
          </div>
        </section>
      ) : (
        data.entities
          .filter(
            (entity): entity is typeof entity & { kind: 'clinic' | 'group' } =>
              entity.kind === 'clinic' || entity.kind === 'group',
          )
          .map((entity) => (
            <BankingConnections
              key={entity.id}
              organisationId={data.organisation.id}
              entityId={entity.id}
              entityName={entity.name}
              entityKind={entity.kind}
              workspaceBusy={finance.busy}
              enabled={!isMock}
              onRefresh={async () => finance.sync(entity.id)}
              onDisconnected={finance.refresh}
            />
          ))
      )}
    </div>
  );
}
