import { createSessionRecord, listSessionRecords } from './store';

export class SessionService {
  list() {
    return listSessionRecords();
  }

  create(input: { title: string }) {
    return createSessionRecord(input.title);
  }
}
