import type { BuiltinTool } from '@aidyagent/runtime';
import { webFetchTool } from './fetch';

export function createWebTools(): BuiltinTool[] {
  return [webFetchTool];
}
