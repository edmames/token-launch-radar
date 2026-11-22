# token-launch-radar (radar-4.1)

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/edmames/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/edmames/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A deterministic valuation and execution radar (`radar-4.1`) for pre-token DeFi protocols. It scores and ranks 200 pre-token candidates (100% of the 40/40 $50M+ watchlist plus 160 early-stage protocols) derived strictly from snapshot telemetry with zero hardcoded protocol names or heuristic manual overrides. Live tokens (24 protocols) are isolated to an independent peer calibration panel.

---

## 3-Stage Architecture

### Stage A: Huber Power-Law & Macro-Group Empirical Bayes Valuation
- **Power-Law Core**: Models circulating market cap as a function of protocol scale via Huber robust regression ($\delta = 1.35$, $L_2$ shrinkage $\lambda$ tuned via 5-fold CV):
  $$\hat{y} = \beta_0 + \beta_1 \ln(\text{TVL}) + \sum_{j \in \text{kept}} \beta_j x_j + \alpha_{g(\text{category})}$$
- **Macro-Group Empirical Bayes**: Protocol categories map deterministically to 4 macro-clusters (*Trading*, *Credit*, *Vaults*, *Infra*). Category offsets $\alpha_g$ shrink toward the macro prior with adaptive shrinkage $m_{\text{shr}} \in [5, \infty]$.
- **Conformal Prediction Intervals**: Non-parametric split conformal calibration on 93 matched live peers constructs valid $P_{10}$, $P_{50}$ (median-unbiased), and $P_{90}$ intervals:
  $$V_{50} = \exp(\hat{y} + \text{med}_r), \quad V_{10} = \exp(\hat{y} + s \cdot q_{10}), \quad V_{90} = \exp(\hat{y} + s \cdot q_{90})$$

### Stage B: Exposure-Adjusted Cure Rate & Structural Launch Probability
- **Exposure Cure MLE**: Formulates token launch probability through an exposure-adjusted cure model ($w_0, \tau, m$):
  $$P(\text{Launch} \mid \text{age}) = p_{0,\text{asym}} \cdot \left( w_0 + (1 - w_0) \cdot \left[1 - \left(1 + \frac{\text{age}}{\tau}\right)^{-m}\right] \right)$$
- **Empirical Service Gate ($D_{\text{service}}$)**: Quantifies structural demotion for pure infrastructure, tooling, and B2B curator entities that capture value via fee extraction rather than governance token emission.
- **Structural Qualification Gates**: Automatically identifies and filters live-token sub-products, non-issuing architectures, and stale zero-momentum entities ($P_{\text{launch}} < 0.25 \to \text{SKIP}$).

### Stage C: Costed Farm ROI Engine & Execution Playbooks
- **Costed Net Cash EV**: Evaluates farming efficiency by penalizing hard execution costs (bridge fees + multi-tx gas) and illiquidity slippage against expected airdrop cash value:
  $$\text{Implied} = \max(1, \text{round}(P_{\text{launch}} \times V_{50}))$$
  $$\text{Gross Hold} = \frac{\text{Implied} \times \alpha_{\text{circ}}}{\text{TVL}} \times \frac{\text{hold\_days}}{180}$$
  $$\text{Net Cash EV}_{10\text{k}} = \$10,000 \times (\text{Gross Hold} - \text{slippage}) - C_{\text{hard}}$$
- **Nearest Live Comps ($k=3$)**: Queries 93 snapshot live peers by category hierarchy, multichain footprint, and TVL proximity metric $d$.
- **Chain-Aware Playbooks**: 5-step concrete execution directives routing capital to optimal fee rails (L2s/Alt-L1s vs Ethereum Mainnet) with explicit capital floors ($K_{\text{min}}$) and cadence triggers.

---

## Running the Pipeline

Execute the end-to-end pipeline using Node 22 (native erasable TypeScript, zero external dependencies):

```sh
node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json --output out
```

Or with environment variable configuration:

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

The pipeline writes:
- `out/board.json`: 200 ranked pre-token protocols with full ROI, comp metrics, and farm steps.
- `out/data.js`: Compact client-side data script packed to `< 65KB`.
- `out/dashboard/`: Self-contained vanilla HTML/CSS/JS dashboard.
- `out/screenshots/`: Verification screenshots.
- `out/dossier.json`: Final verified submission dossier.

---

## Verification & Oracle Checks

Run the official deterministic scoring harnesses:

```sh
# 1. Verify model stage A & B metrics, rankings, and structural gates
python3 ../verify-r41.py out/board.json

# 2. Verify costed ROI engine, nearest comps parity, and farm step text
python3 ../verify-r41-roi.py out/board.json
```

---

## Honest Modeling Assumptions & Boundaries

1. **Airdrop Circulating Allocation ($\alpha_{\text{circ}}$)**:
   The model assumes an airdrop pool allocation of 20% to 25% of initial circulating market capitalization depending on category blueprint (25% for derivatives/prediction markets; 22% for dexs/chains; 20% for credit/vaults). This is an explicit modeling assumption, not ground-truth snapshot data.
2. **Log-Market Cap Irreducible Variance**:
   Cross-validation on 93 matched live peers yields an RMSLE of $\approx 1.25$ and log-MAE of $\approx 0.95$. Monotonic power-law scaling accounts for broad market tiers, but individual token performance carries substantial idiosyncratic variance.
3. **Conformal Empirical Coverage**:
   Reported prediction intervals ($P_{10} - P_{90}$) achieve nominal $80\%$ coverage under leave-one-out cross-validation on snapshot live tokens, accounting for heteroskedastic group variances.
4. **Zero Protocol Hardcoding**:
   All classifications, probability discounts, and ROI projections stem entirely from snapshot features without manual overrides or custom protocol whitelist logic.

---

<sub>Entered on [make.fun](https://make.fun/?ref=1smxb5y7&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
