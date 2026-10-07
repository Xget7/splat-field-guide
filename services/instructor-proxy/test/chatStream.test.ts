import assert from "node:assert/strict";
import test from "node:test";
import { anthropicToOpenAiStream } from "../src/chatStream.ts";

const encoder = new TextEncoder();
const metadata = { id: "chatcmpl-test", model: "voice-model", created: 123 };
function sse(name: string, data: unknown = { type: name }, ending = "\n") {
  return `event: ${name}${ending}data: ${JSON.stringify(data)}${ending}${ending}`;
}
function source(parts: (string | Uint8Array)[]) {
  return new ReadableStream<Uint8Array>({ start(controller) {
    for (const part of parts) controller.enqueue(typeof part === "string" ? encoder.encode(part) : part);
    controller.close();
  } });
}
async function chunks(input: ReadableStream<Uint8Array>) {
  const text = await new Response(anthropicToOpenAiStream(input, metadata)).text();
  if (!text) return [];
  assert.ok(text.endsWith("\n\n"));
  return text.trimEnd().split("\n\n").map((line) => {
    assert.ok(line.startsWith("data: "));
    const data = line.slice(6);
    if (data === "[DONE]") return data;
    const chunk = JSON.parse(data);
    assert.deepEqual({ id: chunk.id, model: chunk.model, created: chunk.created }, metadata);
    assert.equal(chunk.object, "chat.completion.chunk");
    assert.equal(chunk.choices.length, 1);
    assert.equal(chunk.choices[0].index, 0);
    return chunk.choices[0];
  });
}
const choice = (delta, finish_reason = null) => ({ index: 0, delta, finish_reason });
const finish = (reason: string) => sse("message_delta", { delta: { stop_reason: reason } });

test("text streams as ordered OpenAI chunks with a single terminal DONE", async () => {
  assert.deepEqual(await chunks(source([
    sse("message_start"), sse("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    sse("content_block_delta", { delta: { type: "text_delta", text: "Check " } }),
    sse("content_block_delta", { delta: { type: "text_delta", text: "the oil." } }),
    finish("end_turn"), sse("message_stop"), sse("message_stop"),
  ])), [choice({ role: "assistant", content: "" }), choice({ content: "Check " }),
    choice({ content: "the oil." }), choice({}, "stop"), "[DONE]"]);
});

test("tool indices count tools instead of text blocks and JSON fragments stay in order", async () => {
  const result = await chunks(source([
    sse("content_block_start", { index: 0, content_block: { type: "text" } }),
    sse("content_block_start", { index: 1, content_block: { type: "tool_use", id: "call-1", name: "show_part", input: {} } }),
    sse("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: '{"part_id":' } }),
    sse("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: '"oil"}' } }),
    sse("content_block_start", { index: 3, content_block: { type: "tool_use", id: "call-2", name: "next_step", input: {} } }),
    sse("content_block_delta", { index: 3, delta: { type: "input_json_delta", partial_json: "{}" } }),
    finish("tool_use"), sse("message_stop"),
  ]));
  assert.deepEqual(result, [
    choice({ tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "show_part", arguments: "" } }] }),
    choice({ tool_calls: [{ index: 0, function: { arguments: '{"part_id":' } }] }),
    choice({ tool_calls: [{ index: 0, function: { arguments: '"oil"}' } }] }),
    choice({ tool_calls: [{ index: 1, id: "call-2", type: "function", function: { name: "next_step", arguments: "" } }] }),
    choice({ tool_calls: [{ index: 1, function: { arguments: "{}" } }] }),
    choice({}, "tool_calls"), "[DONE]",
  ]);
  assert.equal(result.slice(1, 3).map((chunk) => chunk.delta.tool_calls[0].function.arguments).join(""), '{"part_id":"oil"}');
});

test("upstream errors, unreadable JSON and premature EOF close without DONE", async () => {
  for (const terminal of [sse("error", { error: { message: "private detail" } }),
    "event: content_block_delta\ndata: {\n\n", ""]) {
    assert.deepEqual(await chunks(source([sse("message_start"), terminal])), [choice({ role: "assistant", content: "" })]);
  }
});

test("split CRLF, bare CR, multiline JSON and split UTF-8 parse correctly", async () => {
  const events = sse("message_start", {}, "\r") +
    'event:content_block_delta\r\ndata:{\r\ndata: "delta":{"type":"text_delta","text":"Café 🔧"}\r\ndata:}\r\n\r\n' +
    finish("stop_sequence") + sse("message_stop", {}, "\r\n");
  assert.deepEqual(await chunks(source(Array.from(encoder.encode(events), (byte) => Uint8Array.of(byte)))), [
    choice({ role: "assistant", content: "" }), choice({ content: "Café 🔧" }), choice({}, "stop"), "[DONE]",
  ]);
  assert.deepEqual(await chunks(source([finish("max_tokens"), sse("message_stop")])), [choice({}, "length"), "[DONE]"]);
});

test("text arrives before EOF and consumer cancellation releases the upstream", async () => {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let cancelled: unknown;
  const input = new ReadableStream<Uint8Array>({
    start(value) { controller = value; }, cancel(reason) { cancelled = reason; },
  });
  const reader = anthropicToOpenAiStream(input, metadata).getReader();
  controller.enqueue(encoder.encode(sse("message_start")));
  assert.match(new TextDecoder().decode((await reader.read()).value), /"role":"assistant"/);
  await reader.cancel("disconnected");
  assert.equal(cancelled, "disconnected");
});
