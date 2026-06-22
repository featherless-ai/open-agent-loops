import { describe, expect, test } from "bun:test";
import {
  injectReasoningKwargs,
  reasoningKwargsFor,
  reasoningProfileFor,
} from "../providers/reasoning-kwargs";

describe("reasoningKwargsFor", () => {
  // GLM: enable_thinking toggle + clear_thinking continuity (the verified combo).
  test("GLM enables with the clear_thinking continuity key", () => {
    expect(reasoningKwargsFor("zai-org/GLM-5.1", "auto")).toEqual({
      enable_thinking: true,
      clear_thinking: false,
    });
    expect(reasoningKwargsFor("zai-org/GLM-4.7-Flash", "on")).toEqual({
      enable_thinking: true,
      clear_thinking: false,
    });
  });

  // Off drops the continuity key — it only matters while thinking is on.
  test("GLM off sends only the toggle", () => {
    expect(reasoningKwargsFor("zai-org/GLM-5", "off")).toEqual({ enable_thinking: false });
  });

  // Kimi thinking line: `thinking` toggle + preserve_thinking continuity.
  test("Kimi thinking models use thinking + preserve_thinking", () => {
    expect(reasoningKwargsFor("moonshotai/Kimi-K2-Thinking", "auto")).toEqual({
      thinking: true,
      preserve_thinking: true,
    });
    expect(reasoningKwargsFor("moonshotai/Kimi-K2.6", "on")).toEqual({
      thinking: true,
      preserve_thinking: true,
    });
    expect(reasoningKwargsFor("moonshotai/Kimi-K2-Thinking", "off")).toEqual({ thinking: false });
  });

  // Kimi *-Instruct is a non-reasoning variant — inject nothing.
  test("Kimi Instruct variants are non-reasoning", () => {
    expect(reasoningKwargsFor("moonshotai/Kimi-K2-Instruct", "on")).toBeUndefined();
    expect(reasoningKwargsFor("moonshotai/Kimi-K2-Instruct-0905", "auto")).toBeUndefined();
    expect(reasoningProfileFor("moonshotai/Kimi-K2-Instruct")?.reasoning).toBe(false);
  });

  // DeepSeek V3.1/V3.2/V4: `thinking` toggle, default off (hybrid).
  test("DeepSeek V family uses thinking, default off", () => {
    expect(reasoningKwargsFor("deepseek-ai/DeepSeek-V4-Flash", "on")).toEqual({ thinking: true });
    expect(reasoningKwargsFor("deepseek-ai/DeepSeek-V3.2-Speciale", "on")).toEqual({ thinking: true });
    expect(reasoningKwargsFor("deepseek-ai/DeepSeek-V3.1", "auto")).toEqual({ thinking: false });
  });

  // DeepSeek R1 is always-on with no toggle — nothing to inject.
  test("DeepSeek R1 has no runtime toggle", () => {
    expect(reasoningProfileFor("deepseek-ai/DeepSeek-R1-0528")?.toggleKey).toBeNull();
    expect(reasoningKwargsFor("deepseek-ai/DeepSeek-R1-0528", "auto")).toBeUndefined();
  });

  // MiniMax-M2 / M3: interleaved, always-on, no toggle — flagged but no kwargs.
  test("MiniMax M-line is interleaved with no toggle", () => {
    for (const id of ["MiniMaxAI/MiniMax-M2.7", "MiniMaxAI/MiniMax-M3"]) {
      const profile = reasoningProfileFor(id);
      expect(profile?.interleaved).toBe(true);
      expect(profile?.toggleKey).toBeNull();
    }
    expect(reasoningKwargsFor("MiniMaxAI/MiniMax-M3", "auto")).toBeUndefined();
    // "off" is ignored — the model can't disable interleaved thinking.
    expect(reasoningKwargsFor("MiniMaxAI/MiniMax-M2", "off")).toBeUndefined();
    // The broadened prefix must NOT swallow the SynLogic models.
    expect(reasoningProfileFor("MiniMaxAI/SynLogic-32B")).toBeUndefined();
  });

  // MiMo-V2 (Flash / V2.5): enable_thinking, default OFF (like Gemma 4).
  test("MiMo-V2 uses enable_thinking, default off", () => {
    expect(reasoningKwargsFor("XiaomiMiMo/MiMo-V2-Flash", "on")).toEqual({ enable_thinking: true });
    expect(reasoningKwargsFor("XiaomiMiMo/MiMo-V2-Flash", "auto")).toEqual({ enable_thinking: false });
    expect(reasoningKwargsFor("XiaomiMiMo/MiMo-V2.5", "off")).toEqual({ enable_thinking: false });
  });

  // gpt-oss (20b / 120b): always-on reasoner, no chat_template_kwarg toggle.
  test("gpt-oss is always-on with no toggle", () => {
    const profile = reasoningProfileFor("openai/gpt-oss-120b");
    expect(profile?.reasoning).toBe(true);
    expect(profile?.toggleKey).toBeNull();
    expect(reasoningKwargsFor("openai/gpt-oss-20b", "on")).toBeUndefined();
    expect(reasoningKwargsFor("openai/gpt-oss-120b", "auto")).toBeUndefined();
  });

  // Original Qwen3: enable_thinking, default on, interleaved by the template's
  // last_query_index checkpoint — but NO preserve_thinking (arrived in 3.5).
  test("original Qwen3 is interleaved with no preserve_thinking", () => {
    expect(reasoningKwargsFor("Qwen/Qwen3-235B-A22B", "auto")).toEqual({ enable_thinking: true });
    expect(reasoningKwargsFor("Qwen/Qwen3-30B-A3B", "on")).toEqual({ enable_thinking: true });
    expect(reasoningProfileFor("Qwen/Qwen3-235B-A22B")?.interleaved).toBe(true);
  });

  // Qwen3.5 / 3.6: enable_thinking default on, interleaved, + preserve_thinking
  // continuity while thinking is on (dropped when off).
  test("Qwen3.5/3.6 add preserve_thinking continuity", () => {
    expect(reasoningKwargsFor("Qwen/Qwen3.5-397B-A17B", "auto")).toEqual({
      enable_thinking: true,
      preserve_thinking: true,
    });
    expect(reasoningKwargsFor("Qwen/Qwen3.6-35B-A3B", "auto")).toEqual({
      enable_thinking: true,
      preserve_thinking: true,
    });
    expect(reasoningKwargsFor("Qwen/Qwen3.5-27B", "off")).toEqual({ enable_thinking: false });
    expect(reasoningProfileFor("Qwen/Qwen3.6-35B-A3B")?.interleaved).toBe(true);
  });

  // Small Qwen3.5 (2B/4B/9B) default to thinking off, but still interleave and
  // carry preserve_thinking once thinking is on.
  test("small Qwen3.5 defaults off, still interleaves", () => {
    expect(reasoningKwargsFor("Qwen/Qwen3.5-9B", "auto")).toEqual({ enable_thinking: false });
    expect(reasoningKwargsFor("Qwen/Qwen3.5-2B", "on")).toEqual({
      enable_thinking: true,
      preserve_thinking: true,
    });
    expect(reasoningProfileFor("Qwen/Qwen3.5-9B")?.interleaved).toBe(true);
  });

  // Qwen *-Coder / *-Instruct variants don't reason.
  test("Qwen Coder/Instruct variants are non-reasoning", () => {
    expect(reasoningKwargsFor("Qwen/Qwen3-Coder-480B-A35B-Instruct", "on")).toBeUndefined();
    expect(reasoningKwargsFor("Qwen/Qwen3-Next-80B-A3B-Instruct", "auto")).toBeUndefined();
    expect(reasoningKwargsFor("Qwen/Qwen3-VL-30B-A3B-Instruct", "on")).toBeUndefined();
  });

  // The "-Thinking" VL variant still reasons.
  test("Qwen3-VL Thinking still reasons", () => {
    expect(reasoningKwargsFor("Qwen/Qwen3-VL-235B-A22B-Thinking", "auto")).toEqual({
      enable_thinking: true,
    });
  });

  // Gemma 4: enable_thinking, default off.
  test("Gemma 4 uses enable_thinking, default off", () => {
    expect(reasoningKwargsFor("google/gemma-4-31B-it", "auto")).toEqual({ enable_thinking: false });
    expect(reasoningKwargsFor("google/gemma-4-26B-A4B-it", "on")).toEqual({ enable_thinking: true });
  });

  // Step-3.5 reasons but has no documented toggle yet — inject nothing.
  test("Step-3.5 is always-on with no toggle", () => {
    const profile = reasoningProfileFor("stepfun-ai/Step-3.5-Flash");
    expect(profile?.reasoning).toBe(true);
    expect(profile?.toggleKey).toBeNull();
    expect(reasoningKwargsFor("stepfun-ai/Step-3.5-Flash", "on")).toBeUndefined();
  });

  // Non-reasoning families resolve to nothing.
  test.each([
    "meta-llama/Llama-3.3-70B-Instruct",
    "mistralai/Mistral-Small-3.2-24B-Instruct-2506",
    "NousResearch/Hermes-3-Llama-3.1-70B",
    "nvidia/Llama-3.1-Nemotron-70B-Instruct-HF",
  ])("non-reasoning model %s injects nothing", (id) => {
    expect(reasoningKwargsFor(id, "on")).toBeUndefined();
  });

  // A completely unknown id is safe: inject nothing.
  test("unknown model injects nothing", () => {
    expect(reasoningProfileFor("acme/Totally-New-9000")).toBeUndefined();
    expect(reasoningKwargsFor("acme/Totally-New-9000", "on")).toBeUndefined();
  });
});

describe("injectReasoningKwargs", () => {
  // Base: merges the derived kwargs into a request body by its model id.
  test("base: injects kwargs derived from body.model", () => {
    const out = injectReasoningKwargs({ model: "zai-org/GLM-5.1", messages: [] }, "on");
    expect(out.chat_template_kwargs).toEqual({ enable_thinking: true, clear_thinking: false });
    expect((out.messages as unknown[]).length).toBe(0);
  });

  // Edge: an explicit chat_template_kwargs in the body is left untouched.
  test("edge: explicit chat_template_kwargs passes through", () => {
    const body = { model: "zai-org/GLM-5.1", chat_template_kwargs: { enable_thinking: false } };
    expect(injectReasoningKwargs(body, "on")).toEqual(body);
  });

  // Edge: non-reasoning model → body unchanged, no field added.
  test("edge: non-reasoning model is untouched", () => {
    const body = { model: "meta-llama/Llama-3.3-70B-Instruct", messages: [] };
    const out = injectReasoningKwargs(body, "on");
    expect("chat_template_kwargs" in out).toBe(false);
  });

  // Edge: a body with no model id is returned unchanged.
  test("edge: missing model is untouched", () => {
    const body = { messages: [] };
    expect(injectReasoningKwargs(body, "on")).toEqual(body);
  });
});
