# Fees

OpenBroker is non-custodial. Orders are signed in the user's browser by an agent key and sent straight to Hyperliquid (HL). Each order carries a builder code, `builder: { b: <our address>, f: <fee> }`, so HL pays us a platform fee out of the fill.

## Units

`f` is in **tenths of a basis point**.

| `f` | basis points | percent |
|----:|-------------:|--------:|
| 1   | 0.1 bp       | 0.001%  |
| 10  | 1 bp         | 0.01%   |
| 30  | 3 bp         | 0.03%   |
| 50  | 5 bp         | 0.05%   |
| 100 | 10 bp        | 0.10%   |

- 100 is HL's hard maximum for perps (spot allows more, but this app trades perps). `clampBuilderFee` in `src/hyperliquid/config.ts` enforces it.
- Configure it with `VITE_HL_BUILDER_FEE` (default 100).
- The fee is charged on **both sides**: once when a position is opened and again when it is closed. It applies to maker and taker fills alike.

## What the user pays

Total cost per fill = platform fee + Hyperliquid fee.

Hyperliquid base (tier 0) perps rates: taker 0.045%, maker 0.015%. Higher volume tiers pay less, and maker rebates exist at the top tiers. HIP-3 markets (the `xyz:` style builder-deployed markets) can cost more because the deployer sets a fee scale. `src/hyperliquid/fees.ts` accepts per-user rates and a per-market multiplier.

### Worked examples ($1,000 notional)

| scenario | platform | HL | total | bps |
|---|---:|---:|---:|---:|
| taker, f=100 | $1.00 | $0.45 | $1.45 | 14.5 |
| maker, f=100 | $1.00 | $0.15 | $1.15 | 11.5 |
| taker, f=50  | $0.50 | $0.45 | $0.95 | 9.5 |
| taker, f=30  | $0.30 | $0.45 | $0.75 | 7.5 |
| taker, f=100, HIP-3 at 2x HL fee | $1.00 | $0.90 | $1.90 | 19.0 |

Round trip (open taker + close taker, $1,000 each way):

| f | platform | HL | total | price move needed to break even |
|--:|---:|---:|---:|---:|
| 100 | $2.00 | $0.90 | $2.90 | 29 bp |
| 50  | $1.00 | $0.90 | $1.90 | 19 bp |
| 30  | $0.60 | $0.90 | $1.50 | 15 bp |

The order ticket shows this before submission, e.g. `Platform fee 0.10% ($1.00) + Hyperliquid fee ~0.045% ($0.45)`. The `~` marks HL's part as an estimate (tier, rebates, HIP-3 scale).

## Approval (user-facing)

Before trading, the user signs one message (`approveBuilderFee`) saying the most they will pay us per fill. We ask for exactly the configured rate. Nothing moves funds; it only authorises the fee cap. The user can revoke by approving a lower value.

## Pricing guidance (internal)

These are options, not a recommendation to change the configured default. The shipped default stays whatever `VITE_HL_BUILDER_FEE` says.

- HL taker is 0.045%. At f=100 our fee is more than double HL's own, which makes the total roughly 3.2x the bare HL taker cost. Competing front-ends commonly sit in the 0.02% to 0.05% band.
- Starting at 30 to 50 (0.03% to 0.05%) keeps the total under about 1.8x the bare HL cost and is an easier sell to active traders. Ramp toward 100 only if conversion and volume hold.
- Lowering a fee never needs re-approval. Raising it above what a user approved makes that user's orders fail until they re-approve (see `docs/OPERATIONS.md`). So: start low, and treat 100 as a ceiling you may never need.
- Consider a lower fee for maker orders only if retention data shows it matters. The code supports one fee per order, so this would need a change in the order ticket.

## Revenue projections

Revenue = monthly volume x fee rate. Volume counts each fill's notional, so a round trip is two fills.

| monthly volume | f=30 (0.03%) | f=50 (0.05%) | f=100 (0.10%) |
|---:|---:|---:|---:|
| $1M    | $300      | $500      | $1,000    |
| $10M   | $3,000    | $5,000    | $10,000   |
| $100M  | $30,000   | $50,000   | $100,000  |
| $1B    | $300,000  | $500,000  | $1,000,000 |

For scale, a single active builder can see roughly $19M of daily notional and about $10K of daily builder fees on a busy day (observed from HL's public per-fill files for 2026-11-07, about 0.055% average). Treat the table as an upper-bound sketch: real volume depends on distribution, and fees are only accrued on fills that happen through the app.

## Where the money shows up

- HL accrues builder fees to the builder address. `npm run builder:revenue` reads HL's per-fill CSVs, `npm run builder:reconcile` checks them against `builderRewards`, and `npm run builder:claim` claims them. See `docs/OPERATIONS.md`.
