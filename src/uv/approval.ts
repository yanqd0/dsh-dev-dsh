/**
 * The consent gate for risky `uv` invocations.
 *
 * The tool runs uv outside the session file sandbox, so the classes `policy.ts`
 * flags are the only place a human gets to say no. Consent is asked through the
 * host approval seam (`ctx.approval.request`), which writes the durable
 * `approval/asked` + `approval/decided` pair to the session log — the same
 * evidence channel the bash escalation flow uses.
 *
 * Two deliberate properties:
 *
 * - **Fail closed.** No approval service, no agent, or an `unavailable`
 *   outcome all mean "do not run": without an answerer the host cannot obtain
 *   consent, and the tool refuses with the exact fallback (bash + the ordinary
 *   escalation flow, or `uv.autoApprove` as an explicit trust switch).
 * - **Once per session per class.** A grant is remembered by
 *   `sessionId + classId`, mirroring dsh-mint's B-v2 escalation memory: the
 *   first `uv tool install` in a session asks, the rest do not. `grant: 'call'`
 *   removes the memory entirely; `autoApprove: true` skips the prompt and says
 *   so in a note, so the bypass stays visible in the transcript.
 */

import type { AgentLike, ApprovalLike, ApprovalOutcomeLike } from './types.js';
import type { AskMatch } from './policy.js';

/** The tool name recorded on the approval audit pair. */
export const ASK_TOOL_NAME = 'uv';

/** `session` remembers one grant per class for the session; `call` never does. */
export type GrantKind = 'session' | 'call';

/** Remembers which ask classes a session has already consented to. */
export interface GrantStore {
  has(sessionId: string, classId: string): boolean;
  add(sessionId: string, classId: string): void;
}

/** User-facing prefix for every approval reason this tool raises. */
export const ASK_REASON_PREFIX = 'uv 工具（不受会话文件沙箱约束）请求执行受限操作：';

/** User-facing suffix naming the fallback when the request is declined. */
export const ASK_REASON_SUFFIX = '。允许本次执行？（拒绝后请改用 bash 并走常规提权审批）';

export const ASK_UNAVAILABLE_NOTE =
  '[uv] 未执行：本次调用需要审批，但当前组合没有可用的审批通道。' +
  '请改用 bash 并走常规提权审批，或在挂载行设置 uv.autoApprove: true 明确信任该工具。';

export const ASK_AGENTLESS_NOTE =
  '[uv] 未执行：本次调用需要审批，但它不在可询问的用户会话上下文里（缺少 agent）。' +
  '请改用 bash 并走常规提权审批。';

export const ASK_REJECTED_NOTE = '[uv] 未执行：用户拒绝了本次受限操作。';

export const ASK_CANCELLED_NOTE = '[uv] 未执行：审批请求已取消。';

/**
 * A bounded session → granted-class store.
 *
 * Bounded because a long-lived harness serves many sessions; eviction is
 * insertion-ordered, and a false eviction only costs one extra prompt.
 *
 * @param limit - maximum remembered sessions.
 * @returns the store.
 */
export function createGrantStore(limit = 256): GrantStore {
  const sessions = new Map<string, Set<string>>();
  return {
    has(sessionId: string, classId: string): boolean {
      return sessions.get(sessionId)?.has(classId) === true;
    },
    add(sessionId: string, classId: string): void {
      let granted = sessions.get(sessionId);
      if (granted === undefined) {
        if (sessions.size >= limit) {
          const oldest = sessions.keys().next().value;
          if (oldest !== undefined) {
            sessions.delete(oldest);
          }
        }
        granted = new Set<string>();
        sessions.set(sessionId, granted);
      }
      granted.add(classId);
    },
  };
}

/** Everything the gate needs from one tool execution. */
export interface AskContext {
  /** The approval service, when the composition mounts one. */
  readonly approval: ApprovalLike | undefined;
  readonly agent: AgentLike | undefined;
  readonly sessionId: string | undefined;
  readonly callId: string | undefined;
  readonly signal: AbortSignal | undefined;
  /** Classes this invocation matched; empty means nothing to ask about. */
  readonly matches: readonly AskMatch[];
  readonly autoApprove: boolean;
  readonly grant: GrantKind;
  readonly store: GrantStore;
}

/** The gate's verdict: run the command, or return `note` as the result. */
export interface AskDecision {
  readonly allowed: boolean;
  readonly note?: string | undefined;
}

/** The approval reason text for one prompt covering every pending class. */
export function askReason(matches: readonly AskMatch[]): string {
  return `${ASK_REASON_PREFIX}${matches.map((match) => match.reason).join('；')}${ASK_REASON_SUFFIX}`;
}

/**
 * Decide whether a matched invocation may run.
 *
 * @param input - the services, the execution identity, and the matched classes.
 * @returns `allowed` plus an optional explanatory note for the model.
 */
export async function ensureAskAllowed(input: AskContext): Promise<AskDecision> {
  const { matches } = input;
  if (matches.length === 0) {
    return { allowed: true };
  }
  if (input.autoApprove) {
    return {
      allowed: true,
      note: `[uv] autoApprove 已放行受限操作：${matches.map((match) => match.id).join('、')}`,
    };
  }
  // `grant: 'call'` (and an agentless ask with no session key) never remembers.
  const sessionId = input.grant === 'session' ? input.sessionId : undefined;
  const pending =
    sessionId === undefined
      ? [...matches]
      : matches.filter((match) => !input.store.has(sessionId, match.id));
  if (pending.length === 0) {
    return { allowed: true };
  }
  if (input.approval === undefined) {
    return { allowed: false, note: ASK_UNAVAILABLE_NOTE };
  }
  if (input.agent === undefined) {
    return { allowed: false, note: ASK_AGENTLESS_NOTE };
  }
  const outcome: ApprovalOutcomeLike = await input.approval.request({
    agent: input.agent,
    toolName: ASK_TOOL_NAME,
    ...(input.callId !== undefined ? { callId: input.callId } : {}),
    reason: askReason(pending),
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
  });
  if (outcome === 'allowed-once') {
    if (sessionId !== undefined) {
      for (const match of pending) {
        input.store.add(sessionId, match.id);
      }
    }
    return { allowed: true };
  }
  if (outcome === 'cancelled') {
    return { allowed: false, note: ASK_CANCELLED_NOTE };
  }
  return { allowed: false, note: ASK_REJECTED_NOTE };
}
