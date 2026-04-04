import type { SessionId } from './ids.js';

export type Session = {
  id: SessionId;
  title: string;
  createdAt: string;
};

export type CreateSessionInput = {
  title: string;
};
