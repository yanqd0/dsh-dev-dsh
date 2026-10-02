import { describe, expect, it, vi } from 'vitest';

import { UvConfigSchema } from './config.js';
import type { UvConfig } from './config.js';
import {
  UV_TOOL_DESCRIPTION,
  UV_TOOL_NAME,
  buildUvEnv,
  effectiveTimeout,
  installUvTool,
  parseUvToolArgs,
  renderUvOutcome,
} from './tool.js';
import type {
  ApprovalLike,
  DshContextLike,
  SubprocessSpawnSpecLike,
  ToolDefinitionLike,
  ToolExecutionLike,
} from './types.js';

/** Config with production defaults, enabled so the tool registers. */
function config(overrides: Partial<UvConfig> = {}): UvConfig {
  return { ...UvConfigSchema.parse({ enabled: true }), ...overrides };
}

interface Captured {
  definitions: ToolDefinitionLike[];
  specs: SubprocessSpawnSpecLike[];
  reasons: (string | undefined)[];
}

interface FakeInit {
  approval?: boolean;
  registerThrows?: boolean;
  outcome?: [number | null, string | null];
}

/** A scope whose services record what the tool does. */
function scope(init: FakeInit = {}): Captured & { ctx: DshContextLike } {
  const captured: Captured = { definitions: [], specs: [], reasons: [] };
  const tools = {
    register: (definition: ToolDefinitionLike): (() => void) => {
      if (init.registerThrows === true) {
        throw new Error('tool "uv" is already registered');
      }
      captured.definitions.push(definition);
      return () => {};
    },
  };
  const subprocess = {
    resolveExecutable: (command: string): Promise<string> => Promise.resolve(`/resolved/${command}`),
    spawn: (spec: SubprocessSpawnSpecLike) => {
      captured.specs.push(spec);
      const [exitCode, signal] = init.outcome ?? [0, null];
      return {
        collected: {
          stdout: {
            readFrom: (from: number) => ({ text: 'done', nextOffset: from + 4, lossy: false }),
          },
          stderr: { readFrom: (from: number) => ({ text: '', nextOffset: from, lossy: false }) },
        },
        done: Promise.resolve({ exitCode, signal }),
        terminate: (): void => {},
      };
    },
  };
  const approval: ApprovalLike | undefined =
    init.approval === false
      ? undefined
      : {
          request: (request) => {
            captured.reasons.push(request.reason);
            return Promise.resolve('allowed-once');
          },
        };
  const services: Record<string, unknown> = { tools, subprocess };
  if (approval !== undefined) {
    services.approval = approval;
  }
  return {
    ...captured,
    ctx: { get: (name: string): unknown => services[name], inject: (): unknown => undefined },
  };
}

/** A tool execution bound to a session cwd. */
function exec(overrides: Partial<ToolExecutionLike> = {}): ToolExecutionLike {
  return {
    callId: 'call-1',
    agent: { session: { id: 'session-1', header: { cwd: '/workspace/project' } } },
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** The notes of a tool value, whatever the caller's return type says. */
function notesOf(value: unknown): string[] {
  const record = value as { notes?: unknown };
  return Array.isArray(record?.notes) ? (record.notes as string[]) : [];
}

describe('parseUvToolArgs', () => {
  it('accepts the documented shape', () => {
    expect(parseUvToolArgs({ args: ['sync'], cwd: 'sub', timeoutMs: 1000 })).toEqual({
      ok: true,
      value: { args: ['sync'], cwd: 'sub', timeoutMs: 1000 },
    });
  });

  it('accepts args alone', () => {
    expect(parseUvToolArgs({ args: ['--version'] })).toEqual({
      ok: true,
      value: { args: ['--version'], cwd: undefined, timeoutMs: undefined },
    });
  });

  it.each<[unknown, string]>([
    [undefined, '字符串数组'],
    [{}, '字符串数组'],
    [{ args: 'sync' }, '字符串数组'],
    [{ args: ['sync', 1] }, '字符串数组'],
    [{ args: [] }, '为空'],
    [{ args: ['sync'], cwd: 1 }, 'cwd'],
    [{ args: ['sync'], timeoutMs: 0 }, 'timeoutMs'],
    [{ args: ['sync'], timeoutMs: Number.NaN }, 'timeoutMs'],
  ])('rejects %j', (raw, fragment) => {
    const parsed = parseUvToolArgs(raw);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.error).toContain(fragment);
  });
});

describe('renderUvOutcome', () => {
  it('renders stdout alone', () => {
    expect(
      renderUvOutcome({ ok: true, exitCode: 0, stdout: 'out\n', stderr: '', notes: [] })
    ).toBe('out');
  });

  it('adds a marked stderr section and the marker lines', () => {
    expect(
      renderUvOutcome({
        ok: false,
        exitCode: 2,
        stdout: 'out',
        stderr: 'err\n',
        notes: ['[exit code: 2]'],
      })
    ).toBe('out\n[stderr]\nerr\n[exit code: 2]');
  });

  it('falls back to a no-output marker', () => {
    expect(renderUvOutcome({ stdout: '', stderr: '', notes: [] })).toBe('(no output)');
    expect(renderUvOutcome(undefined)).toBe('(no output)');
  });

  it('keeps non-string notes out of the text', () => {
    expect(renderUvOutcome({ notes: ['kept', 42, null] })).toBe('kept');
  });

  it('tolerates a non-object value', () => {
    expect(renderUvOutcome('nope')).toBe('(no output)');
  });
});

describe('buildUvEnv', () => {
  it('forwards named ambient entries and applies explicit overrides', () => {
    const env = buildUvEnv(
      config({ passEnv: ['UV_INDEX_URL', 'MISSING'], env: { UV_INDEX_URL: 'x' } }),
      { UV_INDEX_URL: 'ambient', OTHER: 'ignored' }
    );
    expect(env).toEqual({ UV_INDEX_URL: 'x' });
  });

  it('skips ambient entries that are not set', () => {
    expect(buildUvEnv(config({ passEnv: ['NOPE'] }), {})).toEqual({});
  });
});

describe('effectiveTimeout', () => {
  it('defaults to the configured deadline and clamps per-call overrides', () => {
    const cfg = config({ timeoutMs: 600_000, maxTimeoutMs: 1_000 });
    expect(effectiveTimeout(undefined, cfg)).toBe(600_000);
    expect(effectiveTimeout(500, cfg)).toBe(500);
    expect(effectiveTimeout(9_999, cfg)).toBe(1_000);
  });
});

describe('installUvTool', () => {
  it('registers a definition the registry will accept', () => {
    const fake = scope();
    expect(installUvTool(fake.ctx, config())).toEqual({ ok: true });
    const definition = fake.definitions[0];
    expect(definition?.name).toBe(UV_TOOL_NAME);
    expect(definition?.description).toBe(UV_TOOL_DESCRIPTION);
    expect(definition?.parameters).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['args'],
    });
    expect(definition?.output.schema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(
      definition?.output.render(undefined, {
        ok: true,
        exitCode: 0,
        stdout: 'hi',
        stderr: '',
        notes: [],
      })
    ).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('reports missing services instead of throwing', () => {
    const ctx: DshContextLike = { get: () => undefined, inject: () => undefined };
    expect(installUvTool(ctx, config())).toEqual({
      ok: false,
      reason: 'tools 或 subprocess 服务不可用',
    });
  });

  it('degrades a duplicate tool name to one log line', () => {
    const fake = scope({ registerThrows: true });
    const log = vi.fn();
    expect(installUvTool(fake.ctx, config(), log)).toEqual({
      ok: false,
      reason: 'tool "uv" is already registered',
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('uv 工具注册失败'));
  });
});

describe('the uv tool body', () => {
  /** Install on a fresh scope and return its definition. */
  function tool(init: FakeInit = {}, overrides: Partial<UvConfig> = {}) {
    const fake = scope(init);
    installUvTool(fake.ctx, config(overrides));
    const definition = fake.definitions[0];
    if (definition === undefined) {
      throw new Error('the tool did not register');
    }
    return { fake, definition };
  }

  it('runs a safe invocation in the session directory, zero approval', async () => {
    const { fake, definition } = tool();
    const value = await definition.execute({ args: ['sync'] }, exec());
    expect(fake.reasons).toHaveLength(0);
    expect(fake.specs[0]?.argv).toEqual(['/resolved/uv', 'sync']);
    expect(fake.specs[0]?.cwd).toBe('/workspace/project');
    expect(value).toMatchObject({ ok: true, stdout: 'done' });
  });

  it('honours a relative cwd argument', async () => {
    const { fake, definition } = tool();
    await definition.execute({ args: ['sync'], cwd: 'sub' }, exec());
    expect(fake.specs[0]?.cwd).toBe('/workspace/project/sub');
  });

  it('asks before a risky class, then runs it', async () => {
    const { fake, definition } = tool();
    await definition.execute({ args: ['cache', 'prune'] }, exec());
    expect(fake.reasons).toHaveLength(1);
    expect(fake.reasons[0]).toContain('cache prune');
    expect(fake.specs).toHaveLength(1);
  });

  it('asks before writing outside the session directory', async () => {
    const { fake, definition } = tool();
    await definition.execute({ args: ['sync'], cwd: '/elsewhere' }, exec());
    expect(fake.reasons).toHaveLength(1);
    expect(fake.reasons[0]).toContain('/elsewhere');
  });

  it('refuses risky calls when the composition has no approval channel', async () => {
    const { fake, definition } = tool({ approval: false });
    const value = await definition.execute({ args: ['publish'] }, exec());
    expect(fake.specs).toHaveLength(0);
    expect(notesOf(value)[0]).toContain('没有可用的审批通道');
  });

  it('remembers one grant per session and class', async () => {
    const { fake, definition } = tool();
    await definition.execute({ args: ['cache', 'prune'] }, exec());
    await definition.execute({ args: ['cache', 'prune'] }, exec());
    expect(fake.reasons).toHaveLength(1);
    await definition.execute(
      { args: ['cache', 'prune'] },
      exec({ agent: { session: { id: 's2', header: { cwd: '/workspace/project' } } } })
    );
    expect(fake.reasons).toHaveLength(2);
  });

  it('skips the prompt under autoApprove and says so first', async () => {
    const { fake, definition } = tool({}, { autoApprove: true });
    const value = await definition.execute({ args: ['publish'] }, exec());
    expect(fake.reasons).toHaveLength(0);
    expect(fake.specs).toHaveLength(1);
    expect(notesOf(value)[0]).toContain('autoApprove');
  });

  it('refuses malformed arguments without spawning', async () => {
    const { fake, definition } = tool();
    const value = await definition.execute({}, exec());
    expect(fake.specs).toHaveLength(0);
    expect(notesOf(value)[0]).toContain('字符串数组');
  });

  it('falls back to the process cwd when the execution has no agent', async () => {
    const { fake, definition } = tool();
    await definition.execute({ args: ['sync'] }, { callId: 'call-2' });
    expect(fake.specs[0]?.cwd).toBe(process.cwd());
  });

  it('passes a nonzero exit through as a marker', async () => {
    const { definition } = tool({ outcome: [3, null] });
    const value = (await definition.execute({ args: ['sync'] }, exec())) as {
      ok: boolean;
      exitCode: number;
      notes: string[];
    };
    expect(value.ok).toBe(false);
    expect(value.exitCode).toBe(3);
    expect(value.notes).toEqual(['[exit code: 3]']);
  });
});
