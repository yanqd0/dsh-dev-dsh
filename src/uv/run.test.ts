import { afterEach, describe, expect, it, vi } from 'vitest';

import { UV_ENTRY_HINT } from './entry.js';
import { DEFAULT_GRACE_MS, runUv } from './run.js';
import type { UvRunRequest } from './run.js';
import type {
  SubprocessHandleLike,
  SubprocessLike,
  SubprocessOutputReadLike,
  SubprocessSpawnSpecLike,
} from './types.js';

/** One collected stream as the fake handle reports it. */
interface FakeStream {
  text: string;
  lossy?: boolean;
  spillPath?: string;
}

interface FakeInit {
  executable?: string;
  /** Reject executable resolution instead of resolving it. */
  resolveError?: Error;
  outcome?: { exitCode: number | null; signal: string | null };
  /** Reject `done` instead of resolving it. */
  rejectDone?: boolean;
  spawnThrow?: Error;
  stdout?: FakeStream;
  stderr?: FakeStream;
  /** Resolve `done` manually (timeout / abort tests). */
  deferred?: boolean;
  onSpawn?: (spec: SubprocessSpawnSpecLike) => void;
}

/** A recording fake of the host subprocess service. */
function fakeSubprocess(init: FakeInit = {}): {
  subprocess: SubprocessLike;
  resolve: ReturnType<typeof vi.fn>;
  specs: SubprocessSpawnSpecLike[];
  reads: number[];
  terminate: ReturnType<typeof vi.fn>;
  settle: (outcome: { exitCode: number | null; signal: string | null }) => void;
} {
  const specs: SubprocessSpawnSpecLike[] = [];
  const terminate = vi.fn();
  const reads: number[] = [];
  let settleDone: (outcome: { exitCode: number | null; signal: string | null }) => void = () => {};
  const deferredDone = new Promise<{ exitCode: number | null; signal: string | null }>(
    (resolve) => {
      settleDone = resolve;
    }
  );
  const reader = (
    stream: FakeStream
  ): { readFrom: (from: number) => SubprocessOutputReadLike } => ({
    readFrom: (from: number): SubprocessOutputReadLike => {
      reads.push(from);
      return {
        text: stream.text,
        nextOffset: from + stream.text.length,
        lossy: stream.lossy === true,
        ...(stream.spillPath !== undefined ? { spillPath: stream.spillPath } : {}),
      };
    },
  });
  const resolve = vi.fn((command: string): Promise<string> =>
    init.resolveError !== undefined
      ? Promise.reject(init.resolveError)
      : Promise.resolve(init.executable ?? `/resolved/${command}`)
  );
  const subprocess: SubprocessLike = {
    resolveExecutable: resolve,
    spawn: (spec: SubprocessSpawnSpecLike): SubprocessHandleLike => {
      specs.push(spec);
      if (init.spawnThrow !== undefined) {
        throw init.spawnThrow;
      }
      init.onSpawn?.(spec);
      return {
        collected: {
          stdout: reader(init.stdout ?? { text: '' }),
          stderr: reader(init.stderr ?? { text: '' }),
        },
        done:
          init.deferred === true
            ? deferredDone
            : init.rejectDone === true
              ? Promise.reject(new Error('provider failed'))
              : Promise.resolve(init.outcome ?? { exitCode: 0, signal: null }),
        terminate,
      };
    },
  };
  return { subprocess, resolve, specs, reads, terminate, settle: (outcome) => settleDone(outcome) };
}

/** A request with per-test overrides. */
function request(overrides: Partial<UvRunRequest> = {}): UvRunRequest {
  return {
    subprocess: fakeSubprocess().subprocess,
    entry: undefined,
    args: ['sync'],
    cwd: '/workspace/project',
    timeoutMs: 30_000,
    maxOutputBytes: 1024,
    maxSpillBytes: 4096,
    env: { UV_CACHE_DIR: '/tmp/uv-cache' },
    signal: new AbortController().signal,
    ...overrides,
  };
}

/**
 * Let `runUv`'s `resolveExecutable` continuation run: the fake resolves on the
 * next microtask, and the spawn happens right after it.
 */
async function spawned(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('runUv: spawning', () => {
  it('resolves the executable and spawns argv without a leading uv token', async () => {
    const fake = fakeSubprocess({ stdout: { text: 'ok\n' } });
    const result = await runUv(
      request({ subprocess: fake.subprocess, args: ['uv', 'sync'], entry: 'uv' })
    );
    expect(result).toEqual({ ok: true, exitCode: 0, stdout: 'ok\n', stderr: '', notes: [] });
    expect(fake.specs[0]?.argv).toEqual(['/resolved/uv', 'sync']);
    expect(fake.specs[0]?.cwd).toBe('/workspace/project');
    expect(fake.specs[0]?.graceMs).toBe(DEFAULT_GRACE_MS);
    expect(fake.specs[0]?.stdio.stdin).toBe('ignore');
    expect(fake.specs[0]?.stdio.stdout).toEqual({ maxBytes: 1024, spill: { maxBytes: 4096 } });
    expect(fake.specs[0]?.stdio.stderr).toEqual({ maxBytes: 1024, spill: { maxBytes: 4096 } });
    expect(fake.specs[0]?.env).toEqual({ UV_CACHE_DIR: '/tmp/uv-cache' });
  });

  it('spawns a path entry verbatim instead of resolving it on PATH', async () => {
    const fake = fakeSubprocess();
    await runUv(request({ subprocess: fake.subprocess, entry: process.execPath }));
    expect(fake.specs[0]?.argv[0]).toBe(process.execPath);
    expect(fake.resolve).not.toHaveBeenCalled();
  });

  it('reports a missing path entry with the actionable hint', async () => {
    const fake = fakeSubprocess();
    const result = await runUv(request({ subprocess: fake.subprocess, entry: '/nope/uv' }));
    expect(fake.specs).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(-1);
    expect(result.notes.join('\n')).toContain(UV_ENTRY_HINT);
  });

  it('reports an unresolvable bare entry with the actionable hint', async () => {
    const fake = fakeSubprocess({ resolveError: new Error('not found') });
    const result = await runUv(request({ subprocess: fake.subprocess }));
    expect(result.ok).toBe(false);
    expect(result.notes.join('\n')).toContain('无法解析 uv 可执行文件');
    expect(result.notes.join('\n')).toContain(UV_ENTRY_HINT);
  });

  it('reports a synchronous spawn failure', async () => {
    const fake = fakeSubprocess({ spawnThrow: new Error('spawn denied') });
    const result = await runUv(request({ subprocess: fake.subprocess }));
    expect(result.ok).toBe(false);
    expect(result.notes[0]).toContain('子进程未启动');
    expect(result.notes[0]).toContain('spawn denied');
  });

  it('reports a provider rejection', async () => {
    const fake = fakeSubprocess({ rejectDone: true });
    const result = await runUv(request({ subprocess: fake.subprocess }));
    expect(result.ok).toBe(false);
    expect(result.notes[0]).toContain('子进程未报告结果');
  });
});

describe('runUv: outcomes', () => {
  it('reports a nonzero exit last and keeps both streams', async () => {
    const fake = fakeSubprocess({
      outcome: { exitCode: 2, signal: null },
      stdout: { text: 'out' },
      stderr: { text: 'err' },
    });
    const result = await runUv(request({ subprocess: fake.subprocess }));
    expect(result).toEqual({
      ok: false,
      exitCode: 2,
      stdout: 'out',
      stderr: 'err',
      notes: ['[exit code: 2]'],
    });
  });

  it('reports a signal kill instead of an exit code', async () => {
    const fake = fakeSubprocess({ outcome: { exitCode: null, signal: 'SIGTERM' } });
    const result = await runUv(request({ subprocess: fake.subprocess }));
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(-1);
    expect(result.notes).toEqual(['[killed by signal: SIGTERM]']);
  });

  it('marks a truncated stream with its spill path', async () => {
    const fake = fakeSubprocess({
      stdout: { text: 'tail', lossy: true, spillPath: '/tmp/spill-out' },
      stderr: { text: 'err', lossy: true },
    });
    const result = await runUv(request({ subprocess: fake.subprocess }));
    expect(result.stdout).toBe('tail\n[output truncated; full output: /tmp/spill-out]');
    expect(result.stderr).toBe('err\n[output truncated; full output: (unavailable)]');
  });
});

describe('runUv: deadlines and cancellation', () => {
  it('aborts and terminates when the deadline fires', async () => {
    vi.useFakeTimers();
    const fake = fakeSubprocess({ deferred: true });
    const run = runUv(request({ subprocess: fake.subprocess, timeoutMs: 1000 }));
    await spawned();
    expect(fake.specs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    fake.settle({ exitCode: 0, signal: null });
    const result = await run;
    expect(fake.specs[0]?.signal?.aborted).toBe(true);
    expect(fake.terminate).toHaveBeenCalledTimes(1);
    expect(result.notes).toEqual(['[timed out after 1000ms]']);
    expect(result.ok).toBe(false);
  });

  it('refuses to spawn for an already-aborted call', async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = fakeSubprocess();
    const result = await runUv(request({ subprocess: fake.subprocess, signal: controller.signal }));
    expect(fake.specs).toHaveLength(0);
    expect(result.notes).toEqual(['[stopped: tool call aborted]']);
  });

  it('reports a mid-run cancellation and the kill that follows', async () => {
    const controller = new AbortController();
    const fake = fakeSubprocess({ deferred: true });
    const run = runUv(request({ subprocess: fake.subprocess, signal: controller.signal }));
    await spawned();
    expect(fake.specs).toHaveLength(1);
    controller.abort();
    fake.settle({ exitCode: null, signal: 'SIGKILL' });
    const result = await run;
    expect(result.notes).toEqual(['[stopped: tool call aborted]', '[killed by signal: SIGKILL]']);
  });
});

describe('runUv: collected output access', () => {
  it('reads both streams from the whole-stream start', async () => {
    const fake = fakeSubprocess({ stdout: { text: 'a' }, stderr: { text: 'b' } });
    const result = await runUv(request({ subprocess: fake.subprocess }));
    expect(fake.reads).toEqual([0, 0]);
    expect(result.stdout).toBe('a');
    expect(result.stderr).toBe('b');
  });

  it('tolerates a provider that drops a collected stream', async () => {
    const fake = fakeSubprocess();
    fake.subprocess.spawn = (): SubprocessHandleLike => ({
      collected: {},
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate: (): void => {},
    });
    const result = await runUv(request({ subprocess: fake.subprocess }));
    expect(result).toEqual({ ok: true, exitCode: 0, stdout: '', stderr: '', notes: [] });
  });
});
