export const Role = {
  system: "system", user: "user", assistant: "assistant", tool: "tool",
} as const;
export const CACHE_CONTROL_TYPE = "ephemeral";
export const FUNCTION_TYPE = "function";
export const ToolChoiceType = {
  auto: "auto", required: "required", none: "none", any: "any", tool: "tool",
} as const;
export const StopReason = {
  endTurn: "end_turn", stopSequence: "stop_sequence", toolUse: "tool_use",
  maxTokens: "max_tokens", refusal: "refusal",
} as const;
export type AnthropicStopReason = typeof StopReason[keyof typeof StopReason];
export const FinishReason = {
  stop: "stop", toolCalls: "tool_calls", length: "length", contentFilter: "content_filter",
} as const;
export type OpenAiFinishReason = typeof FinishReason[keyof typeof FinishReason];
