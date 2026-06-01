import type { ScheduledJob, JobRun } from '@openaidy/db';
import type { JobsStore, JobRunsStore, SessionsStore } from '@openaidy/db';
import type {
  CreatePulseInput,
  UpdatePulseInput,
  ListPulsesFilters,
  PulseRecord,
} from '@openaidy/shared-types';
import { parseScheduleInput, jobToPulse } from './utils.js';

/**
 * Pagination options for list operations.
 */
export type Pagination = {
  limit: number;
  offset: number;
};

/**
 * Paginated result wrapper.
 */
export type PaginatedResult<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

/**
 * A runner function for triggering a job manually.
 * Provided from outside since SchedulerService is not a store.
 */
export type JobRunner = (id: string) => Promise<JobRun>;

/**
 * PulseService - shared CRUD logic for pulses.
 *
 * Used by:
 *   - REST API routes (apps/server/src/routes/pulses.ts)
 *   - Builtin tools for agents (apps/server/src/tools/pulses/*.ts)
 *   - Future CLI commands
 *
 * Logic that stays server-only (in utils.ts):
 *   - parseScheduleInput() — requires cron-utils
 *   - jobToPulse() — may depend on server-only utilities
 */
export class PulseService {
  constructor(
    private jobsRepo: JobsStore,
    private jobRunsRepo: JobRunsStore,
    private sessionsRepo: SessionsStore,
  ) {}

  // ========================================
  // Helpers
  // ========================================

  isPulse(job: ScheduledJob): boolean {
    const metadata = job.metadata as Record<string, unknown> | null;
    return metadata?.kind === 'pulse';
  }

  private metadataOf(job: ScheduledJob): Record<string, unknown> | null {
    return job.metadata as Record<string, unknown> | null;
  }

  // ========================================
  // Create
  // ========================================

  async createPulse(input: CreatePulseInput): Promise<PulseRecord> {
    const { name, prompt, schedule, agentId, sessionId } = input;

    if (sessionId) {
      const session = await this.sessionsRepo.findById(sessionId);
      if (!session) {
        throw new Error(`Session "${sessionId}" not found.`);
      }
    }

    const parsedSchedule = parseScheduleInput(schedule);

    const createJobInput: Parameters<typeof this.jobsRepo.create>[0] = {
      type: parsedSchedule.type,
      targetType: sessionId ? 'session' : 'isolated',
      payload: {
        message: prompt,
        agentId,
      },
      status: 'active',
      metadata: {
        kind: 'pulse',
        name: name.trim(),
        prompt,
      },
      nextRunAt: parsedSchedule.nextRunAt,
    };

    if (sessionId) {
      createJobInput.targetSessionId = sessionId;
    }
    if (parsedSchedule.schedule !== undefined) {
      createJobInput.schedule = parsedSchedule.schedule;
    }
    if (parsedSchedule.cronExpression !== undefined) {
      createJobInput.cronExpression = parsedSchedule.cronExpression;
    }

    const job = await this.jobsRepo.create(createJobInput);
    return jobToPulse(job);
  }

  // ========================================
  // List
  // ========================================

  async listPulses(
    filters: ListPulsesFilters,
  ): Promise<PaginatedResult<PulseRecord>> {
    const { status, limit, offset } = filters;

    const listFilters: Parameters<typeof this.jobsRepo.list>[0] = {
      limit: 1000,
    };
    if (status !== undefined) {
      listFilters.status = status;
    }
    const allJobs = await this.jobsRepo.list(listFilters);

    const pulses = allJobs.filter((job) => this.isPulse(job)).map(jobToPulse);

    const total = pulses.length;
    const items = pulses.slice(offset, offset + limit);

    return { items, total, limit, offset };
  }

  // ========================================
  // Get
  // ========================================

  async getPulse(id: string): Promise<PulseRecord> {
    const job = await this.jobsRepo.findById(id);
    if (!job || !this.isPulse(job)) {
      throw new Error('Pulse not found');
    }
    return jobToPulse(job);
  }

  // ========================================
  // Update
  // ========================================

  async updatePulse(id: string, input: UpdatePulseInput): Promise<PulseRecord> {
    const existingJob = await this.jobsRepo.findById(id);
    if (!existingJob || !this.isPulse(existingJob)) {
      throw new Error('Pulse not found');
    }

    const existingMetadata = this.metadataOf(existingJob);

    const updates: {
      status?: 'active' | 'paused' | 'completed' | 'failed';
      metadata?: Record<string, unknown>;
      nextRunAt?: Date;
      cronExpression?: string;
      schedule?: Date;
    } = {};

    if (input.status !== undefined) {
      updates.status = input.status;
    }

    if (input.schedule !== undefined) {
      const parsedSchedule = parseScheduleInput(
        input.schedule as Parameters<typeof parseScheduleInput>[0],
      );
      if (parsedSchedule.cronExpression !== undefined) {
        updates.cronExpression = parsedSchedule.cronExpression;
      }
      if (parsedSchedule.schedule !== undefined) {
        updates.schedule = parsedSchedule.schedule;
      }
      updates.nextRunAt = parsedSchedule.nextRunAt;
    }

    if (input.name !== undefined || input.prompt !== undefined) {
      const newMetadata = { ...existingMetadata };
      if (input.name !== undefined) {
        newMetadata.name = input.name;
      }
      if (input.prompt !== undefined) {
        newMetadata.prompt = input.prompt;
      }
      updates.metadata = newMetadata;
    }

    const updatedJob = await this.jobsRepo.update(id, updates);
    return jobToPulse(updatedJob);
  }

  // ========================================
  // Delete
  // ========================================

  async deletePulse(id: string): Promise<void> {
    const existingJob = await this.jobsRepo.findById(id);
    if (!existingJob || !this.isPulse(existingJob)) {
      throw new Error('Pulse not found');
    }
    await this.jobsRepo.delete(id);
  }

  // ========================================
  // Trigger
  // ========================================

  async triggerPulse(id: string, runner: JobRunner): Promise<JobRun> {
    const job = await this.jobsRepo.findById(id);
    if (!job || !this.isPulse(job)) {
      throw new Error('Pulse not found');
    }
    return runner(id);
  }

  // ========================================
  // History
  // ========================================

  async getPulseHistory(
    id: string,
    pagination: Pagination,
  ): Promise<PaginatedResult<JobRun>> {
    const job = await this.jobsRepo.findById(id);
    if (!job || !this.isPulse(job)) {
      throw new Error('Pulse not found');
    }

    const runs = await this.jobRunsRepo.listByJob(id, {
      limit: pagination.limit,
      offset: pagination.offset,
    });

    const total = runs.length;

    return {
      items: runs,
      total,
      limit: pagination.limit,
      offset: pagination.offset,
    };
  }
}
