# Campaign Creation Assistant — Interview Script

**Version:** 2.0 · supersedes v1.0
**Status:** Draft for review
**Last Updated:** June 2026
**Precondition:** the client's website is already scraped — vertical, pricing tiers, value props, social proof, brand assets known
**Companion:** Creation Assistant — Service Placement v2.0 · Product Spec v4.3 (§16 Pulse Workflows, §21 AI/Health) · Failure & Observability v3.0 (§3.4) · Responsibility Contract v3.0

> **What changed from v1.** v1 listed three pulses; the platform has **nine**, each with its own enrollment trigger and safety profile — so Phase 1 now maps a goal across all nine and *derives* the trigger. v1 also missed the inputs that actually separate a great campaign from a merely valid one: audience saturation, measurability, the hold/clawback quality bar, optimization latitude, and the advocacy signal. v2 folds those in and re-sorts every input into **ask / infer-and-confirm / derive**, so the assistant asks as little as possible.

## Purpose & Stance

The assistant interviews an operator and produces three candidate campaign configurations (Baseline / Balanced / Aggressive) for review. Its value is **not** a thorough questionnaire — it is the opposite. A great campaign needs many inputs, but a great *assistant* obtains most of them without asking: from the scrape, from vertical benchmarks, and from analytics the platform already holds. Every input below is tagged by how it is obtained, and the design goal is to move as much as possible out of `[ASK]`.

## Model Portability

This runs on the primary model, a verification model, or a fallback, chosen by configuration — Claude and ChatGPT among them. The script must execute identically regardless. Every decision a model might otherwise improvise — which pulse a goal maps to, what to skip, what to derive, when to block — is fixed below, so the interview is reproducible across providers.

---

## 0. Operating Rules

### The Three Buckets

Every input falls into exactly one bucket. The bucket, not the model's discretion, decides whether a turn is spent on it.

| Bucket | Meaning | Cost to operator |
|---|---|---|
| `[ASK]` | Only the client knows it; no scrape or benchmark supplies it. A real question. | One turn each — keep short |
| `[INFER+CONFIRM]` | Scrape or benchmark supplies a strong value; assistant states it, operator corrects. | A glance, not a question |
| `[DERIVE]` | Computed by the assistant from other inputs + platform analytics. Never a question. | Zero — shown only in proposals |
| `[GATE]` | A special `[ASK]` that can **block** rather than fall to a default. | One turn; non-negotiable |

**Rules**

1. **Minimize asks.** If a value can be inferred or derived, never ask it. Asking something the scrape already answers is a defect, not thoroughness.
2. **Confirm, don't ask.** For any inferred fact, state it in one line and let the operator correct. Record as *inferred* so override is always possible.
3. **One thing per turn.** The chat is a sequence of persisted single-turn calls; running answers are replayed from conversation state each turn, never held in memory.
4. **Never invent.** Inference works off scrape/benchmarks; derivation off real inputs. If neither exists, it is an `[ASK]` — list price is never a stand-in for customer value.
5. **Pulse×Reward gate.** Once the pulse is set, only reward forms valid for that pulse are offered or proposed.
6. **Enrollment-trigger safety.** The trigger is derived from the pulse, never chosen freely; payout is never a trigger.
7. **Lawful basis can block** — the one input allowed to stop a campaign rather than default.

### Input Funnel

```
[ASK]  ~11 inputs ─────────┐
                           │
[INFER+CONFIRM]  scrape ───┼──▶  Reasoning pass  ──▶  3 proposals
   + benchmarks            │     (posture × 3)        (Recommendation)
                           │
[DERIVE]  analytics ───────┘
   propensity · formulas
```

Most inputs never become questions.

### The Whole Ask List

The complete set of things the assistant actually asks. If it grows past this, an input has been mis-bucketed.

1. **Primary outcome** — what the program is for (maps to a pulse).
2. **Existing advocacy & the value moment** — are customers already recommending you, and when do they first "get it"?
3. **Customer value** — typical first payment / monthly value and rough margin.
4. **Optimization latitude** — how much may the platform auto-tune rewards without sign-off?
5. **Eligible base — who & roughly how many** (the saturation input).
6. **One offer or segmented** (+ the splitting attribute, if segmented).
7. **Success target** — what "working" looks like in a number.
8. **Abuse tolerance** — how strict the quality bar should be.
9. **Budget** — total or per period.
10. **Schedule** — start, and end date if any.
11. `[GATE]` **Lawful basis** — markets + basis to market referrals.

Several collapse further when scrape/benchmarks are strong — schedule and success target are often inferred and merely confirmed. Eleven is the ceiling, not the target.

### Per-Input Logic (identical on every model)

```
Next input ──▶ Which bucket?
                 ├─ infer  ──▶ confirm in one line ──┐
                 ├─ derive ──▶ compute silently ─────┼──▶ apply gates + save to
                 └─ ask    ──▶ one single-turn Q ─────┘    conversation state (ai_db)
```

---

## Phase 1 — Goal, Pulse & Trigger

**Sets:** which of the nine pulses runs, its enrollment trigger, and whether referral is even the right lever. This is the spine — every downstream input bends to it.

| How | Input / question | Drives |
|---|---|---|
| `[ASK]` | "What's the main outcome — more paying customers, retention, winning back churned users, expanding existing customers, leads, reviews, or taking share from a competitor?" | Maps to one of the nine pulses (table below) |
| `[ASK]` | "Are customers already recommending you unprompted — and what's the moment they first see the value?" | Whether referral will work at all; the sharing-moment timing |
| `[INFER+CONFIRM]` | Vertical → playbook → default pulse & reward structure (e.g. B2B SaaS → SaaS Growth → Conversion, % of first-year). | Pulse prior, reward-structure prior |
| `[DERIVE]` | Enrollment trigger, from the pulse's allowed set and the two safety tests — (a) downstream payout floor, (b) cheap-if-wrong entry. Payout is never a trigger. | `signup` / `on_self_conversion` / `manual` |
| `[DERIVE]` | The sharing moment — placed at the value moment the operator described, not a generic email blast. | When the invite is surfaced |
| `[INFER+CONFIRM]` | "One-off push or always-on?" — usually inferable from outcome; confirm. | Fixed window vs ongoing |

### Nine-Pulse Map

Deterministic mapping from a stated outcome to a pulse, default trigger, and reward shape. The assistant picks from this table — it does not invent a mechanic.

| Client says… | Pulse | Default trigger | Typical reward |
|---|---|---|---|
| More paying customers / revenue | **Conversion** | `signup` | % of first payment or first-year |
| Keep customers renewing (retention) | **Renewal** | `manual` | Recurring commission, N cycles capped |
| Win back churned users | **Reactivation** | `signup` | Fixed bonus + small recurring |
| Expand customers to another product | **Cross-Sell** | `on_self_conversion` | % of new-product value |
| Leads / signups / list growth | **Signup** | `manual` | Fixed per signup, often one-sided |
| Reviews / social proof | **Feedback** | `manual` | Small / gift card; on verified review |
| Newsletter / content audience | **Newsletter** | `manual` | Micro-reward or milestone |
| Take a competitor's customers | **Switch-Up** | `on_self_conversion` (verified) | High bounty — verify before opening link |
| Drive activation / onboarding | **Product Education** | `on_self_conversion` | Milestone unlock / credit, rarely cash |

> **Why the trigger is derived, not asked.** The enrollment trigger is intrinsic to the pulse's fraud profile. Enrolling at `signup` and showing the widget immediately is safe only when a downstream payout floor contains the risk *and* entry is cheap-if-wrong. Pulses that fail those tests (Signup, Newsletter, Switch-Up) default to `manual` or require verification first. Financial risk after early enrollment is managed by *reward holds*, never by asking the operator to pick a trigger.

---

## Phase 2 — Economics & Reward

**Sets:** the reward configuration and the headroom the three profiles spread across. Reward forms are constrained by the Pulse×Reward gate.

| How | Input / question | Drives |
|---|---|---|
| `[ASK]` | "Roughly what is one new customer worth — typical first payment or monthly value, and a rough margin?" | Reward sizing without eroding unit economics. **Never inferred from list price.** |
| `[ASK]` | "How much can the platform adjust rewards on its own before it needs your sign-off?" | Optimization latitude — the `auto_approve_below` bound for Incentive Optimization |
| `[INFER+CONFIRM]` | Pricing tiers from the scrape → candidate reward range; category reward norms from benchmarks. | Reward range, anchoring |
| `[DERIVE]` | CAC / payback ceiling — the reward must stay cheaper than paid acquisition for the vertical; expansion revenue widens the ceiling. | Hard upper bound on reward |
| `[DERIVE]` | Give-get framing (one-sided vs two-sided) and best-fit reward form for the audience — cash, credit, discount — within the gate. | Reward structure & form |

> Margin is not the ceiling — **CAC payback is**. A great campaign pays a reward that still beats paid acquisition, which is exactly the Revenue Impact sub-score the platform tracks. Sizing to margin alone underprices the reward and leaves growth unclaimed.

---

## Phase 3 — Audience & Saturation

**Sets:** who refers, how many variants, and — new in v2 — whether the eligible pool is large enough to sustain the chosen posture before it saturates.

| How | Input / question | Drives |
|---|---|---|
| `[ASK]` | "Who's allowed to refer — all customers, paying only, a specific plan, a list you'll provide — and roughly how many is that?" | Eligible enrollment population *and its size* (enrollment is selective and backend-owned) |
| `[ASK]` | "Same offer for everyone, or different rewards for different groups?" | Single default variant vs segmented variants |
| `[DERIVE]` | Best-referrer targeting — trust tiers and propensity scores surface who is likely to advocate, so targeting need not be asked. | Who the campaign leans on |
| `[DERIVE]` | Saturation pacing — base size × window predicts how fast the pool exhausts, which postures are viable, and whether always-on beats a one-off push. | Profile viability; pacing |
| `[INFER+CONFIRM]` | (If segmented) the splitting attribute and whether it's reliably known at enrollment. | Segment key vs analytics dimension |

> **Saturation is a first-class signal.** Audience Saturation is one of the four Program Health sub-scores ("% of eligible base enrolled & still converting"). A 400-customer base cannot sustain an Aggressive always-on program; a 50,000 base can. So base size co-decides which of the three profiles is even offered. Missing or non-matching segment attributes fall through to the default variant — they never block.

---

## Phase 4 — Measurability, Quality Bar, Budget & Compliance

**Sets:** whether the campaign can be measured, how abuse is contained, the budget, the schedule, and the lawful-basis gate.

| How | Input / question | Drives |
|---|---|---|
| `[INFER+CONFIRM]` | Likely sharing mechanics (link vs code, same-device vs cross-device) → expected attribution method & coverage. Set honest expectations up front. | Measurability; realistic targets |
| `[ASK]` | "What would make this a success — a number you'd want to hit?" | Target the three profiles aim at (often inferable from benchmarks, then confirm) |
| `[ASK]` | "How strict should the quality bar be — how long must a referral stick before you'll pay?" | Abuse tolerance |
| `[DERIVE]` | Hold window + clawback policy from the abuse answer and pulse — refunds/chargebacks during the hold reverse the reward; the quality bar in mechanism form. | Reward lifecycle holds; Fraud Pressure exposure |
| `[ASK]` | "Total budget — overall, or per period?" | Shared budget; auto-pauses at 100% |
| `[ASK]` | "When should it start, and is there an end date?" | Schedule / campaign state machine |
| `[GATE]` | "Which markets, and do you already have a lawful basis to market referrals to your customers and their referees?" | **Can block.** In the EU this basis is separate from product signup |

> **Measurability is an input, not a given.** The platform grades every campaign on attribution confidence and touch / attribution / revenue coverage. If sharing will be cross-device or key pages lack the SDK, coverage drops — so the reward model and success target must be set against what can actually be observed, and the operator is told so plainly rather than promised a clean number.

---

## From Inputs to Three Proposals

Once the gate clears, the same gathered, inferred, and derived inputs are run through three postures in one reasoning pass. The new v2 inputs change what each posture is even allowed to propose.

| Posture | Leans on | Bias — bounded by the derived ceilings |
|---|---|---|
| **Baseline** | Customer value, budget, saturation floor | Conservative — rewards near the vertical floor, proven advocates only, slow burn |
| **Balanced** | Benchmarks, CAC payback | Benchmark-aligned — the default recommendation |
| **Aggressive** | CAC headroom, base size, expansion revenue | Growth-first — higher rewards, broader reach, front-loaded spend, *only offered if the base can sustain it* |

> All three are candidate proposals only. Each must pass the Pulse×Reward gate and sit under the derived CAC ceiling; the operator selects at most one; the Campaign service materialises the chosen one. Posture changes how aggressive a config is — never whether it is valid, measurable, or affordable.
