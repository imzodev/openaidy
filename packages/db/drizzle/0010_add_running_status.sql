-- ============================================================
-- Migration: 0010_add_running_status
-- Description: Add 'running' to the task_schedule_status enum so
--              claimNextDue can atomically flip a schedule to running.
-- ============================================================

ALTER TYPE task_schedule_status ADD VALUE IF NOT EXISTS 'running';
