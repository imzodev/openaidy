export {
  WorkspaceService,
  createWorkspaceService,
  WorkspaceError,
  type FileInfo,
  type WorkspaceServiceOptions,
} from './service';

export {
  validateWorkspaceAccess,
  getEffectivePermissions,
  hasCrossWorkspaceAccess,
  getReadableAgents,
  getWritableAgents,
  canAccessWorkspace,
  type PermissionMode,
  type PermissionResult,
} from './permissions';
