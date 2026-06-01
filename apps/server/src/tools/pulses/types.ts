import type { JobsStore, SessionsStore } from '@openaidy/db';
import type { PulseService } from '../../pulses/service.js';

/**
 * Dependencies for pulse tools.
 * The `getPulseService` getter is the primary dependency.
 * The `getJobsRepo` and `getSessionsRepo` getters are kept for backward
 * compatibility and type compatibility with app.ts but are not used by tools.
 */
export type PulseToolDeps = {
  getJobsRepo?: () => JobsStore | undefined;
  getSessionsRepo?: () => SessionsStore | undefined;
  getPulseService: () => PulseService | undefined;
};
