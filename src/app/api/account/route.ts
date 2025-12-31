import { NextResponse } from "next/server";

import { createExchange } from "@/lib/ccxtClient";

export const runtime = "nodejs";

export const GET = async () => {
  try {
    const exchange = createExchange();
    const hasAuth = Boolean(
      process.env.CRYPTO_API_KEY && process.env.CRYPTO_API_SECRET,
    );

    if (!hasAuth) {
      return NextResponse.json({
        authenticated: false,
        balances: [],
        message: "API credentials not configured. Showing empty balances.",
      });
    }

    const balances = (await exchange.fetchBalance()) as {
      total?: Record<string, number>;
      free?: Record<string, number>;
      used?: Record<string, number>;
    };

    const summary = Object.entries(balances.total ?? {})
      .filter(([, value]) => typeof value === "number" && value > 0)
      .map(([asset, value]) => ({
        asset,
        total: value,
        free: balances.free?.[asset] ?? 0,
        used: balances.used?.[asset] ?? 0,
      }));

    return NextResponse.json({
      authenticated: true,
      balances: summary,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: (error as Error).message ?? "Failed to load balances.",
      },
      { status: 500 },
    );
  }
};
