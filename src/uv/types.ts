/**
 * Minimal structural types for the DSH host contracts the `uv` submodule uses.
 *
 * Deliberately no `@deepseek-ai/*` imports: this package must stay buildable and
 * installable outside the harness monorepo, so these are structural
 * approximations of what we *consume* (the host accepts wider objects). Keep
 * them in sync with the live host through the runtime probes the skill
 * documents, not by guessing.
 */

/** Subset of a host text content block. */
export interface ContentBlockLike {
  type: 'text';
  text: string;
}

/**
 * Subset of the host `Agent` as a tool body receives it.
 *
 * Both fields are optional on purpose: a nested/PTC dispatch may carry no agent
 * at all, and an agentless call cannot be asked for approval — the submodule
 * fails closed instead of guessing a session.
 */
export interface AgentLike {
  session?: { id?: string; header?: { cwd?: string } } | undefined;
}

/** Subset of the host's `ToolRunContext` handed to a tool body. */
export interface ToolExecutionLike {
  /** Opaque call identity, used to attach an approval ask to its tool call. */
  readonly callId?: string | undefined;
  readonly agent?: AgentLike | undefined;
  /** Parsed model arguments; validated by the registry before the body runs. */
  readonly arguments?: unknown;
  /** Cooperative cancellation; the body must forward it to the child process. */
  readonly signal?: AbortSignal | undefined;
}

/** Subset of the host's tool registry definition (`ctx.tools.register`). */
export interface ToolDefinitionLike {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: {
    schema: Record<string, unknown>;
    render: (args: unknown, value: unknown) => ContentBlockLike[];
  };
  execute: (args: unknown, exec: ToolExecutionLike) => Promise<unknown>;
}

/** Subset of the host's tool registry (`ctx.tools`). */
export interface ToolsLike {
  register(definition: ToolDefinitionLike): () => void;
}

/** Bounded collect + optional whole-stream spill, as `ctx.subprocess` accepts it. */
export interface SubprocessCollectLike {
  maxBytes: number;
  spill?: { maxBytes: number } | undefined;
}

/** Subset of the host's `SubprocessSpawnSpec`. */
export interface SubprocessSpawnSpecLike {
  argv: readonly string[];
  cwd: string;
  stdio: { stdin: 'ignore'; stdout: SubprocessCollectLike; stderr: SubprocessCollectLike };
  graceMs: number;
  signal?: AbortSignal | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

/** One offset-based read of a collected stream. */
export interface SubprocessOutputReadLike {
  text: string;
  nextOffset: number;
  lossy: boolean;
  spillPath?: string | undefined;
}

/** Offset-based reader over one collected stream. */
export interface SubprocessOutputReaderLike {
  readFrom(fromByte: number): SubprocessOutputReadLike;
}

/** Subset of the host's `SubprocessHandle`. */
export interface SubprocessHandleLike {
  readonly collected: {
    stdout?: SubprocessOutputReaderLike | undefined;
    stderr?: SubprocessOutputReaderLike | undefined;
  };
  readonly done: Promise<{ exitCode: number | null; signal: string | null }>;
  terminate(): void;
}

/** Subset of the host's `ctx.subprocess` service. */
export interface SubprocessLike {
  resolveExecutable(
    command: string,
    env?: Readonly<Record<string, string>>,
    signal?: AbortSignal
  ): Promise<string>;
  spawn(spec: SubprocessSpawnSpecLike): SubprocessHandleLike;
}

/** Subset of the host's `ApprovalOutcome`; only `allowed-once` is a grant. */
export type ApprovalOutcomeLike = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

/** Subset of the host's `ApprovalRequest` for an ask *we* raise. */
export interface ApprovalRequestLike {
  agent: AgentLike;
  toolName: string;
  callId?: string | undefined;
  reason?: string | undefined;
  signal?: AbortSignal | undefined;
}

/** Subset of the host's `ctx.approval` service. */
export interface ApprovalLike {
  request(request: ApprovalRequestLike): Promise<ApprovalOutcomeLike>;
}

/** One static prompt contribution (`systemPrompt.context` / `systemPrompt.section`). */
export interface SystemPromptSpecLike {
  name: string;
  /** Ascending order; tool guidance belongs in the 100–199 band. */
  order: number;
  text: string;
}

/** Subset of the host's `ctx.systemPrompt` service. */
export interface SystemPromptLike {
  context(spec: SystemPromptSpecLike): () => void;
  /** Static section (stable prompt prefix); leaner hosts expose only `context`. */
  section?(spec: SystemPromptSpecLike): () => void;
}

/**
 * Subset of the Cordis `Context` this submodule consumes.
 *
 * `get` reads an optional service (the property proxy is topology-sensitive),
 * and `inject` starts a nested scope once the named services exist without
 * gating the rest of `apply`.
 */
export interface DshContextLike {
  get(name: string): unknown;
  inject(services: readonly string[], callback: (scope: DshContextLike) => void): unknown;
}
