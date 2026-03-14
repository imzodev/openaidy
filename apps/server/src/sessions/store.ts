import { nanoid } from 'nanoid';

export type SessionRecord = {
  id: string;
  title: string;
  createdAt: string;
};

const sessions = new Map<string, SessionRecord>();

export function listSessionRecords(): SessionRecord[] {
  return Array.from(sessions.values());
}

export function createSessionRecord(title: string): SessionRecord {
  const record: SessionRecord = {
    id: nanoid(),
    title,
    createdAt: new Date().toISOString(),
  };

  sessions.set(record.id, record);
  return record;
}
