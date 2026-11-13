import { HttpError } from './util.js';

// Claude 5.5 enables thinking by default. max_tokens covers thinking + visible text.
// Sonnet rejects disabled; Haiku rejects between_tools. Use their documented modes.
export function claudeThinking(model, web = false) {
  const id = model.replace(/^anthropic\//, '').replaceAll('.', '-');
  if (/^claude-sonnet-5-5(?:-|$)/.test(id)) return {
    thinking: { type: web ? 'adaptive' : 'between_tools' }, output_config: { effort: 'low' },
  };
  if (/^claude-haiku-5-5(?:-|$)/.test(id)) return {
    thinking: { type: web ? 'adaptive' : 'disabled' }, output_config: { effort: 'low' },
  };
  return {}; // Don't send model-specific settings to custom/legacy models.
}

export function claudeOutputError(message, blocks, model, code = 'empty_response') {
  const known = new Set(['text','thinking','redacted_thinking','server_tool_use','web_search_tool_result','tool_use','tool_result']);
  const meta = {
    model, stopReason: typeof message?.stop_reason === 'string' ? message.stop_reason.slice(0, 50) : null,
    blockTypes: [...new Set((Array.isArray(blocks) ? blocks : []).map(b => known.has(b?.type) ? b.type : 'other'))],
    outputTokens: Number(message?.usage?.output_tokens) || 0,
  };
  const limited = meta.stopReason === 'max_tokens';
  const errorCode = limited ? 'output_limit' : code;
  // Metadata only: never log thinking text/signatures, prompts or full response bodies.
  console.error('[claude-output]', JSON.stringify({ code: errorCode, ...meta }));
  return new HttpError(502, errorCode, limited
    ? 'Claude đã dùng hết giới hạn token trước khi hoàn tất câu trả lời. Giảm số câu trong lô chấm hoặc chọn model giám khảo Haiku 5.5.'
    : code === 'invalid_provider_response'
      ? 'Claude trả cấu trúc phản hồi không hợp lệ. Kiểm tra log [claude-output].'
      : 'Claude trả phản hồi nhưng không có văn bản trả lời. Kiểm tra stopReason và blockTypes trong log [claude-output].', meta);
}
