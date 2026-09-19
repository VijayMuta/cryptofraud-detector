# CryptoFraud Detector — Phase 4 setup

Phase 4 retains the Phase 2 authentication and Phase 3 live investigation flow, and adds persisted, scheduled Ethereum wallet monitoring.

## 1. Create or migrate the database

1. Create a Supabase project if you do not already have one.
2. Open the Supabase SQL Editor.
3. Paste all contents of `supabase-schema.sql` and run it. It is safe to rerun for an existing Phase 2 installation and adds the Phase 4 monitoring tables, constraints, and row-level security policies.

## 2. Get API settings

In Supabase project settings, find the Project URL, publishable (anon) key, and service-role key. Get an Alchemy API key for wallet and transaction lookups, plus an Etherscan API key for scheduled case and monitor history retrieval.

## 3. Configure the local app

Copy `.env.local.example` to `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `ALCHEMY_API_KEY`
- `ETHERSCAN_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET` — a long, randomly generated value

`SUPABASE_SERVICE_ROLE_KEY`, `ALCHEMY_API_KEY`, `ETHERSCAN_API_KEY`, and `CRON_SECRET` are server-only environment variables. Never give them a `NEXT_PUBLIC_` prefix, expose them in client code, or commit a real value.

## 4. Install and run

In the project folder:

```sh
npm install
npm run dev
```

Open `http://localhost:3000/register`.

## 5. Deploy scheduled monitoring

`vercel.json` invokes `/api/monitoring/poll` every five minutes. In Vercel, add the same server-only environment variables to the deployed project; Vercel sends `Authorization: Bearer <CRON_SECRET>` to the scheduled route. This five-minute schedule requires a non-Hobby Vercel plan; Hobby deployments allow one cron invocation per day. For another host, schedule an authenticated `GET` request to that route every five minutes with that same header.

The monitoring route checks at most 25 active wallets per run, oldest first, and performs calls sequentially to stay within Etherscan rate limits.

## 6. Test

- Register or sign in, and confirm the dashboard opens.
- Investigate a real Ethereum address, then select **Monitor wallet**. Current real-chain history is stored only as a baseline.
- Use **Check now** to run one authenticated live check. New transaction hashes are stored once, analyzed with the Phase 3 analysis, and only high-risk splitting or unusual outgoing movements generate an alert.
- Open **Alerts** to view persisted alerts. No demo blockchain data is used by the monitoring flow.
