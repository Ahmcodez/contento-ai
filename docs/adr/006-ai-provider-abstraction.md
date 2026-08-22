# ADR-006: AIProvider interface abstraction, Gemini as first implementation

## Decision
Define a provider-agnostic `AIProvider` interface (`docs/AI.md`) in
`packages/ai`, with Gemini as the sole implementation in V1, and ensure no
code outside `packages/ai` ever imports a Gemini-specific type.

## Alternatives considered
1. **Call the Gemini SDK directly from business logic** (worker
   processors, services) wherever AI is needed.
2. **AIProvider interface with Gemini adapter** (chosen).
3. **A generic third-party LLM abstraction library** (e.g. LangChain) as
   the abstraction layer instead of a hand-rolled interface.

## Reasoning
- The brief explicitly requires this: "Create an abstraction around AI
  providers so another provider can be added later without rewriting the
  application" and "Do not tightly couple business logic directly to a
  specific Gemini SDK." Option 1 directly violates this.
- A hand-rolled interface (option 2) is intentionally narrow — exactly the
  four methods the domain needs (`docs/AI.md` §2) — versus adopting a
  general-purpose framework (option 3) whose abstractions are broader than
  this application needs and which becomes its own dependency/lock-in risk
  (swapping LangChain itself is its own migration). A small,
  purpose-built interface is easier to reason about, test (trivial to
  mock), and keep in sync with actual usage than adopting a large
  framework for four methods.
- Structured-output validation (`docs/AI.md` §5) is treated as a first-
  class part of the interface, not an afterthought, because it's the
  mechanism that keeps AI output from silently corrupting deterministic
  business logic downstream (`docs/AI.md` §1, §4).

## Tradeoffs
- Hand-rolling means we own maintenance of the abstraction (retry
  classification, schema validation glue) rather than getting it from a
  framework — judged worth it for the reduced surface area and avoided
  lock-in to a second, framework-level dependency.
- Provider-specific capabilities that don't fit the common interface
  (e.g. a Gemini-only feature) require either extending the interface
  (affecting all providers) or a documented provider-specific escape
  hatch — a real design tension to manage carefully as providers are
  added, flagged here rather than glossed over.
