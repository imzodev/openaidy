export class PairingService {
  listRequests() {
    return [] as Array<{ id: string; status: 'pending' | 'approved' | 'rejected' }>;
  }
}
