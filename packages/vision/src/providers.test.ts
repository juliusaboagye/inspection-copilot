import { describe, it, expect, vi } from 'vitest';
import { AnthropicVisionModel } from './anthropic';
import { OpenAICompatibleVisionModel } from './openai-compatible';
import { TOOL_NAME } from './prompt';

const reading = { readable: true, value: 8.2, unit: 'bar', scaleMin: 0, scaleMax: 16, defects: [], imageQuality: 'good', notes: 'ok' };
const input = { image: Buffer.from('fake-image'), mediaType: 'image/jpeg' as const, context: { assetName: 'P-101', expectedUnit: 'bar', scaleMin: 0, scaleMax: 16 } };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const noSleep = { sleep: async () => {} };

describe('AnthropicVisionModel', () => {
  const ok = { model: 'm', content: [{ type: 'tool_use', name: TOOL_NAME, id: 't1', input: reading }], usage: { input_tokens: 1500, output_tokens: 80 } };

  it('sends the image as base64 and forces the reading tool', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => json(ok));
    await new AnthropicVisionModel({ apiKey: 'k', model: 'm', fetch, http: noSleep }).readGauge(input);
    const [url, init] = fetch.mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('k');
    expect(body.tool_choice).toEqual({ type: 'tool', name: TOOL_NAME });
    expect(body.messages[0].content[0]).toEqual({
      type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('fake-image').toString('base64') },
    });
    expect(body.messages[0].content[1].text).toContain('expected unit bar');
  });

  it('returns the validated reading and token usage', async () => {
    const fetch = vi.fn(async () => json(ok));
    const r = await new AnthropicVisionModel({ apiKey: 'k', model: 'm', fetch, http: noSleep }).readGauge(input);
    expect(r.reading.value).toBe(8.2);
    expect(r.usage).toEqual({ inputTokens: 1500, outputTokens: 80 });
  });

  it('retries on 429 then succeeds', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ error: 'rate' }, 429, { 'retry-after': '1' }))
      .mockResolvedValueOnce(json(ok));
    const r = await new AnthropicVisionModel({ apiKey: 'k', model: 'm', fetch, http: noSleep }).readGauge(input);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(r.reading.value).toBe(8.2);
  });

  it('does not retry a 400 and surfaces the error', async () => {
    const fetch = vi.fn(async () => json({ error: 'bad' }, 400));
    await expect(new AnthropicVisionModel({ apiKey: 'k', model: 'm', fetch, http: noSleep }).readGauge(input)).rejects.toThrow(/HTTP 400/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fails clearly if the model answers in prose instead of calling the tool', async () => {
    const fetch = vi.fn(async () => json({ content: [{ type: 'text', text: 'About 8 bar' }] }));
    await expect(new AnthropicVisionModel({ apiKey: 'k', model: 'm', fetch, http: noSleep }).readGauge(input)).rejects.toThrow(/did not call/);
  });
});

describe('OpenAICompatibleVisionModel', () => {
  const ok = { model: 'gpt', choices: [{ message: { content: JSON.stringify(reading) } }], usage: { prompt_tokens: 900, completion_tokens: 60 } };

  it('uses Bearer auth and a strict json_schema for OpenAI-style servers', async () => {
    const fetch = vi.fn(async (_u: string, _i: RequestInit) => json(ok));
    await new OpenAICompatibleVisionModel({ baseUrl: 'http://localhost:11434/v1/', apiKey: 'k', model: 'llava', fetch, http: noSleep }).readGauge(input);
    const [url, init] = fetch.mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('switches to Azure conventions when an api-version is given', async () => {
    const fetch = vi.fn(async (_u: string, _i: RequestInit) => json(ok));
    await new OpenAICompatibleVisionModel({
      baseUrl: 'https://res.openai.azure.com/openai/deployments/vision', apiKey: 'k', model: 'vision', azureApiVersion: '2024-10-21', fetch, http: noSleep,
    }).readGauge(input);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://res.openai.azure.com/openai/deployments/vision/chat/completions?api-version=2024-10-21');
    expect((init.headers as Record<string, string>)['api-key']).toBe('k');
  });

  it('parses the JSON content and usage', async () => {
    const fetch = vi.fn(async () => json(ok));
    const r = await new OpenAICompatibleVisionModel({ baseUrl: 'http://x/v1', model: 'm', fetch, http: noSleep }).readGauge(input);
    expect(r.reading.unit).toBe('bar');
    expect(r.usage).toEqual({ inputTokens: 900, outputTokens: 60 });
  });
});
