# Design decisions

Short architecture decision records. Each one gives the decision, why, and what was traded off.

### 1. The LLM reads; deterministic code decides
The model does perception only: *what does the dial say, is it readable, what defects are visible?* Every
decision (trust, severity, whether a human must look) is made in `packages/core/reconcile.ts`, a pure
function with unit tests. Rules are explainable to operators and auditors, and changing a model can't
silently change the plant's alarm logic.

### 2. Structured output, validated twice
Claude is forced to call a tool with a JSON schema; OpenAI-compatible servers use `response_format: json_schema`
with `strict: true`. The result is still validated with zod (`parseReading`) and lightly normalised (unit aliases,
numeric strings), because we never trust unvalidated model output.

### 3. Self-consistency as the confidence signal
LLMs are poorly calibrated when asked "how confident are you?". Instead we sample N readings (default 3)
and measure how much they disagree relative to the gauge span. Confidence falls with spread, poor image quality
and split readable/unreadable votes. It costs N× tokens, so the eval harness has `--samples` to check the
extra calls are worth it.

### 4. "Refuse, don't guess"
The prompt says to return `readable=false` rather than guess. Unreadable images go to a person. The eval
tracks both *unreadable recall* and *false refusals*, because over-refusal costs reviewer time.

### 5. Known vendor faults are classified, not just "disagree"
Decimal shifts, mislabelled units and missing values are recognised patterns. When the AI is confident they
are logged (useful evidence for the vendor) but don't need review. Genuine disagreements always do.

### 6. Humans confirm high-severity alarms
Even a confident reading that is far outside the operating band gets `confirm_alarm`. A false alarm has a real cost.

### 7. Postgres as the queue
`FOR UPDATE SKIP LOCKED` gives safe multi-worker job claiming without another service, and stale jobs are
reclaimed. Failed jobs retry up to three times. At higher volume, swap to Azure Service Bus behind the same interface.

### 8. Keep the raw evidence
Every model sample, token count and latency is stored in `reading`, so any finding can be audited or replayed
with a different model or threshold.

### 9. Provider adapters, no lock-in
`VisionModel` is a small interface with Anthropic, OpenAI-compatible (Azure OpenAI, vLLM, Ollama) and fake
implementations. Operators who can't send images outside their network can run an open-weight model on their own GPUs.

### 10. MCP tools are read-only and act as the user
The MCP server calls the REST API with the caller's token, so an agent has exactly the user's Entra ID roles.
There are no write tools. Tool outputs are kept compact to save tokens.

### 11. Prompt-injection awareness
Photos can contain text (labels, stickers). The system prompt treats text in images as data, and nothing the
model outputs can trigger an action: it can only populate a validated schema.

### 12. Asset-register context: helpful or anchoring?
Telling the model the expected unit and scale improves accuracy but can anchor it to a stale register entry.
The prompt says to trust the dial over the register, and the eval has `--no-context` to measure the difference.
