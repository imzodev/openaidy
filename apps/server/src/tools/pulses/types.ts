import type { JobsStore, SessionsStore } from '@openaidy/db';

export type PulseToolDeps = {
  getJobsRepo: () => JobsStore | undefined;
  getSessionsRepo: () => SessionsStore | undefined;
};
