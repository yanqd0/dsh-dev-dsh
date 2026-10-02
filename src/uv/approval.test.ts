import { describe, expect, it } from 'vitest';

import {
  ASK_AGENTLESS_NOTE,
  ASK_CANCELLED_NOTE,
  ASK_REJECTED_NOTE,
  ASK_TOOL_NAME,
  ASK_UNAVAILABLE_NOTE,
  askReason,
  createGrantStore,
  ensureAskAllowed,
} from './approval.js';
import type { AskContext } from './approval.js';
import type { ApprovalOutcomeLike, ApprovalRequestLike } from './types.js';
import type { AskMatch } from './policy.js';

const CLASS: AskMatch = { id: 'cache-prune', reason: 'uv cache prune：删除未使用的缓存' };
const OTHER: AskMatch = { id: 'publish', reason: 'uv publish：上传' };

interface Port {
  calls: ApprovalRequestLike[];
  outcome: ApprovalOutcomeLike;
}

/** An approval port that records every ask and returns a fixed outcome. */
function port(outcome: ApprovalOutcomeLike = 'allowed-once'): Port {
  const state: Port = { calls: [], outcome };
  return state;
}

/** A full ask context with per-test overrides. */
function context(overrides: Partial<AskContext> & { port?: Port } = {}): AskContext & { port?: Port } {
  const approvalPort = overrides.port;
  const base: AskContext = {
    approval:
      approvalPort === undefined
        ? undefined
        : {
            request: (request) => {
              approvalPort.calls.push(request);
              return Promise.resolve(approvalPort.outcome);
            },
          },
    agent: { session: { id: 'session-1', header: { cwd: '/workspace' } } },
    sessionId: 'session-1',
    callId: 'call-1',
    signal: undefined,
    matches: [CLASS],
    autoApprove: false,
    grant: 'session',
    store: createGrantStore(),
  };
  return { ...base, ...overrides };
}

describe('ensureAskAllowed', () => {
  it('allows anything with no matched class, without touching approval', async () => {
    const state = port();
    const decision = await ensureAskAllowed(context({ matches: [], port: state }));
    expect(decision).toEqual({ allowed: true });
    expect(state.calls).toHaveLength(0);
  });

  it('skips the prompt under autoApprove and says so', async () => {
    const state = port();
    const decision = await ensureAskAllowed(context({ autoApprove: true, port: state }));
    expect(decision.allowed).toBe(true);
    expect(decision.note).toContain('autoApprove');
    expect(decision.note).toContain('cache-prune');
    expect(state.calls).toHaveLength(0);
  });

  it('fails closed without an approval channel', async () => {
    const decision = await ensureAskAllowed(context({ approval: undefined }));
    expect(decision).toEqual({ allowed: false, note: ASK_UNAVAILABLE_NOTE });
  });

  it('fails closed without an agent to ask', async () => {
    const decision = await ensureAskAllowed(context({ agent: undefined, port: port() }));
    expect(decision).toEqual({ allowed: false, note: ASK_AGENTLESS_NOTE });
  });

  it('asks once, then remembers the grant for the session', async () => {
    const state = port();
    const store = createGrantStore();
    const ask = context({ port: state, store });
    expect(await ensureAskAllowed(ask)).toEqual({ allowed: true });
    expect(state.calls).toHaveLength(1);
    expect(await ensureAskAllowed(ask)).toEqual({ allowed: true });
    expect(state.calls).toHaveLength(1);
    // A different session starts over.
    expect(await ensureAskAllowed({ ...ask, sessionId: 'session-2' })).toEqual({ allowed: true });
    expect(state.calls).toHaveLength(2);
  });

  it('asks every time when the grant kind is per call', async () => {
    const state = port();
    const ask = context({ port: state, grant: 'call' });
    await ensureAskAllowed(ask);
    await ensureAskAllowed(ask);
    expect(state.calls).toHaveLength(2);
  });

  it('asks again when the grant has no session key to remember', async () => {
    const state = port();
    const ask = context({ port: state, sessionId: undefined });
    await ensureAskAllowed(ask);
    await ensureAskAllowed(ask);
    expect(state.calls).toHaveLength(2);
  });

  it('only asks about classes still pending', async () => {
    const state = port();
    const store = createGrantStore();
    store.add('session-1', CLASS.id);
    const decision = await ensureAskAllowed(
      context({ port: state, store, matches: [CLASS, OTHER] })
    );
    expect(decision.allowed).toBe(true);
    expect(state.calls[0]?.reason).toContain('publish');
    expect(state.calls[0]?.reason).not.toContain('cache prune');
    // Both classes are granted once the ask is allowed.
    expect(store.has('session-1', OTHER.id)).toBe(true);
  });

  it('carries identity, reason, and signal onto the request', async () => {
    const state = port();
    const signal = new AbortController().signal;
    await ensureAskAllowed(context({ port: state, signal }));
    const request = state.calls[0];
    expect(request?.toolName).toBe(ASK_TOOL_NAME);
    expect(request?.callId).toBe('call-1');
    expect(request?.signal).toBe(signal);
    expect(request?.reason).toContain('uv cache prune');
    expect(request?.agent).toEqual({ session: { id: 'session-1', header: { cwd: '/workspace' } } });
  });

  it('omits callId and signal when the execution has none', async () => {
    const state = port();
    await ensureAskAllowed(context({ port: state, callId: undefined, signal: undefined }));
    expect(Object.keys(state.calls[0] ?? {}).sort()).toEqual(['agent', 'reason', 'toolName']);
  });

  it('maps rejection and cancellation to distinct refusals', async () => {
    const rejected = await ensureAskAllowed(context({ port: port('rejected') }));
    expect(rejected).toEqual({ allowed: false, note: ASK_REJECTED_NOTE });
    const cancelled = await ensureAskAllowed(context({ port: port('cancelled') }));
    expect(cancelled).toEqual({ allowed: false, note: ASK_CANCELLED_NOTE });
    const unavailable = await ensureAskAllowed(context({ port: port('unavailable') }));
    expect(unavailable).toEqual({ allowed: false, note: ASK_REJECTED_NOTE });
  });
});

describe('createGrantStore', () => {
  it('remembers per session and class', () => {
    const store = createGrantStore();
    store.add('a', 'publish');
    expect(store.has('a', 'publish')).toBe(true);
    expect(store.has('a', 'auth')).toBe(false);
    expect(store.has('b', 'publish')).toBe(false);
  });

  it('evicts the oldest session past the cap', () => {
    const store = createGrantStore(2);
    store.add('a', 'publish');
    store.add('b', 'publish');
    store.add('c', 'publish');
    expect(store.has('a', 'publish')).toBe(false);
    expect(store.has('b', 'publish')).toBe(true);
    expect(store.has('c', 'publish')).toBe(true);
  });

  it('keeps adding to an existing session without evicting', () => {
    const store = createGrantStore(1);
    store.add('a', 'publish');
    store.add('a', 'auth');
    expect(store.has('a', 'auth')).toBe(true);
  });
});

describe('askReason', () => {
  it('lists every class reason with the shared prefix and suffix', () => {
    const reason = askReason([CLASS, OTHER]);
    expect(reason).toContain('不受会话文件沙箱约束');
    expect(reason).toContain('uv cache prune');
    expect(reason).toContain('uv publish');
    expect(reason).toContain('允许本次执行');
  });
});
