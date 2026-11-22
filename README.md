# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/edmames/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/edmames/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar (`radar-3-neon`): it ranks 200 pre-token DeFi protocols by the implied value of their future token launch using a 100% snapshot-derived, two-stage conditional-FDV valuation model with zero hardcoded protocol names. Category multiples are shrunk via Empirical Bayes toward actual valuation multiples from 128 live-token peers in the snapshot, paired with sub-linear size damping, dollar-flow-weighted 7d momentum, inverted-U TGE-window age curves, multi-chain footprint scoring, and a deterministic structural launch-probability filter. Every protocol features a chain-aware execution playbook naming concrete gas, capital requirements, and timing. The result is a self-contained, no-network dashboard: sortable radar board, detail drawer with exact 6-factor model decomposition, and isolated live-token peer reference.

## Methodology (radar-3-neon)

- **Two-Stage Conditional Valuation**:
  $$\text{Cond\_FDV} = \text{TVL} \times M_{\text{cat}} \times S(\text{TVL}) \times G(g_{7\text{d}}, \text{TVL}) \times A(\text{age}) \times C(\text{chains})$$
  $$\text{Implied\_Value\_USD} = \max(1, \text{round}(P_{\text{launch}} \times \text{Cond\_FDV}))$$
- **Empirical Bayes Multiples ($M_{\text{cat}}$)**: Category multiples are calibrated against 128 live-token protocols in the snapshot ($M_{\text{cap}} > 0$ and $\text{TVL} \ge \$1\text{M}$), shrinking toward category priors with weight $k=5$.
- **Size Damping ($S$)**: Sub-linear exponent $-0.18$, clipped to $[0.50, 1.35]$ relative to a $\$50\text{M}$ baseline.
- **Dollar-Flow Momentum ($G$)**: Blends percentage growth velocity with dollar-flow volume ($\Delta 7\text{d}$).
- **Age Window ($A$)**: Inverted-U curve peaking in the 180–540 day sweet spot, discounting nascent and stale protocols.
- **Multi-Chain Multiplier ($C$)**: Rewards multi-chain deployment and activity on high-incentive emerging rails.
- **Structural Launch Probability ($P_{\text{launch}}$)**: Fully deterministic composite of category baseline, age decay, chain incentives, parent-token sibling detection, and service-entity keyword rules with zero hardcoded name overrides.
- **Chain-Aware Farm Plans**: Lowest-fee execution chain routing (L2s/Alt-L1s at \$0.02–\$0.15 gas vs Ethereum mainnet at \$4–\$12 gas), explicit minimum capital, weekly cadence, and async exit guards.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=1smxb5y7&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
