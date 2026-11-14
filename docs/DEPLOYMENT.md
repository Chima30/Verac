# Deployment (script written and dry-run locally; nothing deployed)

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

`contracts/script/Deploy.s.sol` deploys PolicyManager, TreasuryVault, MilestoneEscrow, AuditAnchor and
OrganizationRegistry. It **reverts unless the chain id is 9800**. No key is read from env or the repo: sign with a
Foundry keystore. Dry-run verified on a local anvil node only (2026-11-14); it has **not** been run against Diana.

```bash
cd contracts
forge build
# one-time: import the throwaway key into an encrypted keystore (prompts locally; never paste it in chat)
cast wallet import qoreops-deployer --interactive
# optional: OWNER=0x... gives ownership of all Ownable contracts to another account (use a multisig when real)
forge script script/Deploy.s.sol --rpc-url https://evm-testnet.qore.host --account qoreops-deployer   # simulation
forge script script/Deploy.s.sol --rpc-url https://evm-testnet.qore.host --account qoreops-deployer --broadcast   # real, needs approval
```
Then put the printed addresses in `.env` (`TREASURY_VAULT_ADDRESS`, ...). The Integrations page shows them as
"ADDRESS SET, UNVERIFIED" until a chain read confirms code exists there.
Deploy needs an **unscoped** EVM window (contract creation is refused under a scoped window); close it afterwards.
Window opening is a hybrid-signed native message and is not implemented in this repo yet.
The `paris` EVM target is untested on Diana; a failed deploy may mean a different hardfork is needed.

## Web + worker

* Vercel: Next.js app and short API routes (not built yet).
* Worker (long-running agents, schedules): a small Node service on Fly.io/Railway/a VM, or Cloudflare Workers Cron for light jobs.
  Do not rely on a serverless request staying alive. Not built yet.
* Supabase: apply migrations, create a Storage bucket `ciphertext` (private), keep the service-role key server-side only.
