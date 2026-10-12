import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BellRing,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  Pencil,
  Plus,
  Sparkles,
  Target,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import type { FinanceDataset, FinanceScope } from '../types/domain';
import type { FinancePlan, PlanFrequency, PlanInput, PlanKind } from '../types/planning';
import { usePlans } from '../hooks/usePlans';
import { formatMoney, isCashAccount } from '../domain/analytics';
import { shiftDate } from '../domain/dates';
import {
  billOccurrences,
  budgetProgress,
  buildPlanningInsights,
  detectRecurringBills,
  goalProgress,
  monthPeriod,
  nextBillDate,
  planningAsOf,
  visiblePlans,
} from '../domain/planning';
import type { DetectedBill } from '../domain/planning';
import './money-planning.css';

type PlanningView = 'budgets' | 'bills' | 'goals' | 'insights';
type PlansState = ReturnType<typeof usePlans>;
const titles: Record<PlanningView, { title: string; detail: string; singular: string }> = {
  budgets: {
    title: 'Make room for what matters',
    detail: 'Set monthly limits and see where your spending stands.',
    singular: 'budget',
  },
  bills: {
    title: 'Stay one step ahead',
    detail: 'Keep regular payments in view and plan for what is coming.',
    singular: 'bill',
  },
  goals: {
    title: 'Give your money a purpose',
    detail: 'Build a reserve, fund new equipment or plan your next milestone.',
    singular: 'goal',
  },
  insights: {
    title: 'A clearer picture of your money',
    detail: 'Useful observations from your transactions, balances and plans.',
    singular: 'insight',
  },
};
const frequencies: PlanFrequency[] = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];

function prettyDate(date: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

function entityName(data: FinanceDataset, id: string | null): string {
  return id
    ? (data.entities.find((entity) => entity.id === id)?.name ?? 'Entity')
    : 'All business entities';
}

function Progress({
  percent,
  label,
  exceeded = false,
}: {
  percent: number;
  label: string;
  exceeded?: boolean;
}) {
  return (
    <div
      className={`mp-progress ${exceeded ? 'mp-progress-over' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(Math.min(100, Math.max(0, percent)))}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${Math.round(percent)} percent`}
    >
      <span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

export function MoneyPlanning({
  view,
  data,
  scope,
}: {
  view: PlanningView;
  data: FinanceDataset;
  scope: FinanceScope;
}) {
  const plans = usePlans(data);
  return (
    <PlanningScreen
      key={`${data.organisation.id}-${view}`}
      view={view}
      data={data}
      scope={scope}
      plans={plans}
    />
  );
}

function PlanningScreen({
  view,
  data,
  scope,
  plans,
}: {
  view: PlanningView;
  data: FinanceDataset;
  scope: FinanceScope;
  plans: PlansState;
}) {
  const [entityFilter, setEntityFilter] = useState('current');
  const [editing, setEditing] = useState<PlanInput | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [billDays, setBillDays] = useState(30);
  const [notice, setNotice] = useState('');
  const effectiveScope =
    entityFilter === 'current' ? scope : { ...scope, entityId: entityFilter, accountId: undefined };
  const asOfDate = planningAsOf(data, effectiveScope);
  const scoped = visiblePlans(plans.items, data, effectiveScope);
  const kind = view === 'budgets' ? 'budget' : view === 'goals' ? 'goal' : 'bill';
  const items = scoped.filter((plan) => plan.kind === kind);
  const eligibleEntities = data.entities.filter(
    (entity) =>
      entity.organisationId === data.organisation.id &&
      (entity.kind !== 'personal' ||
        effectiveScope.includePersonal ||
        effectiveScope.entityId === entity.id),
  );
  const newItem = (candidate?: DetectedBill) => {
    setNotice('');
    setEditing({
      kind,
      name: candidate?.name ?? '',
      amountCents: candidate?.amountCents ?? 0,
      savedCents: 0,
      entityId:
        candidate?.entityId ??
        (effectiveScope.entityId && effectiveScope.entityId !== 'all'
          ? effectiveScope.entityId
          : null),
      categoryId: candidate?.categoryId ?? null,
      accountId: candidate?.accountId ?? null,
      dueDate: kind === 'bill' ? (candidate?.nextDueDate ?? asOfDate) : null,
      frequency: kind === 'bill' ? (candidate?.frequency ?? 'monthly') : null,
    });
  };
  const remove = async (plan: FinancePlan) => {
    if (await plans.remove(plan.id)) {
      setDeleteId(null);
      setNotice(`${plan.name} removed.`);
    }
  };
  const controls = (plan: FinancePlan) => (
    <div className="mp-card-actions">
      {deleteId === plan.id ? (
        <>
          <span>Remove this {plan.kind}?</span>
          <button
            className="mp-text-button mp-danger"
            disabled={plans.saving}
            onClick={() => void remove(plan)}
          >
            Remove
          </button>
          <button
            className="mp-text-button"
            disabled={plans.saving}
            onClick={() => setDeleteId(null)}
          >
            Keep
          </button>
        </>
      ) : (
        <>
          <button
            className="mp-text-button"
            disabled={plans.saving}
            onClick={() => {
              setEditing(plan);
              setNotice('');
            }}
            aria-label={`Edit ${plan.name}`}
          >
            <Pencil size={14} /> Edit
          </button>
          <button
            className="mp-icon-button"
            disabled={plans.saving}
            onClick={() => setDeleteId(plan.id)}
            aria-label={`Remove ${plan.name}`}
          >
            <Trash2 size={15} />
          </button>
        </>
      )}
    </div>
  );
  const detected =
    view === 'bills'
      ? detectRecurringBills(data, effectiveScope, asOfDate).filter(
          (bill) =>
            !items.some(
              (plan) =>
                plan.accountId === bill.accountId &&
                plan.name.trim().toLowerCase() === bill.name.trim().toLowerCase(),
            ),
        )
      : [];
  const upcoming = items
    .filter((plan) => plan.dueDate && plan.frequency)
    .map((plan) => ({
      plan,
      date: nextBillDate(plan.dueDate!, plan.frequency!, asOfDate),
      occurrences: billOccurrences(
        plan.dueDate!,
        plan.frequency!,
        asOfDate,
        shiftDate(asOfDate, billDays),
      ),
    }))
    .filter((row) => row.occurrences.length)
    .sort((left, right) => left.date.localeCompare(right.date));
  const monthlyTotals =
    view === 'budgets'
      ? items.reduce(
          (result, plan) => {
            const progress = budgetProgress(data, plan, asOfDate);
            return {
              limit: result.limit + plan.amountCents,
              spent: result.spent + progress.spentCents,
            };
          },
          { limit: 0, spent: 0 },
        )
      : null;

  return (
    <div className="money-planning" aria-busy={plans.loading || plans.saving}>
      <div className="mp-intro">
        <div>
          <span className="mp-eyebrow">
            {view === 'insights' ? 'YOUR MONEY, UNDERSTOOD' : 'YOUR PLAN'}
          </span>
          <h2>{titles[view].title}</h2>
          <p>{titles[view].detail}</p>
        </div>
        {view !== 'insights' && (
          <button
            className="mp-primary"
            onClick={() => newItem()}
            disabled={plans.loading || plans.saving}
          >
            <Plus size={17} /> New {titles[view].singular}
          </button>
        )}
      </div>
      <div className="mp-view-toolbar">
        <label>
          Plan scope{' '}
          <select
            aria-label="Plan scope"
            value={entityFilter}
            onChange={(event) => setEntityFilter(event.target.value)}
          >
            <option value="current">Current workspace selection</option>
            <option value="all">All business entities</option>
            {eligibleEntities.map((entity) => (
              <option value={entity.id} key={entity.id}>
                {entity.name}
              </option>
            ))}
          </select>
        </label>
        <span>As at {prettyDate(asOfDate)}</span>
      </div>
      {plans.error && (
        <div className="mp-message mp-error" role="alert">
          {plans.error}
        </div>
      )}
      {notice && (
        <div className="mp-message mp-success" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {plans.loading && (
        <div className="mp-loading" role="status">
          Loading your plans…
        </div>
      )}
      {editing && (
        <PlanForm
          key={editing.id ?? `${editing.kind}-${editing.accountId ?? ''}-${editing.name}`}
          input={editing}
          data={data}
          entities={eligibleEntities}
          saving={plans.saving}
          asOfDate={asOfDate}
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            if (await plans.save(input)) {
              setEditing(null);
              setNotice(`${input.name.trim()} saved.`);
            }
          }}
        />
      )}

      {!plans.loading && view === 'budgets' && (
        <>
          <div className="mp-banner">
            <Wallet size={25} />
            <div>
              <span>Monthly limits</span>
              <strong>{formatMoney(monthlyTotals!.limit)}</strong>
            </div>
            <div>
              <span>Posted outflows so far</span>
              <strong>{formatMoney(monthlyTotals!.spent)}</strong>
            </div>
            <p>
              {prettyDate(monthPeriod(asOfDate).from)}–{prettyDate(monthPeriod(asOfDate).to)}
              <small>
                Totals add your budget cards; overlapping categories can count the same spending
                twice.
              </small>
            </p>
          </div>
          <div className="mp-card-grid">
            {items.map((plan) => {
              const progress = budgetProgress(data, plan, asOfDate);
              return (
                <article className="mp-plan-card" key={plan.id}>
                  <div className="mp-card-top">
                    <span className="mp-card-icon">
                      <Wallet size={20} />
                    </span>
                    <span
                      className={`mp-pill ${progress.remainingCents < 0 ? 'mp-pill-attention' : ''}`}
                    >
                      {progress.remainingCents < 0 ? 'Over limit' : 'Monthly'}
                    </span>
                  </div>
                  <h3>{plan.name}</h3>
                  <p className="mp-card-subtitle">
                    {entityName(data, plan.entityId)} ·{' '}
                    {data.categories.find((category) => category.id === plan.categoryId)?.name ??
                      'All expenses'}
                  </p>
                  <div className="mp-main-amount">
                    {formatMoney(progress.spentCents)}{' '}
                    <span>of {formatMoney(plan.amountCents)}</span>
                  </div>
                  <Progress
                    percent={progress.percent}
                    label={`${plan.name} budget used`}
                    exceeded={progress.remainingCents < 0}
                  />
                  <div className="mp-progress-caption">
                    <strong>
                      {formatMoney(Math.abs(progress.remainingCents))}{' '}
                      {progress.remainingCents < 0 ? 'over' : 'left'}
                    </strong>
                    <span>{Math.round(progress.percent)}% used</span>
                  </div>
                  <p className="mp-card-note">
                    {progress.transactionCount} posted outflows this month. Pending activity and
                    matched transfers are excluded.
                  </p>
                  {controls(plan)}
                </article>
              );
            })}
          </div>
          {!items.length && (
            <EmptyPlan
              icon="budget"
              text="Start with a category you want to keep an eye on."
              action={() => newItem()}
              label="Create your first budget"
            />
          )}
        </>
      )}

      {!plans.loading && view === 'goals' && (
        <>
          <div className="mp-goal-note">
            <Target size={21} />
            <p>
              Goals help you track a savings target. Linking an account follows its balance;
              manually tracked goals use the amount you enter. No money is moved or set aside by the
              app.
            </p>
          </div>
          <div className="mp-card-grid">
            {items.map((plan) => {
              const progress = goalProgress(data, plan, asOfDate);
              return (
                <article className="mp-plan-card mp-goal-card" key={plan.id}>
                  <div className="mp-card-top">
                    <span className="mp-card-icon">
                      <Target size={21} />
                    </span>
                    <span className={`mp-pill ${progress.complete ? 'mp-pill-positive' : ''}`}>
                      {progress.complete
                        ? 'Target reached'
                        : progress.source === 'account'
                          ? 'Account linked'
                          : progress.source === 'manual'
                            ? 'Manual tracking'
                            : 'Account unavailable'}
                    </span>
                  </div>
                  <h3>{plan.name}</h3>
                  <p className="mp-card-subtitle">{entityName(data, plan.entityId)}</p>
                  <div className="mp-main-amount">
                    {formatMoney(progress.savedCents)}{' '}
                    <span>of {formatMoney(plan.amountCents)}</span>
                  </div>
                  <Progress percent={progress.percent} label={`${plan.name} goal progress`} />
                  <div className="mp-progress-caption">
                    <strong>{formatMoney(progress.remainingCents)} to go</strong>
                    <span>{Math.round(progress.percent)}%</span>
                  </div>
                  {plan.dueDate && (
                    <p className="mp-card-note">
                      <CalendarDays size={14} />
                      Target {prettyDate(plan.dueDate)}
                      {!progress.complete && progress.daysLeft !== null && progress.daysLeft < 0
                        ? ' · Date passed'
                        : ''}
                    </p>
                  )}
                  <p className="mp-card-note">
                    {progress.account
                      ? `Following ${progress.account.name}'s current balance.`
                      : progress.source === 'unavailable'
                        ? 'Edit this goal to choose an eligible cash account.'
                        : 'Update the saved amount when your reserve changes.'}
                  </p>
                  {progress.monthlyNeededCents !== null && !progress.complete && (
                    <p className="mp-goal-pace">
                      About {formatMoney(progress.monthlyNeededCents)} per 30 days to reach your
                      target.
                    </p>
                  )}
                  {controls(plan)}
                </article>
              );
            })}
          </div>
          {!items.length && (
            <EmptyPlan
              icon="goal"
              text="Turn your next milestone into a savings target."
              action={() => newItem()}
              label="Create your first goal"
            />
          )}
        </>
      )}

      {!plans.loading && view === 'bills' && (
        <>
          <div className="mp-banner mp-bill-banner">
            <CalendarDays size={25} />
            <div>
              <span>Tracked payments coming up</span>
              <strong>
                {formatMoney(
                  upcoming.reduce(
                    (sum, row) => sum + row.plan.amountCents * row.occurrences.length,
                    0,
                  ),
                )}
              </strong>
            </div>
            <label>
              Look ahead{' '}
              <select
                aria-label="Look ahead"
                value={billDays}
                onChange={(event) => setBillDays(Number(event.target.value))}
              >
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
              </select>
            </label>
            <p>
              Amounts are scheduled estimates.
              <small>Saving a bill does not initiate or confirm a payment.</small>
            </p>
          </div>
          <div className="mp-bill-list">
            {upcoming.map(({ plan, date, occurrences }) => (
              <article className="mp-bill-row" key={plan.id}>
                <div className="mp-date-tile">
                  <strong>{Number(date.slice(8))}</strong>
                  <span>
                    {new Intl.DateTimeFormat('en-AU', { month: 'short', timeZone: 'UTC' }).format(
                      new Date(`${date}T00:00:00Z`),
                    )}
                  </span>
                </div>
                <div className="mp-bill-name">
                  <h3>{plan.name}</h3>
                  <p>
                    {entityName(data, plan.entityId)} · {plan.frequency}
                    {occurrences.length > 1 ? ` · ${occurrences.length} payments in this view` : ''}
                  </p>
                </div>
                <strong className="mp-bill-amount">
                  {formatMoney(plan.amountCents)}
                  <small>per payment</small>
                </strong>
                {controls(plan)}
              </article>
            ))}
          </div>
          {!upcoming.length && (
            <EmptyPlan
              icon="bill"
              text={
                items.length
                  ? 'No tracked payments fall in this period. Choose a longer view or add a bill.'
                  : 'Add your regular payments or review the suggestions below.'
              }
              action={() => newItem()}
              label="Add a bill"
            />
          )}
          {items.length > upcoming.length && (
            <div className="mp-later-bills">
              <h3>Later in your schedule</h3>
              {items
                .filter((plan) => !upcoming.some((row) => row.plan.id === plan.id))
                .map((plan) => (
                  <div key={plan.id}>
                    <span>
                      {plan.name}{' '}
                      <small>
                        {plan.dueDate && plan.frequency
                          ? prettyDate(nextBillDate(plan.dueDate, plan.frequency, asOfDate))
                          : ''}
                      </small>
                    </span>
                    {controls(plan)}
                  </div>
                ))}
            </div>
          )}
          <section className="mp-detected">
            <div className="mp-section-heading">
              <div>
                <span className="mp-eyebrow">SPOTTED IN YOUR TRANSACTIONS</span>
                <h3>Recurring payment suggestions</h3>
              </div>
              <Sparkles size={24} />
            </div>
            <p className="mp-section-note">
              We look for similar posted amounts from the same merchant and account at regular
              intervals. Dates and amounts are estimates; review them before tracking.
            </p>
            {detected.length ? (
              <div className="mp-detected-grid">
                {detected.slice(0, 9).map((bill) => (
                  <article className="mp-detected-card" key={bill.id}>
                    <h4>{bill.name}</h4>
                    <p>
                      {entityName(data, bill.entityId)} ·{' '}
                      {data.accounts.find((account) => account.id === bill.accountId)?.name}
                    </p>
                    <strong>
                      {formatMoney(bill.amountCents)} <span>{bill.frequency}</span>
                    </strong>
                    <p>
                      Estimated next: {prettyDate(bill.nextDueDate)}
                      <small>
                        Based on {bill.paymentCount} payments · last {prettyDate(bill.lastPaidDate)}
                      </small>
                    </p>
                    <button
                      className="mp-text-button"
                      onClick={() => newItem(bill)}
                      disabled={plans.saving}
                    >
                      Review & track <ChevronRight size={16} />
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mp-suggestion-empty">
                No untracked recurring patterns found in the available posted history yet.
              </div>
            )}
          </section>
        </>
      )}

      {!plans.loading && view === 'insights' && (
        <>
          <div className="mp-insights-grid">
            {buildPlanningInsights(data, effectiveScope, plans.items).map((insight) => (
              <article className={`mp-insight-card mp-insight-${insight.tone}`} key={insight.id}>
                <div className="mp-insight-icon">
                  {insight.tone === 'attention' ? <BellRing size={23} /> : <Sparkles size={23} />}
                </div>
                <span className="mp-eyebrow">
                  {insight.tone === 'attention'
                    ? 'WORTH A LOOK'
                    : insight.tone === 'positive'
                      ? 'LOOKING AHEAD'
                      : 'GOOD TO KNOW'}
                </span>
                <h3>{insight.title}</h3>
                {insight.amountCents !== undefined && (
                  <strong className="mp-insight-value">{formatMoney(insight.amountCents)}</strong>
                )}
                <p>{insight.detail}</p>
                <Link
                  className="mp-text-button"
                  to={
                    insight.action === 'transactions' && insight.categoryId
                      ? `/transactions?category=${insight.categoryId}`
                      : `/${insight.action}`
                  }
                >
                  View {insight.action}
                  <ArrowRight size={16} />
                </Link>
              </article>
            ))}
          </div>
          <p className="mp-method">
            <CircleHelp size={16} />
            Transaction insights use the displayed monthly period. Cash coverage and linked goals
            use the latest account balances, independent of the transaction reporting date.
          </p>
        </>
      )}
    </div>
  );
}

function EmptyPlan({
  icon,
  text,
  action,
  label,
}: {
  icon: PlanKind;
  text: string;
  action: () => void;
  label: string;
}) {
  return (
    <div className="mp-empty">
      <div>
        {icon === 'budget' ? (
          <Wallet size={30} />
        ) : icon === 'goal' ? (
          <Target size={30} />
        ) : (
          <CalendarDays size={30} />
        )}
      </div>
      <h3>{label}</h3>
      <p>{text}</p>
      <button className="mp-primary" onClick={action}>
        <Plus size={16} />
        {label}
      </button>
    </div>
  );
}

function PlanForm({
  input,
  data,
  entities,
  saving,
  asOfDate,
  onSave,
  onCancel,
}: {
  input: PlanInput;
  data: FinanceDataset;
  entities: FinanceDataset['entities'];
  saving: boolean;
  asOfDate: string;
  onSave: (input: PlanInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(input.name);
  const [amount, setAmount] = useState(
    input.amountCents ? (input.amountCents / 100).toFixed(2) : '',
  );
  const [saved, setSaved] = useState((input.savedCents / 100).toFixed(2));
  const [entityId, setEntityId] = useState(input.entityId ?? '');
  const [accountId, setAccountId] = useState(input.accountId ?? '');
  const [categoryId, setCategoryId] = useState(input.categoryId ?? '');
  const [dueDate, setDueDate] = useState(input.dueDate ?? '');
  const [frequency, setFrequency] = useState<PlanFrequency>(input.frequency ?? 'monthly');
  const [error, setError] = useState('');
  const accounts = data.accounts.filter(
    (account) =>
      (!entityId || account.entityId === entityId) &&
      entities.some((entity) => entity.id === account.entityId) &&
      (input.kind !== 'goal' || isCashAccount(account)),
  );
  const categoryOptions = data.categories.filter((category) => category.kind === 'expense');
  return (
    <form
      className="mp-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError('');
        const amountCents = Math.round(Number(amount) * 100),
          savedCents = Math.round(Number(saved) * 100);
        if (
          !name.trim() ||
          !Number.isSafeInteger(amountCents) ||
          amountCents <= 0 ||
          !Number.isSafeInteger(savedCents) ||
          savedCents < 0
        ) {
          setError('Enter a name, a positive amount and a non-negative saved balance.');
          return;
        }
        void onSave({
          ...input,
          name: name.trim(),
          amountCents,
          entityId: entityId || null,
          savedCents: input.kind === 'goal' && !accountId ? savedCents : 0,
          accountId: input.kind === 'budget' ? null : accountId || null,
          categoryId: input.kind === 'goal' ? null : categoryId || null,
          dueDate: input.kind === 'budget' ? null : dueDate || null,
          frequency: input.kind === 'bill' ? frequency : null,
        });
      }}
    >
      <div className="mp-form-heading">
        <h3>
          {input.id ? 'Edit' : 'New'} {input.kind}
        </h3>
        <button
          type="button"
          className="mp-icon-button"
          aria-label="Close plan form"
          onClick={onCancel}
          disabled={saving}
        >
          <X size={20} />
        </button>
      </div>
      <div className="mp-form-fields">
        <label>
          Name
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={120}
            placeholder={
              input.kind === 'budget'
                ? 'Dental supplies'
                : input.kind === 'goal'
                  ? 'Equipment reserve'
                  : 'Practice rent'
            }
          />
        </label>
        <label>
          {input.kind === 'budget'
            ? 'Monthly limit (AUD)'
            : input.kind === 'goal'
              ? 'Target amount (AUD)'
              : 'Amount per payment (AUD)'}
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            min="0.01"
            max="90000000000000"
            step="0.01"
            required
          />
        </label>
        <label>
          Entity
          <select
            aria-label="Entity"
            value={entityId}
            onChange={(event) => {
              setEntityId(event.target.value);
              setAccountId('');
            }}
          >
            <option value="">All business entities</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </select>
        </label>
        {input.kind !== 'goal' && (
          <label>
            Category
            <select
              aria-label="Category"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">
                {input.kind === 'budget' ? 'All expense categories' : 'No category'}
              </option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {input.kind !== 'budget' && (
          <label>
            {input.kind === 'goal' ? 'Linked account' : 'Payment account'}
            <select
              aria-label={input.kind === 'goal' ? 'Linked account' : 'Payment account'}
              value={accountId}
              onChange={(event) => {
                const next = event.target.value;
                setAccountId(next);
                if (next)
                  setEntityId(data.accounts.find((account) => account.id === next)?.entityId ?? '');
              }}
            >
              <option value="">
                {input.kind === 'goal' ? 'Manually tracked savings' : 'Choose later'}
              </option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {entityName(data, account.entityId)} · {account.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {input.kind === 'goal' && !accountId && (
          <label>
            Saved so far (AUD)
            <input
              type="number"
              inputMode="decimal"
              value={saved}
              onChange={(event) => setSaved(event.target.value)}
              min="0"
              step="0.01"
              required
            />
          </label>
        )}
        {input.kind !== 'budget' && (
          <label>
            {input.kind === 'goal' ? 'Target date (optional)' : 'Next due date'}
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              required={input.kind === 'bill'}
            />
          </label>
        )}
        {input.kind === 'bill' && (
          <label>
            Frequency
            <select
              aria-label="Frequency"
              value={frequency}
              onChange={(event) => setFrequency(event.target.value as PlanFrequency)}
            >
              {frequencies.map((value) => (
                <option value={value} key={value}>
                  {value[0].toUpperCase() + value.slice(1)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="mp-form-hint">
        {input.kind === 'budget'
          ? `Monthly budgets track posted outgoing transactions from ${prettyDate(monthPeriod(asOfDate).from)}. Refunds are not subtracted.`
          : input.kind === 'goal'
            ? accountId
              ? 'Progress follows the linked cash account’s full current balance. No funds are transferred or reserved.'
              : 'This is a manually tracked amount. No funds are transferred or reserved.'
            : 'This is a planning reminder. The app does not make payments or mark them paid.'}
      </p>
      {error && (
        <p role="alert" className="mp-form-error">
          {error}
        </p>
      )}
      <div className="mp-form-footer">
        <button className="mp-primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : `Save ${input.kind}`}
        </button>
        <button className="mp-secondary" type="button" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
