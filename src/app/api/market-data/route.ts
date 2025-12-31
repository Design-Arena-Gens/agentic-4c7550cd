import { NextResponse } from "next/server";
import { z } from "zod";

import { fetchOhlcv } from "@/lib/ccxtClient";

const querySchema = z.object({
  symbol: z.string().default("BTC/USDT"),
  timeframe: z.string().default("1h"),
  limit: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return 200;
      const parsed = Number.parseInt(value, 10);
      return Number.isNaN(parsed) ? 200 : parsed;
    })
    .pipe(z.number().min(50).max(500)),
});

export const runtime = "nodejs";

export const GET = async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const validation = querySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );

  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid query parameters." },
      { status: 400 },
    );
  }

  try {
    const candles = await fetchOhlcv(
      validation.data.symbol,
      validation.data.timeframe,
      validation.data.limit,
    );
    return NextResponse.json({ data: candles });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: (error as Error).message ?? "Failed to fetch market data." },
      { status: 500 },
    );
  }
};
