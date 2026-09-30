import { parseReading } from './parse';
import { postJson, type FetchLike, type PostOptions } from './http';
import { ProviderError, type VisionInput, type VisionModel, type VisionResult } from './model';
import { buildUserPrompt, READING_JSON_SCHEMA, SYSTEM_PROMPT, TOOL_NAME } from './prompt';

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  temperature?: number;
  baseUrl?: string;
  fetch?: FetchLike;
  http?: PostOptions;
}

/** Claude via the Messages API, using forced tool use to get structured output. */
export class AnthropicVisionModel implements VisionModel {
  readonly name: string;
  constructor(private cfg: AnthropicConfig) {
    this.name = `anthropic:${cfg.model}`;
  }

  async readGauge(input: VisionInput): Promise<VisionResult> {
    const started = Date.now();
    const body = {
      model: this.cfg.model,
      max_tokens: 600,
      temperature: this.cfg.temperature ?? 0.5,
      system: SYSTEM_PROMPT,
      tools: [{ name: TOOL_NAME, description: 'Record the gauge reading.', input_schema: READING_JSON_SCHEMA }],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: input.mediaType, data: input.image.toString('base64') } },
          { type: 'text', text: buildUserPrompt(input.context) },
        ],
      }],
    };
    const res = await postJson(
      this.cfg.fetch ?? fetch,
      `${this.cfg.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`,
      { 'x-api-key': this.cfg.apiKey, 'anthropic-version': '2023-06-01' },
      body,
      this.cfg.http,
    );
    const toolUse = res.content?.find((b: any) => b.type === 'tool_use' && b.name === TOOL_NAME);
    if (!toolUse) throw new ProviderError('model did not call the reading tool');
    return {
      reading: parseReading(toolUse.input),
      usage: { inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 },
      model: res.model ?? this.cfg.model,
      latencyMs: Date.now() - started,
    };
  }
}
