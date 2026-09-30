/**
 * Evaluate a vision model against the labelled synthetic dataset.
 *
 *   npm run eval                                   # offline, fake model
 *   VISION_PROVIDER=anthropic npm run eval -- --samples 3
 *   npm run eval -- --no-context --limit 20        # anchoring experiment: hide the asset register
 *   npm run eval -- --gate                         # exit 1 if below thresholds (for CI)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcile, type AssetSpec } from '@ic/core';
import { AnthropicVisionModel, FakeVisionModel, OpenAICompatibleVisionModel, readWithConsensus, type GroundTruth, type VisionModel } from '@ic/vision';
import { score, type EvalCase } from './metrics';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(here, '../../data/synthetic');
const arg = (name: string) => process.argv.includes(`--${name}`);
const argVal = (name: string, d: string) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1]! : d; };

const GATES = { accuracyWithinTolerance: 0.85, autoAcceptErrorRate: 0.02, unreadableRecall: 0.75 };

const assets: AssetSpec[] = JSON.parse(await readFile(path.join(DATA, 'assets.json'), 'utf8'));
const inspections: any[] = JSON.parse(await readFile(path.join(DATA, 'inspections.json'), 'utf8'));
const labels: GroundTruth[] & { robotFault: string }[] = JSON.parse(await readFile(path.join(DATA, 'labels.json'), 'utf8'));
const assetById = new Map(assets.map((a) => [a.id, a]));
const labelById = new Map(labels.map((l: any) => [l.inspectionId, l]));

function model(): VisionModel {
  const p = process.env.VISION_PROVIDER ?? 'fake';
  if (p === 'anthropic') return new AnthropicVisionModel({ apiKey: process.env.ANTHROPIC_API_KEY!, model: process.env.ANTHROPIC_MODEL! });
  if (p === 'openai-compatible') return new OpenAICompatibleVisionModel({ baseUrl: process.env.OPENAI_BASE_URL!, apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL!, azureApiVersion: process.env.AZURE_OPENAI_API_VERSION || undefined });
  const truth = new Map(labels.map((l: any) => { const a = assetById.get(inspections.find((i) => i.inspectionId === l.inspectionId).assetId)!; return [l.inspectionId, { ...l, scaleMin: a.scaleMin, scaleMax: a.scaleMax }]; }));
  return new FakeVisionModel(truth, Number(argVal('seed', '42')));
}

const m = model();
const samples = Number(argVal('samples', process.env.VISION_SAMPLES ?? '3'));
const limit = Number(argVal('limit', '1000'));
const useContext = !arg('no-context');
const concurrency = Number(argVal('concurrency', '4'));
console.log(`Evaluating ${m.name} · ${samples} sample(s)/image · context ${useContext ? 'on' : 'off'}`);

const todo = inspections.slice(0, limit);
const cases: EvalCase[] = [];
let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < todo.length) {
    const insp = todo[next++]!;
    const a = assetById.get(insp.assetId)!;
    const l: any = labelById.get(insp.inspectionId)!;
    const image = await readFile(path.join(DATA, insp.image));
    const r = await readWithConsensus(m, {
      image, mediaType: 'image/jpeg', inspectionId: insp.inspectionId,
      context: useContext ? { assetName: a.name, expectedUnit: a.unit, scaleMin: a.scaleMin, scaleMax: a.scaleMax } : undefined,
    }, samples, a.scaleMax - a.scaleMin);
    const finding = reconcile(a, insp.robotReading, r.consensus);
    cases.push({
      inspectionId: insp.inspectionId, condition: l.imageCondition, span: a.scaleMax - a.scaleMin,
      truth: { value: l.trueValue, readable: l.readable, defects: l.defects, robotFault: l.robotFault },
      predicted: { readable: r.consensus.readable, value: r.consensus.value, defects: r.consensus.defects, confidence: r.consensus.confidence },
      finding, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, latencyMs: r.latencyMs,
    });
    process.stdout.write('.');
  }
}));
console.log('\n');

const report = score(cases);
const inPrice = Number(process.env.PRICE_INPUT_PER_MTOK ?? '3');
const outPrice = Number(process.env.PRICE_OUTPUT_PER_MTOK ?? '15');
const cost = (report.tokens.input * inPrice + report.tokens.output * outPrice) / 1e6;

const rows: Array<[string, string]> = [
  ['Cases (readable)', `${report.cases} (${report.readableCases})`],
  ['Accuracy within 3% of span', `${(report.accuracyWithinTolerance * 100).toFixed(1)}%`],
  ['Mean abs error (% of span)', `${report.meanAbsErrorPctSpan.toFixed(2)}%`],
  ['Unreadable correctly refused', `${(report.unreadableRecall * 100).toFixed(1)}%`],
  ['False refusals', `${(report.falseRefusalRate * 100).toFixed(1)}%`],
  ['Auto-accepted', `${(report.autoAcceptRate * 100).toFixed(1)}%`],
  ['Auto-accepted but wrong  ← safety', `${(report.autoAcceptErrorRate * 100).toFixed(1)}%`],
  ['Robot faults detected', `${(report.robotFaultDetection * 100).toFixed(1)}%`],
  ['Robot false alarms', `${(report.robotFalseAlarmRate * 100).toFixed(1)}%`],
  ['Defect recall / precision', `${(report.defectRecall * 100).toFixed(0)}% / ${(report.defectPrecision * 100).toFixed(0)}%`],
  ['Tokens in / out', `${report.tokens.input} / ${report.tokens.output}`],
  ['Est. cost (at configured prices)', `$${cost.toFixed(4)} total, $${(cost / report.cases).toFixed(5)} per image`],
  ['Latency p50 / p95', `${report.latencyMs.p50} / ${report.latencyMs.p95} ms`],
];
const w = Math.max(...rows.map((r) => r[0].length));
for (const [k, v] of rows) console.log(`${k.padEnd(w)}  ${v}`);
console.log('\nAccuracy by image condition:');
for (const [c, v] of Object.entries(report.byCondition)) console.log(`  ${c.padEnd(12)} ${v.accuracy === null ? 'n/a (see refusal rate)' : (v.accuracy * 100).toFixed(1) + '%'}  (${v.cases} images)`);

await mkdir(path.join(here, '../results'), { recursive: true });
const out = path.join(here, '../results', `${new Date().toISOString().replace(/[:.]/g, '-')}_${m.name.replace(/[^a-z0-9]+/gi, '-')}.json`);
await writeFile(out, JSON.stringify({ model: m.name, samples, useContext, report, cases }, null, 2));
console.log(`\nSaved ${path.relative(process.cwd(), out)}`);

if (arg('gate')) {
  const fails = [
    report.accuracyWithinTolerance < GATES.accuracyWithinTolerance && `accuracy ${report.accuracyWithinTolerance} < ${GATES.accuracyWithinTolerance}`,
    report.autoAcceptErrorRate > GATES.autoAcceptErrorRate && `auto-accept error ${report.autoAcceptErrorRate} > ${GATES.autoAcceptErrorRate}`,
    report.unreadableRecall < GATES.unreadableRecall && `unreadable recall ${report.unreadableRecall} < ${GATES.unreadableRecall}`,
  ].filter(Boolean);
  if (fails.length) { console.error('EVAL GATE FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('Eval gate passed.');
}
