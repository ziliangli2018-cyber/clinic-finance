import { useState } from 'react';
import type { ReactNode } from 'react';
import { CalendarRange, CircleHelp, Repeat2, TrendingUp, Wallet } from 'lucide-react';
import type { FinanceDataset, FinanceScope } from '../types/domain';
import {
  filterAccounts,
  formatCompactMoney,
  formatMoney,
  isCashAccount,
} from '../domain/analytics';
import { buildCashflowForecast } from '../domain/forecast';
import { dateValue, shiftDate } from '../domain/dates';

const horizons = [30, 60, 90] as const;

const dateLabel = (date: string, includeYear = false) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    ...(includeYear ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  });

type ForecastResult = ReturnType<typeof buildCashflowForecast>;

function ForecastChart({ forecast }: { forecast: ForecastResult }) {
  const width = 900;
  const height = 286;
  const plot = { left: 72, right: 28, top: 24, bottom: 42 };
  const values = forecast.points.flatMap((point) => [
    point.lowCents,
    point.expectedCents,
    point.highCents,
  ]);
  values.push(forecast.openingBalanceCents);
  const rawMin = Math.min(...values, 0);
  const rawMax = Math.max(...values, 1);
  const padding = Math.max(100_000, (rawMax - rawMin) * 0.1);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const innerWidth = width - plot.left - plot.right;
  const innerHeight = height - plot.top - plot.bottom;
  const x = (index: number) =>
    plot.left + (index / Math.max(1, forecast.points.length - 1)) * innerWidth;
  const y = (value: number) => plot.top + ((max - value) / Math.max(1, max - min)) * innerHeight;
  const expectedPath = forecast.points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(point.expectedCents)}`)
    .join(' ');
  const bandPath = [
    ...forecast.points.map(
      (point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(point.highCents)}`,
    ),
    ...forecast.points
      .map((point, index) => ({ point, index }))
      .reverse()
      .map(({ point, index }) => `L${x(index)},${y(point.lowCents)}`),
    'Z',
  ].join(' ');
  const ticks = [0, 0.5, 1].map((fraction) => min + (max - min) * fraction);
  const dateIndexes = [
    ...new Set([0, Math.floor((forecast.points.length - 1) / 2), forecast.points.length - 1]),
  ];

  return (
    <div className="forecast-chart">
      <div className="forecast-legend" aria-hidden="true">
        <span>
          <i className="forecast-line-key" />
          Expected
        </span>
        <span>
          <i className="forecast-band-key" />
          Indicative range
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${forecast.horizonDays}-day cash forecast. Expected closing balance ${formatMoney(forecast.closingBalanceCents)}. Indicative range ${formatMoney(forecast.lowClosingBalanceCents)} to ${formatMoney(forecast.highClosingBalanceCents)}.`}
      >
        <title>
          Expected cash balance and indicative low-to-high range over {forecast.horizonDays} days.
        </title>
        <defs>
          <linearGradient id="forecast-band" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6db69b" stopOpacity="0.3" />
            <stop offset="1" stopColor="#6db69b" stopOpacity="0.05" />
          </linearGradient>
          <linearGradient id="forecast-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#1f6c56" />
            <stop offset="1" stopColor="#3d9b78" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={plot.left}
              x2={width - plot.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="#e8eef0"
              strokeDasharray="4 6"
            />
            <text x={plot.left - 12} y={y(tick) + 4} textAnchor="end" fill="#7c8b94" fontSize="11">
              {formatCompactMoney(tick)}
            </text>
          </g>
        ))}
        <line
          x1={plot.left}
          x2={width - plot.right}
          y1={y(forecast.openingBalanceCents)}
          y2={y(forecast.openingBalanceCents)}
          stroke="#9aa8ae"
          strokeDasharray="2 7"
        />
        {forecast.points.length > 0 && (
          <>
            <path d={bandPath} fill="url(#forecast-band)" />
            <path
              d={expectedPath}
              fill="none"
              stroke="url(#forecast-line)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              cx={x(forecast.points.length - 1)}
              cy={y(forecast.closingBalanceCents)}
              r="5"
              fill="#2c876a"
              stroke="#fff"
              strokeWidth="3"
            />
          </>
        )}
        {dateIndexes.map((index) => {
          const point = forecast.points[index];
          return point ? (
            <text
              key={point.date}
              x={x(index)}
              y={height - 12}
              textAnchor={
                index === 0 ? 'start' : index === forecast.points.length - 1 ? 'end' : 'middle'
              }
              fill="#7c8b94"
              fontSize="11"
            >
              {dateLabel(point.date)}
            </text>
          ) : null;
        })}
      </svg>
    </div>
  );
}

function ForecastMetric({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <div className="forecast-metric">
      <span className="forecast-metric-label">
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export function CashflowForecast({ data, scope }: { data: FinanceDataset; scope: FinanceScope }) {
  const [horizon, setHorizon] = useState<(typeof horizons)[number]>(30);
  const statementAccounts = filterAccounts(data, scope).filter(isCashAccount);
  const statementDates = new Set(
    statementAccounts.map((account) => account.updatedAt.slice(0, 10)),
  );
  if (
    data.organisation.dataSource === 'csv' &&
    (!statementAccounts.length || statementDates.size !== 1)
  )
    return (
      <section className="panel forecast-panel">
        <div className="forecast-heading">
          <div>
            <span className="eyebrow">STATEMENT FORECAST</span>
            <h2>
              {statementAccounts.length
                ? 'Align statement balance dates'
                : 'Import a cash account to forecast'}
            </h2>
            <p>
              {statementAccounts.length
                ? 'A combined cash forecast needs closing balances for the same date. Select one clinic with aligned account dates, or import updated balance snapshots before projecting the combined cash position.'
                : 'Loan balances are liabilities, not available cash. Import an operating, savings or transaction account with a dated closing balance.'}
            </p>
          </div>
        </div>
        <a className="button secondary" href="#/import">
          Import updated statements
        </a>
      </section>
    );
  const cashSnapshotDate = [...statementDates][0];
  const historySpan =
    scope.from && scope.to
      ? Math.max(0, Math.round((dateValue(scope.to) - dateValue(scope.from)) / 86_400_000))
      : 179;
  const forecastScope =
    data.organisation.dataSource === 'csv'
      ? {
          ...scope,
          to: cashSnapshotDate,
          from: shiftDate(cashSnapshotDate, -Math.min(historySpan, 179)),
        }
      : scope;
  const forecast = buildCashflowForecast(data, forecastScope, horizon);
  const change = forecast.closingBalanceCents - forecast.openingBalanceCents;

  return (
    <>
      <section className="panel forecast-panel">
        <div className="forecast-heading">
          <div>
            <span className="eyebrow">FORWARD VIEW</span>
            <h2>Cash-flow forecast</h2>
            <p>
              Expected cash position based on your recent posted activity and recurring patterns.
            </p>
          </div>
          <div className="forecast-horizon" role="group" aria-label="Forecast horizon">
            {horizons.map((days) => (
              <button
                key={days}
                className={horizon === days ? 'selected' : ''}
                aria-pressed={horizon === days}
                onClick={() => setHorizon(days)}
              >
                {days} days
              </button>
            ))}
          </div>
        </div>
        <div className="forecast-metrics">
          <ForecastMetric
            label="Opening cash"
            value={formatMoney(forecast.openingBalanceCents)}
            detail={`${data.organisation.dataSource === 'csv' ? 'Statement balance at' : 'Balance at'} ${dateLabel(forecast.asOfDate, data.organisation.dataSource === 'csv')}`}
            icon={<Wallet size={16} />}
          />
          <ForecastMetric
            label="Expected closing"
            value={formatMoney(forecast.closingBalanceCents)}
            detail={`${change >= 0 ? '+' : '−'}${formatMoney(Math.abs(change))} expected movement`}
            icon={<TrendingUp size={16} />}
          />
          <ForecastMetric
            label="Indicative range"
            value={`${formatCompactMoney(forecast.lowClosingBalanceCents)} – ${formatCompactMoney(forecast.highClosingBalanceCents)}`}
            detail="Lower to upper scenario"
            icon={<CalendarRange size={16} />}
          />
          <ForecastMetric
            label="Recurring patterns"
            value={String(forecast.recurringSeriesCount)}
            detail={`${formatMoney(forecast.dailyDiscretionaryOutflowCents)} average daily variable spend`}
            icon={<Repeat2 size={16} />}
          />
        </div>
        <ForecastChart forecast={forecast} />
      </section>
      <div className="forecast-notes-grid">
        <section className="panel forecast-assumptions">
          <div className="panel-heading">
            <div>
              <h2>What shapes this view</h2>
              <p>Transparent assumptions you can check against your own plans.</p>
            </div>
          </div>
          <ul>
            {forecast.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </section>
        <aside className="forecast-disclaimer">
          <CircleHelp size={21} />
          <div>
            <strong>Planning signal, not a promise</strong>
            <p>{forecast.disclaimer}</p>
          </div>
        </aside>
      </div>
    </>
  );
}
