import ccxt from "ccxt";

type BasicExchange = {
  fetchOHLCV: (
    symbol: string,
    timeframe: string,
    since?: number,
    limit?: number,
  ) => Promise<number[][]>;
  fetchBalance: () => Promise<Record<string, unknown>>;
  createOrder: (
    symbol: string,
    type: string,
    side: string,
    amount: number,
    price?: number,
    params?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  setSandboxMode?: (enabled: boolean) => void;
};

type ExchangeCtor = new (config?: Record<string, unknown>) => BasicExchange;

const getExchangeClass = (exchangeId: string): ExchangeCtor => {
  const registry = ccxt as unknown as Record<string, ExchangeCtor>;
  const ExchangeClass = registry[exchangeId];
  if (!ExchangeClass) {
    throw new Error(
      `Exchange "${exchangeId}" is not available in ccxt. Check CRYPTO_EXCHANGE env.`,
    );
  }
  return ExchangeClass;
};

export type ExchangeAuthConfig = {
  requireAuth?: boolean;
};

export const createExchange = (config: ExchangeAuthConfig = {}) => {
  const exchangeId = process.env.CRYPTO_EXCHANGE ?? "binance";
  const apiKey = process.env.CRYPTO_API_KEY;
  const secret = process.env.CRYPTO_API_SECRET;
  const password = process.env.CRYPTO_API_PASSWORD;

  if (config.requireAuth && (!apiKey || !secret)) {
    throw new Error(
      "Live trading requires CRYPTO_API_KEY and CRYPTO_API_SECRET to be set.",
    );
  }

  const ExchangeClass = getExchangeClass(exchangeId);
  const exchange = new ExchangeClass({
    enableRateLimit: true,
    apiKey,
    secret,
    password,
  });

  if ("setSandboxMode" in exchange && process.env.CRYPTO_SANDBOX === "true") {
    exchange.setSandboxMode?.(true);
  }

  return exchange;
};

export type OHLCVRecord = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export const fetchOhlcv = async (
  symbol: string,
  timeframe: string,
  limit: number,
) => {
  const exchange = createExchange();
  const raw = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
  return raw.map(
    ([timestamp, open, high, low, close, volume]): OHLCVRecord => ({
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    }),
  );
};
