# Deployment (plan; nothing deployed yet)

## What you supply

| Item | How | Used for |
|---|---|---|
| Throwaway testnet account | Create fresh in QoreX or via SDK; **never reuse a key that held real funds**. Fund at https://dashboard.qorechain.io (100 QOR / 24 h). | deployer, relayer, drill account |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey (free) | AI agents |
| Supabase project | supabase.com free tier; run `supabase/migrations/0001_core.sql` | DB, auth, ciphertext storage |
| `AGENT_MESSAGE_ROOT_SECRET` | `openssl rand -hex 32` | agent message HMAC keys |
| Registration | build.qorechain.io (GitHub + X + QoreX testnet address) | submission + drill |

Do not paste a mnemonic or private key into chat. Put it in `.env` locally or a secrets manager. I will not ask for it.

## Contracts (explicit approval needed before any broadcast)

```bash
cd contracts
forge build
# deployment script is not written yet; it will use a keystore/env key and print addresses + tx hashes
```
Deploy needs an **unscoped** EVM window (contract creation is refused under a scoped window); close it afterwards.

## Web + worker

* Vercel: Next.js app and short API routes (not built yet).
* Worker (long-running agents, schedules): a small Node service on Fly.io/Railway/a VM, or Cloudflare Workers Cron for light jobs.
  Do not rely on a serverless request staying alive. Not built yet.
* Supabase: apply migrations, create a Storage bucket `ciphertext` (private), keep the service-role key server-side only.
