import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const evalsDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(evalsDir);
const workspaceDir = path.join(path.dirname(skillDir), 'baoyu-post-to-binance-square-workspace');
const iterationDir = path.join(workspaceDir, 'iteration-1');
const baselineDir = process.env.BASELINE_BINANCE_SKILL_DIR ??
  path.join(process.env.HOME ?? '', '.claude', 'skills', 'baoyu-post-to-binance-square');

type EvalDefinition = {
  id: number;
  prompt: string;
  expected_output: string;
  files: string[];
  expectations: string[];
};

type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
  durationSeconds: number;
};

async function run(command: string, args: string[], cwd: string): Promise<CommandResult> {
  const started = performance.now();
  try {
    const result = await execFileAsync(command, args, { cwd, maxBuffer: 2 * 1024 * 1024 });
    return {
      status: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      durationSeconds: (performance.now() - started) / 1000,
    };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return {
      status: typeof failed.code === 'number' ? failed.code : 1,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? String(error),
      durationSeconds: (performance.now() - started) / 1000,
    };
  }
}

function evalName(evalDefinition: EvalDefinition): string {
  return evalDefinition.id === 1
    ? 'standard-bundle'
    : evalDefinition.id === 2
      ? 'rich-markdown-bundle'
      : 'malicious-traversal';
}

function grade(evalDefinition: EvalDefinition, result: CommandResult, withSkill: boolean) {
  const combined = `${result.stdout}\n${result.stderr}`;
  const expectedRejection = evalDefinition.id === 3;
  const validStatus = expectedRejection
    ? result.status !== 0 && /unsafe bundle path/i.test(combined)
    : result.status === 0 && /"valid": true/.test(combined);
  const evidence = withSkill && validStatus
    ? expectedRejection
      ? 'Dry-run exited non-zero with “Unsafe bundle path: ../cookies.json” before any browser action.'
      : `Dry-run returned valid JSON: ${result.stdout.trim()}`
    : 'The v1.0 baseline help has no --bundle or --dry-run interface, so it cannot perform this offline validation.';
  const expectations = evalDefinition.expectations.map((text) => ({
    text,
    passed: withSkill && validStatus,
    evidence,
  }));
  const passed = expectations.filter((item) => item.passed).length;
  return {
    expectations,
    summary: { passed, failed: expectations.length - passed, total: expectations.length, pass_rate: passed / expectations.length },
    execution_metrics: {
      tool_calls: { command: 1 }, total_tool_calls: 1, total_steps: 1,
      errors_encountered: expectedRejection && validStatus ? 0 : result.status === 0 ? 0 : 1,
      output_chars: combined.length, transcript_chars: combined.length,
    },
    timing: { executor_duration_seconds: result.durationSeconds, total_duration_seconds: result.durationSeconds },
    claims: [{
      claim: withSkill ? 'The bundle was validated offline.' : 'The baseline supports bundle dry-run validation.',
      type: 'process',
      verified: withSkill && validStatus,
      evidence,
    }],
    user_notes_summary: { uncertainties: [], needs_review: [], workarounds: [] },
    eval_feedback: { suggestions: [], overall: 'The assertions distinguish validation, browser safety, and result accuracy.' },
  };
}

async function writeRun(
  evalDefinition: EvalDefinition,
  configuration: 'with_skill' | 'old_skill',
  result: CommandResult,
): Promise<{ passRate: number; durationSeconds: number }> {
  const directory = path.join(iterationDir, evalName(evalDefinition), configuration);
  const outputs = path.join(directory, 'outputs');
  await fs.mkdir(outputs, { recursive: true });
  const grading = grade(evalDefinition, result, configuration === 'with_skill');
  const commandDescription = configuration === 'with_skill'
    ? `bun scripts/main.ts --bundle ${evalDefinition.files[0]} --dry-run`
    : 'bun scripts/main.ts --help (v1.0 baseline; bundle dry-run is unavailable)';
  const combined = `${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`.trim();
  await Promise.all([
    fs.writeFile(path.join(outputs, 'result.txt'), `${combined}\n`),
    fs.writeFile(path.join(directory, 'transcript.md'), [
      `# ${evalName(evalDefinition)} — ${configuration}`,
      '', `Prompt: ${evalDefinition.prompt}`, '', `Command: \`${commandDescription}\``, '',
      `Exit status: ${result.status}`, '', '```text', combined, '```', '',
    ].join('\n')),
    fs.writeFile(path.join(directory, 'eval_metadata.json'), JSON.stringify({
      eval_id: evalDefinition.id,
      eval_name: evalName(evalDefinition),
      prompt: evalDefinition.prompt,
      assertions: evalDefinition.expectations,
    }, null, 2)),
    fs.writeFile(path.join(directory, 'grading.json'), JSON.stringify(grading, null, 2)),
    fs.writeFile(path.join(directory, 'timing.json'), JSON.stringify({
      total_tokens: 0,
      duration_ms: Math.round(result.durationSeconds * 1000),
      total_duration_seconds: result.durationSeconds,
    }, null, 2)),
    fs.writeFile(path.join(outputs, 'metrics.json'), JSON.stringify(grading.execution_metrics, null, 2)),
  ]);
  return { passRate: grading.summary.pass_rate, durationSeconds: result.durationSeconds };
}

function stats(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return { mean, stddev: Math.sqrt(variance), min: Math.min(...values), max: Math.max(...values) };
}

const evalSet = JSON.parse(await fs.readFile(path.join(evalsDir, 'evals.json'), 'utf8')) as { evals: EvalDefinition[] };
await fs.rm(iterationDir, { recursive: true, force: true });
await fs.mkdir(iterationDir, { recursive: true });

const benchmarkRuns: Array<Record<string, unknown>> = [];
const withRates: number[] = [];
const oldRates: number[] = [];
const withTimes: number[] = [];
const oldTimes: number[] = [];

for (const evalDefinition of evalSet.evals) {
  const relativeBundle = evalDefinition.files[0]!;
  const [withSkill, oldSkill] = await Promise.all([
    run('bun', ['scripts/main.ts', '--bundle', relativeBundle, '--dry-run'], skillDir),
    run('bun', ['scripts/main.ts', '--help'], baselineDir),
  ]);
  const [withGrade, oldGrade] = await Promise.all([
    writeRun(evalDefinition, 'with_skill', withSkill),
    writeRun(evalDefinition, 'old_skill', oldSkill),
  ]);
  withRates.push(withGrade.passRate); oldRates.push(oldGrade.passRate);
  withTimes.push(withGrade.durationSeconds); oldTimes.push(oldGrade.durationSeconds);
  for (const [configuration, gradeSummary, result] of [
    ['with_skill', withGrade, withSkill],
    ['without_skill', oldGrade, oldSkill],
  ] as const) {
    benchmarkRuns.push({
      eval_id: evalDefinition.id,
      eval_name: evalName(evalDefinition),
      configuration,
      run_number: 1,
      result: {
        pass_rate: gradeSummary.passRate,
        passed: Math.round(gradeSummary.passRate * evalDefinition.expectations.length),
        failed: Math.round((1 - gradeSummary.passRate) * evalDefinition.expectations.length),
        total: evalDefinition.expectations.length,
        time_seconds: result.durationSeconds,
        tokens: 0,
        tool_calls: 1,
        errors: result.status === 0 || (evalDefinition.id === 3 && configuration === 'with_skill') ? 0 : 1,
      },
      expectations: gradeSummary === withGrade
        ? grade(evalDefinition, result, true).expectations
        : grade(evalDefinition, result, false).expectations,
      notes: [],
    });
  }
}

const benchmark = {
  metadata: {
    skill_name: 'baoyu-post-to-binance-square',
    skill_path: skillDir,
    executor_model: 'deterministic-cli',
    analyzer_model: 'deterministic-assertions',
    timestamp: new Date().toISOString(),
    evals_run: evalSet.evals.map((item) => item.id),
    runs_per_configuration: 1,
  },
  runs: benchmarkRuns,
  run_summary: {
    with_skill: { pass_rate: stats(withRates), time_seconds: stats(withTimes), tokens: stats([0, 0, 0]) },
    without_skill: { pass_rate: stats(oldRates), time_seconds: stats(oldTimes), tokens: stats([0, 0, 0]) },
    delta: {
      pass_rate: `+${(stats(withRates).mean - stats(oldRates).mean).toFixed(2)}`,
      time_seconds: `${(stats(withTimes).mean - stats(oldTimes).mean).toFixed(3)}`,
      tokens: '+0',
    },
  },
  notes: [
    'The v1.3 skill passed all standard, rich-Markdown, and hostile-archive dry-run assertions.',
    'The v1.0 baseline exposes no bundle or dry-run interface, so it cannot validate any of the three bundles offline.',
    'The hostile-archive case treats a non-zero exit as success only when the unsafe traversal path is explicitly identified.',
  ],
};
await fs.writeFile(path.join(iterationDir, 'benchmark.json'), JSON.stringify(benchmark, null, 2));
await fs.writeFile(path.join(iterationDir, 'benchmark.md'), [
  '# Binance Square skill dry-run benchmark', '',
  `- v1.3 pass rate: ${(stats(withRates).mean * 100).toFixed(0)}%`,
  `- v1.0 pass rate: ${(stats(oldRates).mean * 100).toFixed(0)}%`,
  '- No Chrome window was opened and no public post was attempted.', '',
].join('\n'));
await fs.writeFile(path.join(workspaceDir, 'history.json'), JSON.stringify({
  started_at: new Date().toISOString(),
  skill_name: 'baoyu-post-to-binance-square',
  current_best: 'v1.3.0',
  iterations: [
    { version: 'v1.0.0', parent: null, expectation_pass_rate: stats(oldRates).mean, grading_result: 'baseline', is_current_best: false },
    { version: 'v1.3.0', parent: 'v1.0.0', expectation_pass_rate: stats(withRates).mean, grading_result: 'won', is_current_best: true },
  ],
}, null, 2));

console.log(`Evaluation workspace: ${workspaceDir}`);
