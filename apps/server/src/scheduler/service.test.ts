import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { JobsRepository, JobRunsRepository } from '@openaidy/db';
import type { ScheduledJob, JobRun } from '@openaidy/db';
import { SchedulerService, createSchedulerService, type GenericLogger } from './service';
import type { SessionMessageService } from '../sessions/service';

// Create mock functions
const createMockLogger = (): GenericLogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

// Helper to create mock repositories with all methods
function createMockJobsRepo() {
  return {
    claimNextDueJob: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    listActive: vi.fn(),
    countByStatus: vi.fn(),
  };
}

function createMockJobRunsRepo() {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    updateStatus: vi.fn(),
    listByJob: vi.fn(),
    listByStatus: vi.fn(),
    getLatestByJob: vi.fn(),
    countByJobAndStatus: vi.fn(),
    deleteByJob: vi.fn(),
  };
}

function createMockSessionService() {
  return {
    submitMessage: vi.fn(),
    getSession: vi.fn(),
    createSession: vi.fn(),
    listSessions: vi.fn(),
    listMessages: vi.fn(),
    listRuns: vi.fn(),
  };
}

// Helper to create a mock job
function createMockJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 'job-1',
    type: 'one-shot',
    targetType: 'session',
    targetSessionId: 'session-1',
    payload: { message: 'Test message' },
    status: 'active',
    nextRunAt: new Date(),
    lastRunAt: null,
    retryCount: 0,
    maxRetries: 3,
    backoffMs: 1000,
    createdAt: new Date(),
    updatedAt: new Date(),
    schedule: null,
    cronExpression: null,
    metadata: null,
    ...overrides,
  };
}

// Helper to create a mock run
function createMockRun(overrides: Partial<JobRun> = {}): JobRun {
  return {
    id: 'run-1',
    jobId: 'job-1',
    status: 'queued',
    attemptNumber: 1,
    startedAt: null,
    finishedAt: null,
    errorCode: null,
    errorMessage: null,
    resultData: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('SchedulerService', () => {
  let scheduler: SchedulerService;
  let mockJobsRepo: ReturnType<typeof createMockJobsRepo>;
  let mockJobRunsRepo: ReturnType<typeof createMockJobRunsRepo>;
  let mockSessionService: ReturnType<typeof createMockSessionService>;
  let mockLogger: GenericLogger;

  beforeEach(() => {
    vi.useFakeTimers();
    mockJobsRepo = createMockJobsRepo();
    mockJobRunsRepo = createMockJobRunsRepo();
    mockSessionService = createMockSessionService();
    mockLogger = createMockLogger();

    // Cast to any to avoid complex type issues with mocks
    scheduler = new SchedulerService(
      mockJobsRepo as unknown as JobsRepository,
      mockJobRunsRepo as unknown as JobRunsRepository,
      mockSessionService as unknown as SessionMessageService,
      mockLogger,
      { pollIntervalMs: 5000 }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    if (scheduler.isActive()) {
      scheduler.stop();
    }
  });

  describe('start()', () => {
    it('starts scheduler successfully', () => {
      scheduler.start();
      expect(scheduler.isActive()).toBe(true);
    });

    it('throws error if already running', () => {
      scheduler.start();
      expect(() => scheduler.start()).toThrow('Scheduler is already running');
    });

    it('logs scheduler started', () => {
      scheduler.start();
      expect(mockLogger.info).toHaveBeenCalledWith(
        { pollIntervalMs: 5000 },
        'Scheduler started'
      );
    });
  });

  describe('stop()', () => {
    it('stops scheduler successfully', async () => {
      scheduler.start();
      await scheduler.stop();
      expect(scheduler.isActive()).toBe(false);
    });

    it('is idempotent', async () => {
      await scheduler.stop();
      expect(scheduler.isActive()).toBe(false);
    });

    it('logs scheduler stopped', async () => {
      scheduler.start();
      await scheduler.stop();
      expect(mockLogger.info).toHaveBeenCalledWith('Scheduler stopped');
    });
  });

  describe('isActive()', () => {
    it('returns false when not started', () => {
      expect(scheduler.isActive()).toBe(false);
    });

    it('returns true when started', () => {
      scheduler.start();
      expect(scheduler.isActive()).toBe(true);
    });

    it('returns false after stop', async () => {
      scheduler.start();
      await scheduler.stop();
      expect(scheduler.isActive()).toBe(false);
    });
  });

  describe('tick()', () => {
    it('returns false when no due jobs', async () => {
      mockJobsRepo.claimNextDueJob.mockResolvedValue(null);
      const result = await scheduler.tick();
      expect(result).toBe(false);
    });

    it('returns false when scheduler not running', async () => {
      const result = await scheduler.tick();
      expect(result).toBe(false);
    });

    it('creates job run record when job is claimed', async () => {
      const mockJob = createMockJob();
      const mockRun = createMockRun();

      mockJobsRepo.claimNextDueJob.mockResolvedValue(mockJob);
      mockJobRunsRepo.create.mockResolvedValue(mockRun);
      mockJobRunsRepo.updateStatus.mockResolvedValue({ ...mockRun, status: 'running' });
      mockSessionService.submitMessage.mockResolvedValue({
        ok: true,
        userMessage: {},
        assistantMessage: {},
        run: {},
      });
      mockJobsRepo.update.mockResolvedValue({ ...mockJob, status: 'completed' });

      scheduler.start();
      const result = await scheduler.tick();

      expect(result).toBe(true);
      expect(mockJobRunsRepo.create).toHaveBeenCalledWith({
        jobId: 'job-1',
        status: 'queued',
        attemptNumber: 1,
      });
    });

    it('marks run as succeeded on success', async () => {
      const mockJob = createMockJob();
      const mockRun = createMockRun();

      mockJobsRepo.claimNextDueJob.mockResolvedValue(mockJob);
      mockJobRunsRepo.create.mockResolvedValue(mockRun);
      mockJobRunsRepo.updateStatus.mockResolvedValue({ ...mockRun, status: 'running' });
      mockSessionService.submitMessage.mockResolvedValue({
        ok: true,
        userMessage: {},
        assistantMessage: {},
        run: {},
      });
      mockJobsRepo.update.mockResolvedValue({ ...mockJob, status: 'completed' });

      scheduler.start();
      await scheduler.tick();

      expect(mockJobRunsRepo.updateStatus).toHaveBeenCalledWith('run-1', {
        status: 'succeeded',
        finishedAt: expect.any(Date),
      });
    });

    it('one-shot job marked completed after success', async () => {
      const mockJob = createMockJob();
      const mockRun = createMockRun();

      mockJobsRepo.claimNextDueJob.mockResolvedValue(mockJob);
      mockJobRunsRepo.create.mockResolvedValue(mockRun);
      mockJobRunsRepo.updateStatus.mockResolvedValue({ ...mockRun, status: 'running' });
      mockSessionService.submitMessage.mockResolvedValue({
        ok: true,
        userMessage: {},
        assistantMessage: {},
        run: {},
      });
      mockJobsRepo.update.mockResolvedValue({ ...mockJob, status: 'completed' });

      scheduler.start();
      await scheduler.tick();

      expect(mockJobsRepo.update).toHaveBeenCalledWith('job-1', {
        status: 'completed',
        lastRunAt: expect.any(Date),
      });
    });

    it('cron job rescheduled after success', async () => {
      const mockJob = createMockJob({
        type: 'cron',
        cronExpression: '*/5 * * * *',
      });
      const mockRun = createMockRun();

      mockJobsRepo.claimNextDueJob.mockResolvedValue(mockJob);
      mockJobRunsRepo.create.mockResolvedValue(mockRun);
      mockJobRunsRepo.updateStatus.mockResolvedValue({ ...mockRun, status: 'running' });
      mockSessionService.submitMessage.mockResolvedValue({
        ok: true,
        userMessage: {},
        assistantMessage: {},
        run: {},
      });
      mockJobsRepo.update.mockResolvedValue(mockJob);

      scheduler.start();
      await scheduler.tick();

      expect(mockJobsRepo.update).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          retryCount: 0,
          lastRunAt: expect.any(Date),
          nextRunAt: expect.any(Date),
        })
      );
    });

    it('failed job retries with backoff', async () => {
      const mockJob = createMockJob();
      const mockRun = createMockRun();

      mockJobsRepo.claimNextDueJob.mockResolvedValue(mockJob);
      mockJobRunsRepo.create.mockResolvedValue(mockRun);
      mockJobRunsRepo.updateStatus.mockResolvedValue({ ...mockRun, status: 'running' });
      mockSessionService.submitMessage.mockResolvedValue({
        ok: false,
        error: { code: 'PROVIDER_ERROR', message: 'Provider failed' },
      });
      mockJobsRepo.update.mockResolvedValue(mockJob);

      scheduler.start();
      await scheduler.tick();

      expect(mockJobRunsRepo.updateStatus).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'failed',
          errorCode: expect.any(String),
          errorMessage: expect.any(String),
        })
      );

      expect(mockJobsRepo.update).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({
          retryCount: 1,
          nextRunAt: expect.any(Date),
        })
      );
    });

    it('failed job marked failed after max retries', async () => {
      const mockJob = createMockJob({ retryCount: 3, maxRetries: 3 });
      const mockRun = createMockRun({ attemptNumber: 4 });

      mockJobsRepo.claimNextDueJob.mockResolvedValue(mockJob);
      mockJobRunsRepo.create.mockResolvedValue(mockRun);
      mockJobRunsRepo.updateStatus.mockResolvedValue({ ...mockRun, status: 'running' });
      mockSessionService.submitMessage.mockResolvedValue({
        ok: false,
        error: { code: 'PROVIDER_ERROR', message: 'Provider failed' },
      });
      mockJobsRepo.update.mockResolvedValue({ ...mockJob, status: 'failed' });

      scheduler.start();
      await scheduler.tick();

      expect(mockJobsRepo.update).toHaveBeenCalledWith('job-1', {
        status: 'failed',
        lastRunAt: expect.any(Date),
      });
    });

    it('throws error for session job missing targetSessionId', async () => {
      const mockJob = createMockJob({ targetSessionId: null });
      const mockRun = createMockRun();

      mockJobsRepo.claimNextDueJob.mockResolvedValue(mockJob);
      mockJobRunsRepo.create.mockResolvedValue(mockRun);
      mockJobRunsRepo.updateStatus.mockResolvedValue({ ...mockRun, status: 'running' });
      mockJobsRepo.update.mockResolvedValue(mockJob);

      scheduler.start();
      await scheduler.tick();

      expect(mockJobRunsRepo.updateStatus).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'Session job missing targetSessionId',
        })
      );
    });

    it('throws error for isolated jobs (not implemented)', async () => {
      const mockJob = createMockJob({ targetType: 'isolated', targetSessionId: null });
      const mockRun = createMockRun();

      mockJobsRepo.claimNextDueJob.mockResolvedValue(mockJob);
      mockJobRunsRepo.create.mockResolvedValue(mockRun);
      mockJobRunsRepo.updateStatus.mockResolvedValue({ ...mockRun, status: 'running' });
      mockJobsRepo.update.mockResolvedValue(mockJob);

      scheduler.start();
      await scheduler.tick();

      expect(mockJobRunsRepo.updateStatus).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'Isolated job execution not yet implemented',
        })
      );
    });
  });

  describe('triggerJob()', () => {
    it('throws error if job not found', async () => {
      mockJobsRepo.findById.mockResolvedValue(null);
      await expect(scheduler.triggerJob('non-existent')).rejects.toThrow('Job not found');
    });

    it('executes job immediately', async () => {
      const mockJob = createMockJob();
      const mockRun = createMockRun({ attemptNumber: 0 });

      mockJobsRepo.findById.mockResolvedValue(mockJob);
      mockJobRunsRepo.create.mockResolvedValue(mockRun);
      mockJobRunsRepo.updateStatus.mockResolvedValue({ ...mockRun, status: 'succeeded' });
      mockSessionService.submitMessage.mockResolvedValue({
        ok: true,
        userMessage: {},
        assistantMessage: {},
        run: {},
      });

      const result = await scheduler.triggerJob('job-1');

      expect(result).toBeDefined();
      expect(mockJobRunsRepo.create).toHaveBeenCalledWith({
        jobId: 'job-1',
        status: 'queued',
        attemptNumber: 0,
      });
    });

    it('creates run with attempt 0', async () => {
      const mockJob = createMockJob({ retryCount: 2 });
      const mockRun = createMockRun({ attemptNumber: 0 });

      mockJobsRepo.findById.mockResolvedValue(mockJob);
      mockJobRunsRepo.create.mockResolvedValue(mockRun);
      mockJobRunsRepo.updateStatus.mockResolvedValue({ ...mockRun, status: 'succeeded' });
      mockSessionService.submitMessage.mockResolvedValue({
        ok: true,
        userMessage: {},
        assistantMessage: {},
        run: {},
      });

      await scheduler.triggerJob('job-1');

      expect(mockJobRunsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptNumber: 0,
        })
      );
    });

    it('handles execution errors', async () => {
      const mockJob = createMockJob();
      const mockRun = createMockRun({ attemptNumber: 0 });

      mockJobsRepo.findById.mockResolvedValue(mockJob);
      mockJobRunsRepo.create.mockResolvedValue(mockRun);
      mockJobRunsRepo.updateStatus.mockResolvedValue({ ...mockRun, status: 'running' });
      mockSessionService.submitMessage.mockResolvedValue({
        ok: false,
        error: { code: 'PROVIDER_ERROR', message: 'Provider failed' },
      });

      await expect(scheduler.triggerJob('job-1')).rejects.toThrow();

      expect(mockJobRunsRepo.updateStatus).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'failed',
        })
      );
    });
  });

  describe('recoverStuckJobs()', () => {
    it('recovers stuck runs on startup', async () => {
      const mockRun = createMockRun({ status: 'running', startedAt: new Date() });
      const mockJob = createMockJob();

      mockJobRunsRepo.listByStatus.mockResolvedValue([mockRun]);
      mockJobsRepo.findById.mockResolvedValue(mockJob);
      mockJobRunsRepo.updateStatus.mockResolvedValue({ ...mockRun, status: 'failed' });
      mockJobsRepo.update.mockResolvedValue(mockJob);

      await scheduler.recoverStuckJobs();

      expect(mockJobRunsRepo.updateStatus).toHaveBeenCalledWith('run-1', {
        status: 'failed',
        finishedAt: expect.any(Date),
        errorCode: 'SCHEDULER_CRASH',
        errorMessage: 'Job was running when scheduler stopped',
      });
    });

    it('handles no stuck runs', async () => {
      mockJobRunsRepo.listByStatus.mockResolvedValue([]);

      await scheduler.recoverStuckJobs();

      expect(mockJobRunsRepo.updateStatus).not.toHaveBeenCalled();
    });
  });
});

describe('createSchedulerService', () => {
  it('creates scheduler service instance', () => {
    const mockJobsRepo = createMockJobsRepo();
    const mockJobRunsRepo = createMockJobRunsRepo();
    const mockSessionService = createMockSessionService();
    const mockLogger = createMockLogger();

    const scheduler = createSchedulerService(
      mockJobsRepo as unknown as JobsRepository,
      mockJobRunsRepo as unknown as JobRunsRepository,
      mockSessionService as unknown as SessionMessageService,
      mockLogger
    );

    expect(scheduler).toBeInstanceOf(SchedulerService);
    expect(scheduler.isActive()).toBe(false);
  });
});
