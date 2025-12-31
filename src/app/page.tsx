"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  Formatter,
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";
import { format } from "date-fns";
import numeral from "numeral";

type StrategyMode = "paper" | "live";

type StrategyResponse = {
  strategy: {
    action: "buy" | "sell" | "hold";
    reason: string;
    latestPrice: number;
    positionSize: number;
    stopLoss?: number;
    takeProfit?: number;
    fastMA: (number | null)[];
    slowMA: (number | null)[];
  };
  suggestion: {
    side: "buy" | "sell";
    type: "market";
    size: number;
    price: number;
    stopLoss?: number;
    takeProfit?: number;
  } | null;
  execution?:
    | {
        status: "submitted" | "skipped";
        orderId?: string;
        reason?: string;
      }
    | undefined;
  meta: {
    evaluatedAt: number;
    symbol: string;
    timeframe: string;
    candlesUsed: number;
    liveTrading: boolean;
  };
};

type LogEntry = {
  id: string;
  timestamp: number;
  action: "buy" | "sell" | "hold";
  message: string;
  status: "success" | "error";
  mode: StrategyMode;
};

type Candle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const fetcher = (url: string) =>
  fetch(url, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.json();
  });

const movingAverage = (values: number[], period: number) => {
  if (period <= 0) return [];
  const output: (number | null)[] = [];
  for (let index = 0; index < values.length; index += 1) {
    if (index + 1 < period) {
      output.push(null);
      continue;
    }
    const window = values.slice(index + 1 - period, index + 1);
    const sum = window.reduce((acc, item) => acc + item, 0);
    output.push(sum / period);
  }
  return output;
};

const formatCurrency = (value: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(value);

const tooltipFormatter: Formatter<ValueType, NameType> = (
  value,
  name,
) => {
  const label =
    typeof name === "string" ? name : name != null ? String(name) : "";

  if (typeof value === "number") {
    const formattedLabel = label === "close" ? "Close" : label;
    return [formatCurrency(value), formattedLabel as NameType];
  }

  if (typeof value === "string") {
    return [value, label as NameType];
  }

  return ["--", label as NameType];
};

export default function Home() {
  const [symbol, setSymbol] = useState("BTC/USDT");
  const [timeframe, setTimeframe] = useState("1h");
  const [fastLength, setFastLength] = useState(21);
  const [slowLength, setSlowLength] = useState(55);
  const [capital, setCapital] = useState(1000);
  const [riskPercent, setRiskPercent] = useState(2);
  const [mode, setMode] = useState<StrategyMode>("paper");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [autoTrading, setAutoTrading] = useState(false);
  const [autoInterval, setAutoInterval] = useState(5);
  const [lastResponse, setLastResponse] = useState<StrategyResponse | null>(
    null,
  );

  const { data: market, isLoading: loadingMarket, mutate: refreshMarket } =
    useSWR<{ data: Candle[] }>(
      `/api/market-data?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=400`,
      fetcher,
      { revalidateOnFocus: false },
    );

  const { data: account } = useSWR<
    | {
        authenticated: boolean;
        balances: { asset: string; total: number; free: number; used: number }[];
        message?: string;
      }
    | undefined
  >("/api/account", fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 300000,
  });

  const chartData = useMemo(() => {
    const candles = market?.data ?? [];
    const closes = candles.map((candle) => candle.close);
    const fastSeries = movingAverage(closes, fastLength);
    const slowSeries = movingAverage(closes, slowLength);

    return candles.map((candle, index) => ({
      time: format(candle.timestamp, "MMM d HH:mm"),
      close: candle.close,
      fastMA: fastSeries[index],
      slowMA: slowSeries[index],
      volume: candle.volume,
    }));
  }, [market, fastLength, slowLength]);

  const randomId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  const appendLog = useCallback((entry: Omit<LogEntry, "id">) => {
    setLogs((existing) => [
      {
        id: randomId(),
        ...entry,
      },
      ...existing,
    ]);
  }, []);

  const runningRef = useRef(false);

  const runStrategy = useCallback(async () => {
    if (runningRef.current) {
      return;
    }
    runningRef.current = true;
    setIsRunning(true);
    try {
      const response = await fetch("/api/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          timeframe,
          fastLength,
          slowLength,
          capital,
          riskPercent,
          mode,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        appendLog({
          timestamp: Date.now(),
          action: "hold",
          status: "error",
          message: errorText,
          mode,
        });
        return;
      }

      const payload = (await response.json()) as StrategyResponse;
      setLastResponse(payload);
      appendLog({
        timestamp: payload.meta.evaluatedAt,
        action: payload.strategy.action,
        status: "success",
        message: payload.strategy.reason,
        mode,
      });

      if (payload.execution?.status === "submitted") {
        void refreshMarket();
      }
    } catch (error) {
      appendLog({
        timestamp: Date.now(),
        action: "hold",
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
        mode,
      });
    } finally {
      runningRef.current = false;
      setIsRunning(false);
    }
  }, [
    symbol,
    timeframe,
    fastLength,
    slowLength,
    capital,
    riskPercent,
    mode,
    appendLog,
    refreshMarket,
  ]);

  useEffect(() => {
    if (!autoTrading) return undefined;
    runStrategy();
    const interval = window.setInterval(() => {
      runStrategy();
    }, autoInterval * 60 * 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [autoTrading, autoInterval, runStrategy]);

  const latestPrice = chartData.at(-1)?.close ?? 0;

  return (
    <div className="min-h-screen bg-slate-950/95 pb-12 text-white">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm uppercase tracking-widest text-sky-400">
              Autonomous Crypto Suite
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              Smart Trading Automation
            </h1>
            <p className="text-sm text-slate-400">
              Configure your strategy, connect exchange keys, and let the agent
              manage positions.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={autoTrading}
                onChange={(event) => setAutoTrading(event.target.checked)}
                className="h-4 w-4 rounded border border-slate-600 bg-slate-800 text-sky-500"
              />
              Auto-run every
            </label>
            <select
              value={autoInterval}
              onChange={(event) => setAutoInterval(Number(event.target.value))}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            >
              <option value={1}>1 min</option>
              <option value={5}>5 min</option>
              <option value={15}>15 min</option>
            </select>
            <button
              onClick={runStrategy}
              disabled={isRunning}
              className="rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-sm hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {isRunning ? "Running..." : "Run Strategy"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto mt-8 grid max-w-6xl gap-6 px-6 lg:grid-cols-[320px,1fr]">
        <section className="space-y-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Strategy Configuration
            </h2>
            <p className="text-xs text-slate-400">
              Adjust parameters and swap between paper or live execution.
            </p>
          </div>
          <div className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-slate-400">
                Trading Pair
              </label>
              <input
                value={symbol}
                onChange={(event) => setSymbol(event.target.value)}
                placeholder="BTC/USDT"
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wide text-slate-400">
                  Timeframe
                </label>
                <select
                  value={timeframe}
                  onChange={(event) => setTimeframe(event.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="1m">1m</option>
                  <option value="5m">5m</option>
                  <option value="15m">15m</option>
                  <option value="1h">1h</option>
                  <option value="4h">4h</option>
                  <option value="1d">1d</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wide text-slate-400">
                  Mode
                </label>
                <select
                  value={mode}
                  onChange={(event) => setMode(event.target.value as StrategyMode)}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="paper">Paper</option>
                  <option value="live">Live</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wide text-slate-400">
                  Fast MA
                </label>
                <input
                  type="number"
                  min={3}
                  max={200}
                  value={fastLength}
                  onChange={(event) =>
                    setFastLength(Number.parseInt(event.target.value, 10))
                  }
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wide text-slate-400">
                  Slow MA
                </label>
                <input
                  type="number"
                  min={5}
                  max={400}
                  value={slowLength}
                  onChange={(event) =>
                    setSlowLength(Number.parseInt(event.target.value, 10))
                  }
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wide text-slate-400">
                  Capital (USD)
                </label>
                <input
                  type="number"
                  min={10}
                  value={capital}
                  onChange={(event) =>
                    setCapital(Number.parseFloat(event.target.value))
                  }
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wide text-slate-400">
                  Risk %
                </label>
                <input
                  type="number"
                  min={0.1}
                  max={100}
                  step={0.1}
                  value={riskPercent}
                  onChange={(event) =>
                    setRiskPercent(Number.parseFloat(event.target.value))
                  }
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="rounded-md border border-slate-700 bg-slate-950/70 p-4 text-xs leading-5 text-slate-300">
              <p>
                To enable live execution, add environment variables
                <code className="mx-1 rounded bg-slate-800 px-1 py-0.5">
                  CRYPTO_API_KEY
                </code>
                and
                <code className="mx-1 rounded bg-slate-800 px-1 py-0.5">
                  CRYPTO_API_SECRET
                </code>
                ,
                <code className="mx-1 rounded bg-slate-800 px-1 py-0.5">
                  CRYPTO_EXCHANGE
                </code>{" "}
                (default binance), and set{" "}
                <code className="mx-1 rounded bg-slate-800 px-1 py-0.5">
                  ENABLE_LIVE_TRADING=true
                </code>
                .
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  Market Overview
                </p>
                <h2 className="text-2xl font-semibold text-white">
                  {symbol} · {timeframe}
                </h2>
                <p className="text-sm text-slate-300">
                  Latest price:{" "}
                  <span className="font-semibold text-sky-300">
                    {formatCurrency(latestPrice)}
                  </span>
                </p>
              </div>
              <div className="flex gap-3">
                <div className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-right">
                  <p className="text-xs uppercase text-slate-500">Fast MA</p>
                  <p className="text-lg font-semibold text-sky-300">
                    {lastResponse?.strategy.fastMA.at(-1)
                      ? numeral(lastResponse.strategy.fastMA.at(-1)).format(
                          "0,0.00",
                        )
                      : "--"}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-right">
                  <p className="text-xs uppercase text-slate-500">Slow MA</p>
                  <p className="text-lg font-semibold text-emerald-300">
                    {lastResponse?.strategy.slowMA.at(-1)
                      ? numeral(lastResponse.strategy.slowMA.at(-1)).format(
                          "0,0.00",
                        )
                      : "--"}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-right">
                  <p className="text-xs uppercase text-slate-500">Action</p>
                  <p className="text-lg font-semibold text-white">
                    {lastResponse?.strategy.action.toUpperCase() ?? "--"}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 h-[320px] w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              {loadingMarket ? (
                <div className="flex h-full items-center justify-center text-slate-500">
                  Loading market data...
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.6} />
                        <stop offset="95%" stopColor="#0f172a" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1f2937" strokeDasharray="4 8" />
                    <XAxis
                      dataKey="time"
                      stroke="#64748b"
                      tick={{ fontSize: 12, fill: "#94a3b8" }}
                      hide={chartData.length > 120}
                    />
                    <YAxis
                      stroke="#64748b"
                      tick={{ fontSize: 12, fill: "#94a3b8" }}
                      domain={["auto", "auto"]}
                      width={70}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#0f172a",
                        border: "1px solid #1e293b",
                      }}
                      labelStyle={{ color: "#e2e8f0" }}
                      formatter={tooltipFormatter}
                    />
                    <Area
                      type="monotone"
                      dataKey="close"
                      stroke="#38bdf8"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorPrice)"
                      name="close"
                    />
                    <Line
                      type="monotone"
                      dataKey="fastMA"
                      stroke="#22d3ee"
                      strokeWidth={1.5}
                      dot={false}
                      name="Fast MA"
                    />
                    <Line
                      type="monotone"
                      dataKey="slowMA"
                      stroke="#facc15"
                      strokeWidth={1.5}
                      dot={false}
                      name="Slow MA"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/30 p-6">
              <h3 className="text-lg font-semibold text-white">
                Latest Recommendation
              </h3>
              {lastResponse ? (
                <ul className="space-y-3 text-sm text-slate-200">
                  <li className="flex justify-between">
                    <span>Signal</span>
                    <span className="font-semibold uppercase text-sky-300">
                      {lastResponse.strategy.action}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span>Reason</span>
                    <span className="max-w-[60%] text-right text-slate-300">
                      {lastResponse.strategy.reason}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span>Position Size</span>
                    <span>{numeral(lastResponse.strategy.positionSize).format("0,0.000")} {symbol.split("/")[0]}</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Latest Price</span>
                    <span>{formatCurrency(lastResponse.strategy.latestPrice)}</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Stop Loss</span>
                    <span>
                      {lastResponse.strategy.stopLoss
                        ? formatCurrency(lastResponse.strategy.stopLoss)
                        : "--"}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span>Take Profit</span>
                    <span>
                      {lastResponse.strategy.takeProfit
                        ? formatCurrency(lastResponse.strategy.takeProfit)
                        : "--"}
                    </span>
                  </li>
                  {lastResponse.execution && (
                    <li className="flex justify-between">
                      <span>Execution</span>
                      <span className="text-slate-300">
                        {lastResponse.execution.status === "submitted"
                          ? `Order ${lastResponse.execution.orderId ?? "sent"}`
                          : lastResponse.execution.reason ?? "Pending"}
                      </span>
                    </li>
                  )}
                </ul>
              ) : (
                <p className="text-sm text-slate-400">
                  Run the strategy to generate a recommendation.
                </p>
              )}
            </div>

            <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/30 p-6">
              <h3 className="text-lg font-semibold text-white">Account</h3>
              {account?.authenticated ? (
                <div className="space-y-3 text-sm text-slate-200">
                  {account.balances.length === 0 ? (
                    <p className="text-slate-400">No balances detected.</p>
                  ) : (
                    <ul className="space-y-2">
                      {account.balances.slice(0, 6).map((balance) => (
                        <li
                          key={balance.asset}
                          className="flex justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2"
                        >
                          <span>{balance.asset}</span>
                          <span className="font-semibold">
                            {numeral(balance.total).format("0,0.000")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <div className="space-y-2 text-sm text-slate-400">
                  <p>{account?.message ?? "API credentials missing. Update environment variables to fetch balances."}</p>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Automation Log</h3>
              <button
                onClick={() => setLogs([])}
                className="text-xs uppercase tracking-wide text-slate-400 hover:text-slate-200"
              >
                Clear Log
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              {logs.length === 0 ? (
                <p className="text-slate-400">No automation activity yet.</p>
              ) : (
                logs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-start justify-between rounded-md border border-slate-800 bg-slate-950/60 px-3 py-3"
                  >
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        {format(log.timestamp, "MMM d - HH:mm")}
                      </p>
                      <p className="font-semibold text-white">
                        {log.action.toUpperCase()} · {log.mode.toUpperCase()}
                      </p>
                      <p className="text-xs text-slate-400">{log.message}</p>
                    </div>
                    <span
                      className={`text-xs font-semibold uppercase tracking-wide ${
                        log.status === "success" ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {log.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
