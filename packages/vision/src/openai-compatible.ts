import { parseReading } from './parse';
import { postJson, type FetchLike, type PostOptions } from './http';
import { ProviderError, type VisionInput, type VisionModel, type VisionResult } from './model';
import { buildUserPrompt, READING_JSON_SCHEMA, SYSTEM_PROMPT } from './prompt';

export interface OpenAICompatibleConfig {
  /**
   * OpenAI / vLLM / Ollama: e.g. http://localhost:11434/v1
   * Azure OpenAI: https://<resource>.openai.azure.com/openai/deployments/<deployment>
   */
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** Set for Azure OpenAI (e.g. "2024-10-21"): switches to api-key header + api-version query. */
  azureApiVersion?: string;
  temperature?: number;
  /** Some local servers don't support json_schema; fall back to plain JSON mode. */
  jsonSchema?: boolean;
  fetch?: FetchLike;
  http?: PostOptions;
}

/**
 * Any server speaking the OpenAI Chat Completions API: Azure OpenAI, or an open-weight
 * vision model you host yourself on your own GPUs (vLLM, Ollama) — for operators whose
 * data must not leave their environment.
 */
export class OpenAICompatibleVisionModel implements VisionModel {
  readonly name: string;
  constructor(private cfg: OpenAICompatibleConfig) {
    this.name = `openai-compatible:${cfg.model}`;
  }

  async readGauge(input: VisionInput): Promise<VisionResult> {
    const started = Date.now();
    const azure = Boolean(this.cfg.azureApiVersion);
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions${azure ? `?api-version=${this.cfg.azureApiVersion}` : ''}`;
    const headers: Record<string, string> = {};
    if (this.cfg.apiKey) {
      if (azure) headers['api-key'] = this.cfg.apiKey;
      else headers.authorization = `Bearer ${this.cfg.apiKey}`;
    }
    const body = {
      model: this.cfg.model,
      temperature: this.cfg.temperature ?? 0.5,
      max_tokens: 600,
      response_format: this.cfg.jsonSchema === false
        ? { type: 'json_object' }
        : { type: 'json_schema', json_schema: { name: 'gauge_reading', strict: true, schema: READING_JSON_SCHEMA } },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT.replace('Always answer by calling the record_gauge_reading tool exactly once.', 'Answer with a single JSON object only.') },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildUserPrompt(input.context) },
            { type: 'image_url', image_url: { url: `data:${input.mediaType};base64,${input.image.toString('base64')}` } },
          ],
        },
      ],
    };
    const res = await postJson(this.cfg.fetch ?? fetch, url, headers, body, this.cfg.http);
    const content = res.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new ProviderError('no message content in response');
    return {
      reading: parseReading(content),
      usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 },
      model: res.model ?? this.cfg.model,
      latencyMs: Date.now() - started,
    };
  }
}
