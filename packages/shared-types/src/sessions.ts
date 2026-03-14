import type { SessionId } from './ids';

export type Session = {
  id: SessionId;
  title: string;
  createdAt: string;
};

export type CreateSessionInput = {
  title: string;
};
