# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: a DAO's finance team, meaning finance managers who request and prepare payments and administrators who review,
approve and execute them, working daily at a desk and sometimes checking approvals on a phone. Secondary, confirmed by
roles in the product: grant applicants and vendors who submit applications, bids and milestone evidence, and auditors who
read records. Hackathon judges see the same real product; pages are not tuned for them separately.

## Product Purpose

Verac lets AI agents do a DAO's treasury work (checking invoices, investigating grant applications, verifying milestones,
preparing payments) without unrestricted access to its funds. Success is a request that moves from instruction to an
approved, on-chain payment with every check and decision recorded, and nothing paid that people did not approve.

## Positioning

AI agents investigate and prepare; people decide with keys the server never sees; QoreChain enforces the limits.
On TreasuryVault V2, payments need two administrators' ML-DSA-87 signatures made on their own devices and verified on chain.

## Operating Context

QoreChain Diana testnet (EVM chain 9800), testnet QOR only. Workflows: the six-agent invoice review, grant rounds
(applications, multi-agent investigation, recommend, award by a second administrator, milestone funding), approvals and
execution, Live Proof of on-chain evidence. Administrators sign V2 requests with a command-line tool on their own computer.
Modules not driven by agents and without live proof are grouped as Labs.

## Capabilities and Constraints

- Next.js app on Vercel, Supabase with row-level security; amounts are base-unit integers shown in QOR.
- Status wording is a product rule: LIVE TESTNET, SIMULATION, PENDING, REQUIRES APPROVAL, FAILED, UNAVAILABLE. Nothing is
  labelled live unless it was read from or ran on the chain.
- Light, dark and system themes. Roles: owner, administrator, finance manager, procurement manager, security reviewer,
  auditor, vendor, grant applicant.

## Evidence on Hand

Real on-chain records in `docs/` and `deployments/` (website payment 15 Nov, workflow payment 16 Nov, category proofs,
Q-Day drill proof, V2 live run with refused attacks, administrator key replacement). No customers, testimonials or
metrics exist; none may be invented.

## Product Principles

1. Money moves only through people and the chain, never because an AI said so; the interface must make that visible.
2. Every claim on screen is traceable: on-chain facts link to the chain, AI output is labelled as AI, rules as rules.
3. Show the real state, including failures, holds and what is not yet possible.
4. Daily operators come first: the next decision should be obvious on every page.

## Accessibility & Inclusion

WCAG 2.1 AA: readable contrast in both themes, full keyboard use, screen-reader labels, usable at 200% zoom and on phones.
