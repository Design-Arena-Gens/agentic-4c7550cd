import { NextResponse } from "next/server";
import { z } from "zod";

import { createExchange, fetchOhlcv } from "@/lib/ccxtClient";
import { buildOrder, evaluateStrategy } from "@/lib/strategy";

const bodySchema = z.object({
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  fastLength: z.coerce.number().int().min(3).max(200),
  slowLength: z.coerce.number().int().min(5).max(400),
  capital: z.coerce.number().min(10),
  riskPercent: z.coerce.number().min(0.1).max(100),
  mode: z.enum(["paper", "live"]).default("paper"),
});

export const runtime = "nodejs";

export const POST = async (request: Request) => {
  let payload: z.infer<typeof bodySchema>;
  try {
    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    payload = parsed.data;
  } catch {
    return NextResponse.json(
      { error: "Malformed JSON payload supplied." },
      { status: 400 },
    );
  }

  try {
    const limit = Math.max(payload.slowLength * 4, 200);
    const candles = await fetchOhlcv(payload.symbol, payload.timeframe, limit);
    const strategy = evaluateStrategy(candles, payload);
    const suggestedOrder = buildOrder(strategy);

    let execution:
      | {
          status: "submitted" | "skipped";
          orderId?: string;
          raw?: unknown;
          reason?: string;
        }
      | undefined;

    if (suggestedOrder && payload.mode === "live") {
      if (process.env.ENABLE_LIVE_TRADING === "true") {
        const exchange = createExchange({ requireAuth: true });
        const orderResult = await exchange.createOrder(
          payload.symbol,
          suggestedOrder.type,
          suggestedOrder.side,
          suggestedOrder.size,
          undefined,
        );
        execution = {
          status: "submitted",
          orderId:
            typeof orderResult.id === "string" ? orderResult.id : undefined,
          raw: orderResult,
        };
      } else {
        execution = {
          status: "skipped",
          reason:
            "ENABLE_LIVE_TRADING is not set to true. Order not transmitted.",
        };
      }
    }

    return NextResponse.json({
      strategy,
      suggestion: suggestedOrder,
      execution,
      meta: {
        evaluatedAt: Date.now(),
        symbol: payload.symbol,
        timeframe: payload.timeframe,
        candlesUsed: candles.length,
        liveTrading: payload.mode === "live",
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: (error as Error).message ?? "Strategy evaluation failed." },
      { status: 500 },
    );
  }
};
