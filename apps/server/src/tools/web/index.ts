import type { BuiltinTool } from '@openaidy/runtime';
import { webFetchTool } from './fetch';

export function createWebTools(): BuiltinTool[] {
  return [webFetchTool];
}
