export class InstanceService {
  listInstances() {
    return [] as Array<{ id: string; status: 'online' | 'offline' }>;
  }
}
