import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function readCiWorkflow(): string {
  const workflowPath = join(process.cwd(), '.github', 'workflows', 'ci.yml');
  assert.equal(existsSync(workflowPath), true, `missing workflow: ${workflowPath}`);
  return readFileSync(workflowPath, 'utf-8');
}

function jobBlock(workflow: string, jobName: string): string {
  const startMatch = workflow.match(new RegExp(`(^|\\n)  ${jobName}:\\n`));
  assert.ok(startMatch?.index !== undefined, `missing CI job block for ${jobName}`);

  const start = startMatch.index + startMatch[1].length;
  const afterJobHeader = start + `  ${jobName}:\n`.length;
  const nextJobOffset = workflow.slice(afterJobHeader).search(/\n  [a-z0-9-]+:\n/);
  const end = nextJobOffset === -1 ? workflow.length : afterJobHeader + nextJobOffset;
  return workflow.slice(start, end);
}

describe('CI Rust gates', () => {
  it('requires rustfmt, clippy, and Rust test coverage gates plus an explicit Rust toolchain setup for the final native build lane', () => {
    const workflow = readCiWorkflow();
    const rustTestsJob = jobBlock(workflow, 'rust-tests');

    assert.match(workflow, /rustfmt:/);
    assert.match(workflow, /components:\s*rustfmt/);
    assert.match(workflow, /cargo fmt --all --check/);

    assert.match(workflow, /clippy:/);
    assert.match(workflow, /components:\s*clippy/);
    assert.match(workflow, /cargo clippy --workspace --all-targets -- -D warnings/);

    assert.match(workflow, /rust-tests:/);
    assert.match(workflow, /name:\s*Rust Tests \+ Coverage Signal/);
    assert.match(workflow, /components:\s*llvm-tools-preview/);
    assert.match(workflow, /taiki-e\/install-action@cargo-llvm-cov/);
    assert.match(workflow, /cargo llvm-cov --workspace --summary-only/);
    assert.match(workflow, /cargo llvm-cov --manifest-path crates\/omx-sparkshell\/Cargo\.toml --summary-only/);
    assert.match(workflow, /cat coverage\/rust\/omx-sparkshell-summary\.txt/);
    assert.doesNotMatch(rustTestsJob, /--lcov|output-path|Upload Rust coverage artifact/);

    assert.match(
      workflow,
      /build:\s*\n(?:.*\n)*?\s+- name: Setup Rust\s*\n\s+uses: dtolnay\/rust-toolchain@v1\s*\n\s+with:\s*\n\s+toolchain: stable(?:.*\n)*?\s+- name: Download prebuilt dist artifact\s*\n\s+uses: actions\/download-artifact@v8(?:.*\n)*?\s+- run: npm run build:explore:release(?:.*\n)*?\s+- run: npm run build:sparkshell/m,
    );
  });

  it('reuses a prebuilt dist artifact only on the gated lanes that can overlap prerequisite work', () => {
    const workflow = readCiWorkflow();
    const testJob = jobBlock(workflow, 'test');

    assert.match(workflow, /build-dist:/);
    assert.match(workflow, /name:\s*Build dist artifact/);
    assert.match(workflow, /name:\s*Upload prebuilt dist artifact/);
    assert.match(workflow, /name:\s*ci-dist-node20/);
    assert.match(workflow, /^  coverage-team-critical:\s*\n(?:.*\n)*?^\s+needs:\s*\[build-dist\]/m);
    assert.match(workflow, /^  ralph-persistence-gate:\s*\n(?:.*\n)*?^\s+needs:\s*\[build-dist\]/m);
    assert.match(workflow, /^  build:\s*\n(?:.*\n)*?^\s+needs:\s*\[build-dist\]/m);

    for (const jobName of ['test', 'coverage-team-critical', 'ralph-persistence-gate', 'build']) {
      assert.match(
        workflow,
        new RegExp(`^  ${jobName}:\\s*\\n(?:.*\\n)*?^\\s+- name:\\s*Download prebuilt dist artifact\\s*\\n\\s+uses:\\s*actions/download-artifact@v8`, 'm'),
      );
    }

    assert.match(
      testJob,
      /^\s+- name:\s*Download prebuilt dist artifact\s*\n\s+uses:\s*actions\/download-artifact@v8(?:.*\n)*?\s+path:\s*dist/m,
    );
    assert.match(testJob, /^\s+- name:\s*Run grouped full-suite lane\s*\n(?:.*\n)*?^\s+run:\s*\|\n\s+node dist\/scripts\/run-test-files\.js/m);
    assert.doesNotMatch(testJob, /^\s+npm run build$/m);
  });

  it('uses npm package caching without skipping clean dependency installs', () => {
    const workflow = readCiWorkflow();

    for (const jobName of ['lint', 'typecheck', 'build-dist', 'test', 'coverage-team-critical', 'ralph-persistence-gate', 'build']) {
      const job = jobBlock(workflow, jobName);

      assert.match(job, /uses:\s*actions\/setup-node@v6/);
      assert.match(job, /cache:\s*npm/);
      assert.match(job, /run:\s*npm ci/);
      assert.doesNotMatch(job, /uses:\s*actions\/cache@v4/);
      assert.doesNotMatch(job, /path:\s*node_modules/);
      assert.doesNotMatch(job, /cache-hit != 'true'/);
    }

    for (const jobName of ['clippy', 'rust-tests', 'build']) {
      assert.match(jobBlock(workflow, jobName), /uses:\s*Swatinem\/rust-cache@v2/);
    }

    assert.match(workflow, /needs:\s*\[rustfmt, clippy, rust-tests, lint, typecheck, test, coverage-team-critical, ralph-persistence-gate, build\]/);
  });

  it('avoids path-filtered CI triggers so required checks cannot be skipped into a pending state', () => {
    const workflow = readCiWorkflow();

    assert.match(workflow, /^on:\n  push:\n    branches: \[main, dev, experimental\/dev\]\n  pull_request:\n    branches: \[main, dev, experimental\/dev\]/m);
    assert.doesNotMatch(workflow, /^\s+paths:\s*/m);
    assert.doesNotMatch(workflow, /^\s+paths-ignore:\s*/m);
  });


  it('marks every required CI lane as required and reported in the CI status gate', () => {
    const workflow = readCiWorkflow();
    const ciStatusJob = jobBlock(workflow, 'ci-status');
    const requiredJobs = [
      'rustfmt',
      'clippy',
      'rust-tests',
      'lint',
      'typecheck',
      'test',
      'coverage-team-critical',
      'ralph-persistence-gate',
      'build',
    ];

    assert.match(
      ciStatusJob,
      /needs:\s*\[rustfmt, clippy, rust-tests, lint, typecheck, test, coverage-team-critical, ralph-persistence-gate, build\]/,
    );

    for (const jobName of requiredJobs) {
      assert.match(ciStatusJob, new RegExp(`needs\\.${jobName}\\.result`), `${jobName} result should be checked`);
      assert.match(
        ciStatusJob,
        new RegExp(`echo \"  ${jobName}: \\$\\{\\{ needs\\.${jobName}\\.result \\}\\}\"`),
        `${jobName} result should be reported`,
      );
    }
  });


  it('keeps expensive report-only coverage out of the required CI path', () => {
    const workflow = readCiWorkflow();

    assert.doesNotMatch(workflow, /^  coverage-ts-full:/m);
    assert.doesNotMatch(workflow, /needs\.coverage-ts-full\.result/);
  });

  it('runs typecheck once while retaining the Node 22 smoke lane for runtime coverage', () => {
    const workflow = readCiWorkflow();
    const typecheckJob = jobBlock(workflow, 'typecheck');
    const testJob = jobBlock(workflow, 'test');

    assert.doesNotMatch(typecheckJob, /matrix:/);
    assert.match(typecheckJob, /node-version:\s*20/);
    assert.match(testJob, /node-version:\s*22\n\s+lane:\s*smoke/);
  });

  it('adds timeout-minutes to every CI job so stalled Actions runs fail instead of hanging indefinitely', () => {
    const workflow = readCiWorkflow();

    for (const jobName of [
      'rustfmt',
      'clippy',
      'rust-tests',
      'lint',
      'typecheck',
      'build-dist',
      'test',
      'coverage-team-critical',
      'ralph-persistence-gate',
      'build',
      'ci-status',
    ]) {
      assert.match(
        workflow,
        new RegExp(`${jobName}:\\s*\\n(?:.*\\n)*?\\s+timeout-minutes:\\s*\\d+`, 'm'),
        `${jobName} should define timeout-minutes`,
      );
    }
  });

});
