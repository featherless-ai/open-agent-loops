/**
 * Structured reasoning blocks — the richer, pass-through-verbatim counterpart to
 * the flat {@link Message.reasoning} string, preserved for replay across tool
 * calls.
 *
 * @module
 */

/**
 * Provider dialect a {@link ReasoningDetail} block is encoded in.
 *
 * @remarks
 * Carried verbatim and used only to pick the right egress field — never parsed
 * by this library. `anthropic-claude-v1` is the default for unlabeled blocks.
 * Unknown future dialects map to {@link ReasoningFormat.Unknown}.
 *
 * @group Messages & Events
 */
export enum ReasoningFormat {
  /** Dialect not advertised by the provider. */
  Unknown = "unknown",
  /** OpenAI Responses API reasoning items. */
  OpenAIResponsesV1 = "openai-responses-v1",
  /** Azure OpenAI Responses API reasoning items. */
  AzureOpenAIResponsesV1 = "azure-openai-responses-v1",
  /** xAI Responses API reasoning items. */
  XAIResponsesV1 = "xai-responses-v1",
  /** Anthropic Claude reasoning blocks — the default for unlabeled blocks. */
  AnthropicClaudeV1 = "anthropic-claude-v1",
  /** Google Gemini reasoning blocks (thought signatures). */
  GoogleGeminiV1 = "google-gemini-v1",
}

/**
 * One structured reasoning block, preserved VERBATIM for replay.
 *
 * @remarks
 * The richer counterpart to the flat {@link Message.reasoning} string: the form
 * aggregators (OpenRouter and similar) use for models whose chain-of-thought is
 * signed, summarized, or encrypted (Anthropic, Gemini, OpenAI o-series). A turn
 * may carry several blocks; their relative order and {@link ReasoningDetailBase.index | index}
 * are load-bearing.
 *
 * IMMUTABILITY CONTRACT — these blocks are pass-through-verbatim. A
 * `reasoning.text` block's {@link ReasoningTextDetail.signature | signature} and a
 * {@link ReasoningEncryptedDetail.data | reasoning.encrypted} blob are validated
 * by the model; editing, reordering, merging, splitting, or dropping any block
 * invalidates the sequence (e.g. Gemini rejects a tool call whose thought
 * signature is missing with a 400). Consumers that inspect reasoning may read the
 * flattened {@link Message.reasoning} text, but must resend `reasoning_details`
 * unchanged and in original order.
 *
 * @see {@link Message.reasoning_details}
 * @group Messages & Events
 */
export interface ReasoningDetailBase {
  /** Provider-assigned block id, or `null` when the provider sends none. */
  id: string | null;
  /** The dialect this block is encoded in; see {@link ReasoningFormat}. */
  format: ReasoningFormat;
  /**
   * Sequence position within the turn's reasoning. Load-bearing: it drives
   * streaming reassembly and fixes the order blocks must be resent in.
   */
  index?: number;
}

/**
 * A plaintext (optionally signed) reasoning block.
 *
 * @remarks
 * When {@link ReasoningTextDetail.signature | signature} is present the `text` is
 * signature-protected — treat the whole block as immutable.
 *
 * @group Messages & Events
 */
export interface ReasoningTextDetail extends ReasoningDetailBase {
  /** Discriminant. */
  type: "reasoning.text";
  /** The reasoning text. */
  text: string;
  /** Provider signature over the text; when set, the block is immutable. */
  signature?: string | null;
}

/**
 * A provider-summarized reasoning block (the raw chain-of-thought is withheld).
 *
 * @group Messages & Events
 */
export interface ReasoningSummaryDetail extends ReasoningDetailBase {
  /** Discriminant. */
  type: "reasoning.summary";
  /** The provider's summary of the hidden reasoning. */
  summary: string;
}

/**
 * An encrypted reasoning block — opaque ciphertext, never decoded by this library.
 *
 * @group Messages & Events
 */
export interface ReasoningEncryptedDetail extends ReasoningDetailBase {
  /** Discriminant. */
  type: "reasoning.encrypted";
  /** Opaque encrypted payload; pass-through only. May stream as `[REDACTED]`. */
  data: string;
}

/**
 * A structured reasoning block in one of its three shapes.
 *
 * @remarks
 * Discriminated on `type`. See {@link ReasoningDetailBase} for the immutability
 * contract that governs all three.
 *
 * @group Messages & Events
 */
export type ReasoningDetail =
  | ReasoningTextDetail
  | ReasoningSummaryDetail
  | ReasoningEncryptedDetail;
