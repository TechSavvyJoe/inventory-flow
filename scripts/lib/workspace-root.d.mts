export interface WorkspaceRootOptions {
  envRoot?: string
  argv1?: string
  cwd?: string
}

export function resolveWorkspaceRoot(metaUrl: string, options?: WorkspaceRootOptions): string
