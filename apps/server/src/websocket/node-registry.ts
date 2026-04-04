import type { FastifyBaseLogger } from 'fastify';

/**
 * Node types
 */
export type NodeType = 'mobile' | 'desktop' | 'browser' | 'channel' | 'service';

/**
 * Node status
 */
export type NodeStatus = 'online' | 'offline' | 'stale';

/**
 * Node information
 */
export type Node = {
  nodeId: string;
  name: string;
  type: NodeType;
  status: NodeStatus;
  capabilities: string[];
  metadata: Record<string, unknown>;
  connectionId?: string;
  lastSeen: number;
  registeredAt: number;
  tokenHash?: string;
  scopes?: string[];
};

/**
 * Node registry options
 */
export type NodeRegistryOptions = {
  /** Initial nodes to populate */
  initialNodes?: Node[];
};

/**
 * Node registry service
 * 
 * Tracks registered nodes with capabilities and metadata.
 */
export class NodeRegistry {
  private readonly nodes: Map<string, Node> = new Map();
  private readonly capabilityIndex: Map<string, Set<string>> = new Map();
  private readonly connectionIndex: Map<string, string> = new Map();
  private readonly logger: FastifyBaseLogger;

  constructor(options: NodeRegistryOptions = {}, logger: FastifyBaseLogger) {
    this.logger = logger;

    if (options.initialNodes) {
      for (const node of options.initialNodes) {
        this.registerNode(node);
      }
    }
  }

  // Node lifecycle
  registerNode(node: Node): void {
    // Check for duplicate
    if (this.nodes.has(node.nodeId)) {
      this.logger.warn(`Node ${node.nodeId} already registered, overwriting`);
    }

    // Store node
    this.nodes.set(node.nodeId, node);

    // Update capability index
    for (const capability of node.capabilities) {
      if (!this.capabilityIndex.has(capability)) {
        this.capabilityIndex.set(capability, new Set());
      }
      this.capabilityIndex.get(capability)!.add(node.nodeId);
    }

    // Update connection index
    if (node.connectionId) {
      this.connectionIndex.set(node.connectionId, node.nodeId);
    }

    this.logger.info(`Node registered: ${node.nodeId} (${node.type})`);
  }

  unregisterNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return;
    }

    // Remove from capability index
    for (const capability of node.capabilities) {
      this.capabilityIndex.get(capability)?.delete(nodeId);
    }

    // Remove from connection index
    if (node.connectionId) {
      this.connectionIndex.delete(node.connectionId);
    }

    // Remove node
    this.nodes.delete(nodeId);

    this.logger.info(`Node unregistered: ${nodeId}`);
  }

  updateNode(nodeId: string, updates: Partial<Node>): void {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    // Handle capability changes
    if (updates.capabilities) {
      // Remove old capabilities from index
      for (const capability of node.capabilities) {
        this.capabilityIndex.get(capability)?.delete(nodeId);
      }

      // Add new capabilities to index
      for (const capability of updates.capabilities) {
        if (!this.capabilityIndex.has(capability)) {
          this.capabilityIndex.set(capability, new Set());
        }
        this.capabilityIndex.get(capability)!.add(nodeId);
      }
    }

    // Handle connection change
    if (updates.connectionId !== undefined) {
      if (node.connectionId) {
        this.connectionIndex.delete(node.connectionId);
      }
      if (updates.connectionId) {
        this.connectionIndex.set(updates.connectionId, nodeId);
      }
    }

    // Apply updates
    Object.assign(node, updates);

    this.logger.debug(`Node updated: ${nodeId}`);
  }

  // Node lookup
  getNode(nodeId: string): Node | undefined {
    return this.nodes.get(nodeId);
  }

  getNodeByConnection(connectionId: string): Node | undefined {
    const nodeId = this.connectionIndex.get(connectionId);
    if (!nodeId) {
      return undefined;
    }
    return this.nodes.get(nodeId);
  }

  getAllNodes(): Node[] {
    return Array.from(this.nodes.values());
  }

  getOnlineNodes(): Node[] {
    return Array.from(this.nodes.values()).filter(n => n.status === 'online');
  }

  // Query
  findNodesByCapability(capability: string): Node[] {
    const nodeIds = this.capabilityIndex.get(capability);
    if (!nodeIds) {
      return [];
    }
    return Array.from(nodeIds)
      .map(id => this.nodes.get(id))
      .filter((node): node is Node => node !== undefined);
  }

  findNodesByCapabilities(capabilities: string[]): Node[] {
    if (capabilities.length === 0) {
      return this.getOnlineNodes();
    }

    // Find nodes with ALL capabilities (AND)
    const nodeIds = this.capabilityIndex.get(capabilities[0]);
    if (!nodeIds) {
      return [];
    }

    return Array.from(nodeIds)
      .map(id => this.nodes.get(id))
      .filter((node): node is Node => node !== undefined)
      .filter((node) => 
        capabilities.every(cap => node.capabilities.includes(cap))
      );
  }

  findNodesByType(type: NodeType): Node[] {
    return Array.from(this.nodes.values()).filter(n => n.type === type);
  }

  // Status management
  updateLastSeen(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return;
    }
    node.lastSeen = Date.now();
  }

  markOffline(nodeId: string): void {
    this.updateNode(nodeId, { status: 'offline' });
    this.logger.info(`Node marked offline: ${nodeId}`);
  }

  markStale(nodeId: string): void {
    this.updateNode(nodeId, { status: 'stale' });
    this.logger.debug(`Node marked stale: ${nodeId}`);
  }

  checkStaleNodes(timeoutMs: number): string[] {
    const now = Date.now();
    const staleNodeIds: string[] = [];

    for (const [nodeId, node] of this.nodes) {
      if (node.status === 'online' && (now - node.lastSeen > timeoutMs)) {
        this.markStale(nodeId);
        staleNodeIds.push(nodeId);
      }
    }

    return staleNodeIds;
  }

  // Cleanup
  cleanupStaleNodes(timeoutMs: number): number {
    const staleNodeIds = this.checkStaleNodes(timeoutMs);
    for (const nodeId of staleNodeIds) {
      this.unregisterNode(nodeId);
    }
    return staleNodeIds.length;
  }

  clear(): void {
    this.nodes.clear();
    this.capabilityIndex.clear();
    this.connectionIndex.clear();
    this.logger.info('Node registry cleared');
  }

  /** Get the number of registered nodes */
  get size(): number {
    return this.nodes.size;
  }
}
