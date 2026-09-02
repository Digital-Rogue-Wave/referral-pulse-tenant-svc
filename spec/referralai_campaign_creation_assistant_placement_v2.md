# Campaign Creation Assistant — Service Placement

**Version:** 2.0 · supersedes v1.0
**Status:** Draft for review
**Last Updated:** June 2026
**Scope:** Where the assistant's prompts, questions, derivations, profiles, and generated configs live
**Companion:** Creation Assistant — Interview Script v2.0 · System Architecture v1.3 (§4, §14) · Product Spec v4.3 (§21) · Responsibility Contract v3.0 · DB Model per Service (§11)

> **Scope of this document.** This is a placement decision, not an API reference. It fixes which service owns each moving part of the Campaign Creation Assistant — the conversational chatbot that interviews an operator and produces candidate campaign configurations. It deliberately avoids endpoint paths, request shapes, and field-level schemas; those belong in the API Contract and the assistant's behavioural spec. It assumes the established AI discipline: *the AI service reasons and proposes; owning services decide and persist.*

### The Question

Should the assistant's **questions**, its **prompts**, and the **three campaign configurations** it generates (Baseline / Balanced / Aggressive) live in the AI service?

### Verdict

Yes for the first two, and yes for the *generation logic* of the third — but with one hard line. Prompts, conversational questions, and the profile *posture* are all reasoning behaviour and belong in `ai-service` / `ai_db` alongside every other agent. The three generated configs, however, are **recommendation artifacts**, not campaign configs. They live in `ai_db` only as proposals. The authoritative Campaign, Variants, Segments, and Reward configs are owned by the Campaign service and are materialised there — and only there — when an operator accepts. The AI service must never become the system of record for a campaign.

---

## 1. Ownership Boundary

### What the AI Service Owns

The AI service is already the single home for all LLM logic — for cost control, auditability, model management, and the operational simplicity of one log stream for a two-engineer team. The Campaign Creation Assistant introduces a *new agent type*, nothing structurally new. Three things sit naturally inside it:

- **Prompts.** The assistant's system prompts are versioned records, exactly like every other agent — one active version per agent type, captured as a `PromptVersion` in `ai_db`, referenced by every decision log so any output traces back to the prompt that produced it.
- **Questions.** The conversational questions the assistant asks across its phases are agent behaviour. They are emitted by the agent at invocation time and carry no state of their own.
- **Profile posture.** Baseline, Balanced, and Aggressive are generation *postures* — a bias applied during reasoning, not stored configuration. The meaning of "Aggressive" is reasoning logic, and reasoning logic lives where all reasoning lives.

### What It Derives

The assistant earns its value by asking little and computing much. The interview sorts every input into *ask*, *infer-and-confirm*, and *derive* — and the derive work is reasoning, so it too lives in the AI service. Using read-only tools over analytics and propensity data, the agent computes the inputs an operator should never be asked for: the CAC/payback ceiling that caps every reward, the saturation pacing that decides which postures a given base size can even sustain, best-referrer targeting from trust tiers and propensity scores, and the give-get framing and hold/clawback defaults that fit the chosen pulse. These derivations are reads — they inform the proposals and never mutate any owning service. They are the substance of "the AI reasons," and they belong beside the prompts, not in `campaign_db`.

### What It Must Not Own

The configs the assistant hands back are proposals. Each candidate is stored as a `Recommendation` in `ai_db` with an accept/reject outcome — the same shape the Campaign Setup Agent already uses. That record is transient by intent: it is the AI's *suggestion*, captured for audit and for the operator to act on. It is not a Campaign. The moment the assistant tried to hold the authoritative campaign definition, the platform would have two systems of record for the same object, and the advisory discipline that keeps AI reversible would be broken.

> **The discipline that already governs this.** The existing Campaign Setup Agent returns a structured proposal and *cannot* activate, commit, or approve a budget; the chosen config is applied by the Campaign service through its own API on operator accept. The Creation Assistant inherits that contract unchanged. It proposes three; the operator picks one; Campaign materialises it. **AI proposes — Campaign owns.**

### Proposes vs Owns

```
ai-service · ai_db                          campaign-service · campaign_db
ADVISORY — PROPOSES ONLY                    SYSTEM OF RECORD
  - Prompts (PromptVersion)                   - Campaign
  - Conversational questions                  - Variants (incl. default)
  - Profile posture (Base/Bal/Aggr)           - Segment references
  - Conversation state (answers, phase)       - Reward configs
  - Derived inputs (CAC, saturation,          - State machine · budget
    targeting, hold/clawback)
  - 3 candidate proposals (Recommendation,
    transient, accept/reject)
             │                                            ▲
             │ render 3                                   │ materialise via Campaign API
             ▼                                            │
                       Operator — selects one, accepts
```

---

## 2. The Three Profiles

### Profiles as Posture, Not Records

Baseline, Balanced, and Aggressive are not three stored templates. They are three *reasoning postures* the same agent adopts over the same gathered answers, biasing how it sizes rewards, how broadly it targets, and how hard it leans on the budget. Treating them as posture rather than as persisted config is what keeps them inside the AI service cleanly: a posture is a prompt-and-parameter framing, fully versioned with the agent, and it produces three `Recommendation` candidates in a single reasoning pass. Nothing about a profile lives in `campaign_db` until the operator picks one and that one candidate is materialised. Each posture reasons over the full input set — what was asked, what was inferred-and-confirmed, and what was derived — and is bounded by the derived ceilings: no posture may exceed the CAC/payback cap, and Aggressive is only offered when the eligible base is large enough to sustain it without saturating.

### Posture Matrix

The postures differ along the levers the operator most cares about. The table states intent; the exact numeric framing is a prompt concern, tuned in the agent's versioned template.

| Lever | Baseline | Balanced | Aggressive |
|---|---|---|---|
| **Reward sizing** | Conservative, near vertical floor | Mid-range, benchmark-aligned | High, leaning into upside |
| **Segment breadth** | Narrow, proven audiences | Moderate, a few targeted variants | Broad, default-variant-forward reach |
| **Budget posture** | Cautious, slow burn | Steady, planned spend | Front-loaded, growth-first |
| **Best for** | Cost discipline, first programs | Default recommendation | Acquisition pushes, seeding |

> **Generation gate still applies.** Whatever posture is in play, each candidate must satisfy the Pulse×Reward compatibility matrix as a hard generation gate — an incompatible pairing is never emitted, not flagged after the fact. Posture changes *how aggressive* a config is, never *whether it is valid*.

---

## 3. Conversation Model

### Stateless, Single-Turn — and What That Forces

The platform's agents are invoked, not continuously running: single-turn, stateless per invocation, bounded to five tool calls, with any state between invocations reconstructed from `ai_db`. A multi-phase *chat* does not fit a single invocation. So the assistant is not one long-lived conversation — it is a **sequence of persisted single-turn calls**.

Each turn reads the accumulated answers and current phase from `ai_db`, replays them into a fresh stateless invocation, emits either the next question or — on the final phase — the three proposals, then persists the updated state back. The questions are produced by the agent; the answers-so-far are **conversation state in `ai_db`**, never agent memory. This is the single most important structural consequence of the placement decision: the chat feels continuous to the operator, but every turn is independent and reconstructable.

### The Persisted Loop

```
        ┌──────────────────────────────────────────────┐
        │                                              │
        ▼                                              │ persist updated
ai_db: conversation state                              │ state → next turn
  (answers · phase · prompt ver.)                      │
        │ replay into invocation                       │
        ▼                                              │
Single-turn agent (stateless, ≤5 tool calls)           │
        │ emit                                          │
        ├──▶ Next question (phases 1–3) → operator ─────┘
        └──▶ 3 proposals (final phase) → handoff
```

---

## 4. Handoff to Campaign

The boundary at the end of the conversation is the same one the Campaign Setup Agent already respects. When the operator selects one of the three proposals, the AI service does not write the campaign. The selection is applied by the **Campaign service through its own API**: the Campaign, its Variants (including the auto-created default), the referenced Segments, and the Reward configs are created in `campaign_db` as first-class records, subject to the campaign state machine, budget controls, and the compatibility gate. The `Recommendation` in `ai_db` is marked accepted and retained for audit — it records *what the AI suggested and that a human took it*, which is exactly the explainability the AI service exists to preserve. The rejected two are retained as rejected.

> **Why the split holds under load.** Because the authoritative config never lived in `ai_db`, regenerating, re-running, or discarding a conversation has zero blast radius on real campaigns. A proposal is cheap and disposable; a Campaign is governed. Keeping them in different services is what makes that true by construction.

---

## 5. Boundaries

Stated as hard rules, in the contract style used across the platform's responsibility documents.

**The AI service MUST**
- Hold the assistant's prompts as versioned `PromptVersion` records, one active version per agent type.
- Emit conversational questions from the agent at invocation time, and persist all gathered answers and the current phase as conversation state in `ai_db`.
- Reconstruct full conversation state from `ai_db` on every turn, treating each turn as an independent stateless invocation.
- Store the three generated configs as `Recommendation` records with accept/reject outcomes, and reference the prompt version that produced them.
- Compute derived inputs (CAC/payback ceiling, saturation pacing, best-referrer targeting, hold/clawback defaults) from read-only analytics and propensity tools, using them to shape proposals only — never to mutate an owning service.
- Enforce the Pulse×Reward compatibility matrix as a generation gate before any candidate is emitted.

**The AI service MUST NOT**
- Become the system of record for any Campaign, Variant, Segment, or Reward config.
- Activate, commit, approve a budget, or otherwise mutate campaign state — it holds no write tool over Campaign.
- Hold conversation state in agent memory across turns, or assume continuity between invocations.
- Treat a profile as a stored template; posture is reasoning framing, not a persisted record.

**The Campaign service SHOULD**
- Materialise the selected proposal as authoritative records through its own API on operator accept, subject to the state machine, budget controls, and compatibility gate.
- Remain the sole owner of campaign configuration, unaware of the proposals it was not given.

**The operator**
- Reviews all three proposals, selects at most one, and is the only path to a real campaign. No proposal becomes a campaign without an explicit human accept.
