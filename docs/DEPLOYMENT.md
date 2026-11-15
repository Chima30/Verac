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
Then put the printed addresses in `.env` (`CONTRACT_TREASURY_VAULT`, ...). The Integrations page shows them as
"ADDRESS SET, UNVERIFIED" until a chain read confirms code exists there.
Deploy needs an **unscoped** EVM window (contract creation is refused under a scoped window); close it afterwards.
Window opening is a hybrid-signed native message and is not implemented in this repo yet.
The `paris` EVM target is untested on Diana; a failed deploy may mean a different hardfork is needed.

## Web + worker

* Vercel: Next.js app and short API routes (not built yet).
* Worker (long-running agents, schedules): a small Node service on Fly.io/Railway/a VM, or Cloudflare Workers Cron for light jobs.
  Do not rely on a serverless request staying alive. Not built yet.
* Supabase: apply migrations, create a Storage bucket `ciphertext` (private), keep the service-role key server-side only.

## Deploying the web app to Vercel (read-only build)

The app has no secrets to deploy: pages read public chain data and the AI provider key is optional.
Do **not** set `GEMINI_API_KEY` on a public deployment until per-user auth exists, or anyone can spend your free quota.

1. `npx vercel login` (browser sign-in, done by you).
2. From the repo root: `npx vercel link`, then in the Vercel project settings set **Root Directory = `apps/web`**
   (keep "Include source files outside of the Root Directory" on; the workspace packages live outside it).
3. Optional env vars: `NEXT_PUBLIC_PRODUCT_NAME`, and the three `CONTRACT_*` addresses from `deployments/diana-testnet.json`.
4. `npx vercel --prod`.
`.vercelignore` keeps `.secrets/`, `.env*` and contract build output out of the upload.

## Turning on live testnet execution (off by default)

Live execution lets the website send real **testnet** payments through the TreasuryVault. Read
[SECURITY.md](SECURITY.md#server-managed-signing-testnet-only) first: it is a development signing path, not production custody.

1. Apply `supabase/migrations/0014_live_execution.sql` in the Supabase SQL editor ("Success. No rows returned" is the normal result).
   It is not part of `supabase/APPLY_0004_to_0013.sql`.
2. In Vercel, add these as **Sensitive** variables (tick **Preview** as well as Production if you test on a branch deployment):

   | Name | Secret | Meaning |
   |---|---|---|
   | `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-only database key |
   | `AGENT_EVM_PRIVATE_KEY`, `AGENT_MLDSA_PUBLIC_KEY`, `AGENT_MLDSA_SECRET_KEY` | yes | Agent account (pays) |
   | `APPROVER_EVM_PRIVATE_KEY`, `APPROVER_MLDSA_PUBLIC_KEY`, `APPROVER_MLDSA_SECRET_KEY` | yes | A different account (relays approvals) |
   | `LIVE_AGENT_ADDRESS` | no | Safety check on the agent key |
   | `LIVE_REQUIRED_ADMIN_APPROVALS` | no | 1 or 2 administrators per payment |
   | `LIVE_EXECUTION_ENABLED` | no | Set to exactly `true` to allow sending. Leave unset otherwise |
   | `LIVE_EMERGENCY_STOP` | no | `true` stops everything |

   Also needed (already set for the read-only site): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. On chain, the owner must have given the agent limits and registered the approver (see
   [LIVE_SETUP_2026-11-15.md](LIVE_SETUP_2026-11-15.md); `packages/qorechain/scripts/owner-ops.ts` does both and is a dry run unless you add `--broadcast`).
4. Redeploy. The Treasury page's **Live payments** card lists any variable that is still missing. Branch deployments are behind Vercel's own login.
5. Nothing is sent until someone requests a payment, a different administrator approves it with their password, and someone presses Execute.
