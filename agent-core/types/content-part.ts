/**
 * Multimodal content parts — the array form a {@link UserMessage} may carry in
 * place of a plain text string: text, images, audio, and files.
 *
 * @remarks
 * These mirror OpenAI's chat-completions `ChatCompletionContentPart` wire shapes
 * field-for-field, deliberately: the {@link UserMessage} content array crosses
 * the egress boundary (`toChatMessages`) to the provider as-is, no remapping.
 * They are provider-agnostic by construction — the shape happens to match the
 * OpenAI-compatible wire, which is the only multimodal dialect this loop targets.
 *
 * Scope: multimodal content is INPUT-only and `user`-only in the chat-completions
 * spec — assistant turns stream text plus tool calls, never images — so only the
 * user role widens. A part is discriminated on its `type` string, the same way
 * {@link ReasoningDetail} blocks are.
 *
 * Source of truth — the wire shapes live in the provider's docs, not here:
 *   - https://platform.openai.com/docs/guides/vision (image_url, detail)
 *   - https://platform.openai.com/docs/guides/audio (input_audio)
 *   - https://platform.openai.com/docs/api-reference/chat/create (file parts)
 *
 * @module
 */

/**
 * A plain-text content part — the array-form counterpart to a bare `content`
 * string. Several may appear interleaved with image/audio/file parts.
 *
 * @group Messages & Events
 */
export interface TextPart {
  /** Discriminant. */
  type: "text";
  /** The text of this part. */
  text: string;
}

/**
 * An image content part: a URL the model fetches, or an inline `data:` URI
 * (`data:image/png;base64,...`).
 *
 * @group Messages & Events
 */
export interface ImagePart {
  /** Discriminant. */
  type: "image_url";
  /** The image reference plus optional fidelity hint. */
  image_url: {
    /** An `http(s)://` URL, or a `data:<mime>;base64,<payload>` URI. */
    url: string;
    /**
     * How much detail the model should spend on the image. `"low"` is cheaper /
     * faster, `"high"` resolves fine detail, `"auto"` lets the model pick.
     * Omitted means the provider default (`"auto"`).
     */
    detail?: "auto" | "low" | "high";
  };
}

/**
 * An audio content part: base64-encoded audio the model transcribes / reasons
 * over. Only `wav` and `mp3` are accepted by the chat-completions audio input.
 *
 * @group Messages & Events
 */
export interface AudioPart {
  /** Discriminant. */
  type: "input_audio";
  /** The inline audio payload and its container format. */
  input_audio: {
    /** Base64-encoded audio bytes (no `data:` prefix). */
    data: string;
    /** Container format of {@link AudioPart.input_audio.data | data}. */
    format: "wav" | "mp3";
  };
}

/**
 * A file content part (e.g. a PDF): either inline base64 data, or a reference to
 * a file already uploaded to the provider.
 *
 * @remarks
 * Supply `file_data` (+ usually `filename`) for an inline document, OR `file_id`
 * to point at a previously-uploaded file — not both. The wire shape leaves all
 * three optional; which combination a given endpoint accepts is the provider's
 * concern.
 *
 * @group Messages & Events
 */
export interface FilePart {
  /** Discriminant. */
  type: "file";
  /** The inline file payload or an uploaded-file reference. */
  file: {
    /** Inline file contents, base64-encoded (often a `data:` URI). */
    file_data?: string;
    /** Display name for the file, e.g. `"report.pdf"`. */
    filename?: string;
    /** Id of a file previously uploaded to the provider. */
    file_id?: string;
  };
}

/**
 * One part of a multimodal {@link UserMessage} content array — text, image,
 * audio, or file — discriminated on `type`.
 *
 * @remarks
 * The shapes mirror OpenAI's `ChatCompletionContentPart` members exactly so the
 * array passes straight through egress. A user turn's `content` is either a plain
 * `string` (the common case) or a `ContentPart[]`.
 *
 * @group Messages & Events
 */
export type ContentPart = TextPart | ImagePart | AudioPart | FilePart;

/**
 * Construct a {@link TextPart}.
 *
 * @param text - The text of this part.
 * @group Messages & Events
 */
export function textPart(text: string): TextPart {
  return { type: "text", text };
}

/**
 * Construct an {@link ImagePart} from a URL or `data:` URI.
 *
 * @param url - An `http(s)://` URL or a `data:<mime>;base64,...` URI.
 * @param detail - Optional fidelity hint (`"auto"` | `"low"` | `"high"`).
 * @group Messages & Events
 */
export function imagePart(url: string, detail?: ImagePart["image_url"]["detail"]): ImagePart {
  return { type: "image_url", image_url: { url, ...(detail ? { detail } : {}) } };
}

/**
 * Construct an {@link AudioPart} from base64 audio bytes.
 *
 * @param data - Base64-encoded audio (no `data:` prefix).
 * @param format - Container format of the audio (`"wav"` | `"mp3"`).
 * @group Messages & Events
 */
export function audioPart(data: string, format: AudioPart["input_audio"]["format"]): AudioPart {
  return { type: "input_audio", input_audio: { data, format } };
}

/**
 * Construct a {@link FilePart} — inline `file_data` (+ `filename`) or a
 * `file_id` reference.
 *
 * @param file - The inline payload or uploaded-file reference.
 * @group Messages & Events
 */
export function filePart(file: FilePart["file"]): FilePart {
  return { type: "file", file };
}

/**
 * Flatten a `string | ContentPart[]` to a single display string: text parts
 * verbatim, non-text parts as a compact placeholder (`[image]`, `[audio]`,
 * `[file: report.pdf]`).
 *
 * @remarks
 * For logging / tracing / any spot that needs the human-readable gist of a turn
 * without rendering binary parts. A plain string passes through unchanged.
 *
 * @param content - A bare text string or a multimodal part array.
 * @returns A display string.
 * @group Messages & Events
 */
export function contentToText(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content.map(partToText).join("");
}

/**
 * Render one {@link ContentPart} as display text — text verbatim, everything
 * else a compact placeholder.
 *
 * @internal
 */
function partToText(part: ContentPart): string {
  switch (part.type) {
    case "text":
      return part.text;
    case "image_url":
      return "[image]";
    case "input_audio":
      return "[audio]";
    case "file":
      return part.file.filename ? `[file: ${part.file.filename}]` : "[file]";
  }
}
