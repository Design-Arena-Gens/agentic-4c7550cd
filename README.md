## Agentic Crypto Automation

Autonomous trading dashboard powered by Next.js, Tailwind CSS, and ccxt. Configure moving-average crossover strategies, run paper trades, or (optionally) enable live execution against any ccxt-supported exchange.

### Features
- Interactive control panel for symbol, timeframe, risk, and execution mode
- Auto-run scheduler to trigger strategies every N minutes while the app is open
- Serverless strategy engine with moving-average crossover logic and risk-based sizing
- Paper-trading recommendations with live order execution toggle gated by environment flags
- Market overview chart with fast/slow moving averages and automation log
- Exchange balance viewer (requires API key configuration)

### Quick Start
```bash
npm install
npm run dev
# visit http://localhost:3000
```

### Required Environment Variables
Set these in a `.env.local` file (never commit secrets):
```
CRYPTO_EXCHANGE=binance           # any ccxt exchange id
CRYPTO_API_KEY=yourApiKey         # optional for paper mode
CRYPTO_API_SECRET=yourApiSecret   # optional for paper mode
CRYPTO_API_PASSWORD=optional      # only for exchanges that require it
CRYPTO_SANDBOX=true               # optional sandbox toggle if supported
ENABLE_LIVE_TRADING=false         # switch to true to transmit live orders
```

`CRYPTO_API_KEY` and `CRYPTO_API_SECRET` are only required when running in live mode. Orders are sent **only** if `ENABLE_LIVE_TRADING=true`.

### Deploy
Production-ready for Vercel. After setting environment variables in the Vercel dashboard, deploy with:
```bash
vercel deploy --prod --yes --token $VERCEL_TOKEN --name agentic-4c7550cd
```

### Tech Stack
- Next.js App Router with TypeScript
- Tailwind CSS
- ccxt for exchange connectivity
- SWR for data fetching
- Recharts for market visuals

### Notes
- Auto-run uses the browser timer; keep the tab open for continuous execution.
- Exchanges enforce rate limits. Adjust scheduling and request volumes as needed.
- Introduce additional strategies by extending `src/lib/strategy.ts`.
