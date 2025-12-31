import type { OHLCVRecord } from "./ccxtClient";

export type StrategyMode = "paper" | "live";

export type StrategyConfig = {
  symbol: string;
  timeframe: string;
  fastLength: number;
  slowLength: number;
  capital: number;
  riskPercent: number;
  mode: StrategyMode;
};

export type StrategyOrder = {
  side: "buy" | "sell";
  type: "market";
  size: number;
  price: number;
  stopLoss?: number;
  takeProfit?: number;
};

export type StrategyComputation = {
  action: "buy" | "sell" | "hold";
  reason: string;
  latestPrice: number;
  positionSize: number;
  stopLoss?: number;
  takeProfit?: number;
  fastMA: (number | null)[];
  slowMA: (number | null)[];
};

const simpleMovingAverage = (values: number[], period: number) => {
  const result: (number | null)[] = [];
  if (period <= 0) {
    throw new Error("SMA period must be greater than zero");
  }
  for (let i = 0; i < values.length; i += 1) {
    if (i + 1 < period) {
      result.push(null);
      continue;
    }
    const window = values.slice(i + 1 - period, i + 1);
    const sum = window.reduce((acc, value) => acc + value, 0);
    result.push(sum / period);
  }
  return result;
};

export const evaluateStrategy = (
  candles: OHLCVRecord[],
  config: StrategyConfig,
): StrategyComputation => {
  if (candles.length === 0) {
    throw new Error("No OHLCV data available for strategy evaluation.");
  }

  const closes = candles.map((candle) => candle.close);
  const fastMA = simpleMovingAverage(closes, config.fastLength);
  const slowMA = simpleMovingAverage(closes, config.slowLength);

  const lastIndex = closes.length - 1;
  const lastFast = fastMA[lastIndex];
  const lastSlow = slowMA[lastIndex];
  const prevFast = fastMA[lastIndex - 1] ?? null;
  const prevSlow = slowMA[lastIndex - 1] ?? null;
  const latestPrice = closes[lastIndex];

  let action: "buy" | "sell" | "hold" = "hold";
  let reason = "No actionable crossover detected.";

  if (lastFast != null && lastSlow != null) {
    if (
      prevFast != null &&
      prevSlow != null &&
      prevFast <= prevSlow &&
      lastFast > lastSlow
    ) {
      action = "buy";
      reason = `Bullish crossover detected (fast MA ${lastFast.toFixed(2)} > slow MA ${lastSlow.toFixed(2)}).`;
    } else if (
      prevFast != null &&
      prevSlow != null &&
      prevFast >= prevSlow &&
      lastFast < lastSlow
    ) {
      action = "sell";
      reason = `Bearish crossover detected (fast MA ${lastFast.toFixed(2)} < slow MA ${lastSlow.toFixed(2)}).`;
    } else if (lastFast > lastSlow) {
      action = "buy";
      reason = "Fast MA remains above slow MA (trend-following continuation).";
    } else if (lastFast < lastSlow) {
      action = "sell";
      reason = "Fast MA remains below slow MA (trend-following continuation).";
    }
  }

  const riskFraction = Math.max(Math.min(config.riskPercent / 100, 1), 0);
  const capitalToUse = config.capital * riskFraction;
  const positionSize =
    latestPrice > 0 ? Number((capitalToUse / latestPrice).toFixed(6)) : 0;

  const recentLow = Math.min(
    ...candles.slice(-config.slowLength).map((candle) => candle.low),
  );
  const recentHigh = Math.max(
    ...candles.slice(-config.slowLength).map((candle) => candle.high),
  );

  const stopLoss =
    action === "buy"
      ? Number((recentLow * 0.99).toFixed(2))
      : Number((recentHigh * 1.01).toFixed(2));

  const takeProfit =
    action === "buy"
      ? Number((latestPrice * 1.03).toFixed(2))
      : Number((latestPrice * 0.97).toFixed(2));

  return {
    action,
    reason,
    latestPrice,
    positionSize,
    stopLoss: Number.isFinite(stopLoss) ? stopLoss : undefined,
    takeProfit: Number.isFinite(takeProfit) ? takeProfit : undefined,
    fastMA,
    slowMA,
  };
};

export const buildOrder = (
  computation: StrategyComputation,
): StrategyOrder | null => {
  if (computation.action === "hold" || computation.positionSize <= 0) {
    return null;
  }

  return {
    side: computation.action,
    type: "market",
    size: computation.positionSize,
    price: computation.latestPrice,
    stopLoss: computation.stopLoss,
    takeProfit: computation.takeProfit,
  };
};
