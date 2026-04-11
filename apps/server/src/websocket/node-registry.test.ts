import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { NodeRegistry, type Node, type NodeType } from './node-registry';

/**
 * Create mock logger
 */
function createMockLogger(): FastifyBaseLogger {
  return {
    child: () => createMockLogger(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    level: 'info',
    silent: vi.fn(),
  } as FastifyBaseLogger;
}

/**
 * Create a test node
 */
function createTestNode(overrides: Partial<Node> = {}): Node {
  return {
    nodeId: 'node-1',
    name: 'Test Node',
    type: 'mobile',
    status: 'online',
    capabilities: ['camera', 'microphone'],
    metadata: {},
    registeredAt: Date.now(),
    lastSeen: Date.now(),
    ...overrides,
  };
}

describe('NodeRegistry', () => {
  let registry: NodeRegistry;
  let mockLogger: FastifyBaseLogger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    registry = new NodeRegistry({}, mockLogger);
  });

  afterEach(() => {
    registry.clear();
  });

  describe('registerNode', () => {
    it('should register a node', () => {
      const node = createTestNode();
      registry.registerNode(node);

      expect(registry.size).toBe(1);
      expect(registry.getNode('node-1')).toBeDefined();
    });

    it('should warn when overwriting existing node', () => {
      const node = createTestNode();
      registry.registerNode(node);
      registry.registerNode(node);

      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should index capabilities', () => {
      registry.registerNode(createTestNode({ capabilities: ['camera', 'storage'] }));
      registry.registerNode(createTestNode({ 
        nodeId: 'node-2', 
        capabilities: ['camera', 'microphone'] 
      }));

      const cameraNodes = registry.findNodesByCapability('camera');
      expect(cameraNodes).toHaveLength(2);

      const storageNodes = registry.findNodesByCapability('storage');
      expect(storageNodes).toHaveLength(1);
    });

    it('should index connection', () => {
      registry.registerNode(createTestNode({ connectionId: 'conn-1' }));

      const node = registry.getNodeByConnection('conn-1');
      expect(node).toBeDefined();
      expect(node?.nodeId).toBe('node-1');
    });
  });

  describe('unregisterNode', () => {
    it('should unregister a node', () => {
      registry.registerNode(createTestNode());
      registry.unregisterNode('node-1');

      expect(registry.size).toBe(0);
    });

    it('should do nothing for non-existent node', () => {
      registry.unregisterNode('non-existent');
      expect(registry.size).toBe(0);
    });

    it('should remove from capability index', () => {
      registry.registerNode(createTestNode({ capabilities: ['camera'] }));
      registry.unregisterNode('node-1');

      const cameraNodes = registry.findNodesByCapability('camera');
      expect(cameraNodes).toHaveLength(0);
    });

    it('should remove from connection index', () => {
      registry.registerNode(createTestNode({ connectionId: 'conn-1' }));
      registry.unregisterNode('node-1');

      const node = registry.getNodeByConnection('conn-1');
      expect(node).toBeUndefined();
    });
  });

  describe('updateNode', () => {
    it('should update node', () => {
      registry.registerNode(createTestNode());
      registry.updateNode('node-1', { name: 'Updated Node' });

      const node = registry.getNode('node-1');
      expect(node?.name).toBe('Updated Node');
    });

    it('should throw for non-existent node', () => {
      expect(() => registry.updateNode('non-existent', { name: 'Test' }))
        .toThrow('non-existent');
    });

    it('should update capability index when capabilities change', () => {
      registry.registerNode(createTestNode({ capabilities: ['camera'] }));
      registry.updateNode('node-1', { capabilities: ['camera', 'storage'] });

      const storageNodes = registry.findNodesByCapability('storage');
      expect(storageNodes).toHaveLength(1);
    });

    it('should update connection index when connection changes', () => {
      registry.registerNode(createTestNode({ connectionId: 'conn-1' }));
      registry.updateNode('node-1', { connectionId: 'conn-2' });

      expect(registry.getNodeByConnection('conn-1')).toBeUndefined();
      expect(registry.getNodeByConnection('conn-2')).toBeDefined();
    });
  });

  describe('getNode', () => {
    it('should get node by id', () => {
      registry.registerNode(createTestNode());

      const node = registry.getNode('node-1');
      expect(node).toBeDefined();
      expect(node?.nodeId).toBe('node-1');
    });

    it('should return undefined for non-existent node', () => {
      expect(registry.getNode('non-existent')).toBeUndefined();
    });
  });

  describe('getNodeByConnection', () => {
    it('should get node by connection id', () => {
      registry.registerNode(createTestNode({ connectionId: 'conn-1' }));

      const node = registry.getNodeByConnection('conn-1');
      expect(node).toBeDefined();
      expect(node?.nodeId).toBe('node-1');
    });

    it('should return undefined for non-existent connection', () => {
      expect(registry.getNodeByConnection('non-existent')).toBeUndefined();
    });
  });

  describe('getAllNodes', () => {
    it('should get all nodes', () => {
      registry.registerNode(createTestNode({ nodeId: 'node-1' }));
      registry.registerNode(createTestNode({ nodeId: 'node-2' }));

      const nodes = registry.getAllNodes();
      expect(nodes).toHaveLength(2);
    });
  });

  describe('getOnlineNodes', () => {
    it('should get only online nodes', () => {
      registry.registerNode(createTestNode({ 
        nodeId: 'node-1',
        status: 'online'
      }));
      registry.registerNode(createTestNode({ 
        nodeId: 'node-2',
        status: 'offline'
      }));
      registry.registerNode(createTestNode({ 
        nodeId: 'node-3',
        status: 'stale'
      }));

      const nodes = registry.getOnlineNodes();
      expect(nodes).toHaveLength(1);
      expect(nodes[0]!.nodeId).toBe('node-1');
    });
  });

  describe('findNodesByCapability', () => {
    it('should find nodes by single capability', () => {
      registry.registerNode(createTestNode({ capabilities: ['camera', 'storage'] }));
      registry.registerNode(createTestNode({ 
        nodeId: 'node-2', 
        capabilities: ['camera', 'microphone'] 
      }));
      registry.registerNode(createTestNode({ 
        nodeId: 'node-3', 
        capabilities: ['storage'] 
      }));

      const cameraNodes = registry.findNodesByCapability('camera');
      expect(cameraNodes).toHaveLength(2);

      const storageNodes = registry.findNodesByCapability('storage');
      expect(storageNodes).toHaveLength(2);
    });

    it('should return empty array for non-existent capability', () => {
      const nodes = registry.findNodesByCapability('non-existent');
      expect(nodes).toHaveLength(0);
    });
  });

  describe('findNodesByCapabilities', () => {
    it('should find nodes with ALL capabilities', () => {
      registry.registerNode(createTestNode({ capabilities: ['camera', 'microphone'] }));
      registry.registerNode(createTestNode({ 
        nodeId: 'node-2', 
        capabilities: ['camera', 'storage'] 
      }));
      registry.registerNode(createTestNode({ 
        nodeId: 'node-3', 
        capabilities: ['camera'] 
      }));

      const nodes = registry.findNodesByCapabilities(['camera', 'microphone']);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]!.nodeId).toBe('node-1');
    });

    it('should return empty array when no nodes have all capabilities', () => {
      registry.registerNode(createTestNode({ capabilities: ['camera'] }));
      registry.registerNode(createTestNode({ 
        nodeId: 'node-2', 
        capabilities: ['microphone'] 
      }));

      const nodes = registry.findNodesByCapabilities(['camera', 'microphone']);
      expect(nodes).toHaveLength(0);
    });

    it('should return all online nodes when no capabilities specified', () => {
      registry.registerNode(createTestNode({ status: 'online' }));
      registry.registerNode(createTestNode({ 
        nodeId: 'node-2',
        status: 'online'
      }));
      registry.registerNode(createTestNode({ 
        nodeId: 'node-3',
        status: 'offline'
      }));

      const nodes = registry.findNodesByCapabilities([]);
      expect(nodes).toHaveLength(2);
    });
  });

  describe('findNodesByType', () => {
    it('should find nodes by type', () => {
      registry.registerNode(createTestNode({ type: 'mobile' }));
      registry.registerNode(createTestNode({ 
        nodeId: 'node-2', 
        type: 'desktop' 
      }));
      registry.registerNode(createTestNode({ 
        nodeId: 'node-3', 
        type: 'mobile' 
      }));

      const mobileNodes = registry.findNodesByType('mobile');
      expect(mobileNodes).toHaveLength(2);

      const desktopNodes = registry.findNodesByType('desktop');
      expect(desktopNodes).toHaveLength(1);
    });

    it('should return empty array for non-existent type', () => {
      const nodes = registry.findNodesByType('non-existent' as NodeType);
      expect(nodes).toHaveLength(0);
    });
  });

  describe('updateLastSeen', () => {
    it('should update lastSeen', () => {
      registry.registerNode(createTestNode());
      const before = registry.getNode('node-1')!.lastSeen;
      
      // Wait a bit
      const start = Date.now();
      while (Date.now() - start < 10) {
        // busy wait
      }

      registry.updateLastSeen('node-1');
      const after = registry.getNode('node-1')!.lastSeen;

      expect(after).toBeGreaterThan(before);
    });

    it('should do nothing for non-existent node', () => {
      registry.updateLastSeen('non-existent');
      // Should not throw
    });
  });

  describe('markOffline', () => {
    it('should mark node as offline', () => {
      registry.registerNode(createTestNode());
      registry.markOffline('node-1');

      const node = registry.getNode('node-1');
      expect(node?.status).toBe('offline');
    });
  });

  describe('markStale', () => {
    it('should mark node as stale', () => {
      registry.registerNode(createTestNode());
      registry.markStale('node-1');

      const node = registry.getNode('node-1');
      expect(node?.status).toBe('stale');
    });
  });

  describe('checkStaleNodes', () => {
    it('should detect and mark stale nodes', () => {
      registry.registerNode(createTestNode({ 
        nodeId: 'node-1',
        lastSeen: Date.now() - 10000
      }));
      registry.registerNode(createTestNode({ 
        nodeId: 'node-2',
        lastSeen: Date.now()
      }));

      const staleNodeIds = registry.checkStaleNodes(5000);
      expect(staleNodeIds).toHaveLength(1);
      expect(staleNodeIds).toContain('node-1');

      const node1 = registry.getNode('node-1');
      expect(node1?.status).toBe('stale');
    });

    it('should not mark recently seen nodes as stale', () => {
      registry.registerNode(createTestNode({ 
        nodeId: 'node-1',
        lastSeen: Date.now()
      }));

      const staleNodeIds = registry.checkStaleNodes(5000);
      expect(staleNodeIds).toHaveLength(0);
    });
  });

  describe('cleanupStaleNodes', () => {
    it('should cleanup stale nodes', () => {
      registry.registerNode(createTestNode({ 
        nodeId: 'node-1',
        lastSeen: Date.now() - 10000
      }));
      registry.registerNode(createTestNode({ 
        nodeId: 'node-2',
        lastSeen: Date.now()
      }));

      const cleaned = registry.cleanupStaleNodes(5000);
      expect(cleaned).toBe(1);
      expect(registry.size).toBe(1);
      expect(registry.getNode('node-1')).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('should clear all nodes', () => {
      registry.registerNode(createTestNode());
      registry.registerNode(createTestNode({ nodeId: 'node-2' }));
      
      registry.clear();
      
      expect(registry.size).toBe(0);
    });

    it('should clear all indexes', () => {
      registry.registerNode(createTestNode({ 
        capabilities: ['camera'],
        connectionId: 'conn-1'
      }));
      
      registry.clear();
      
      expect(registry.findNodesByCapability('camera')).toHaveLength(0);
      expect(registry.getNodeByConnection('conn-1')).toBeUndefined();
    });
  });

  describe('size', () => {
    it('should return number of nodes', () => {
      expect(registry.size).toBe(0);
      
      registry.registerNode(createTestNode());
      expect(registry.size).toBe(1);
      
      registry.registerNode(createTestNode({ nodeId: 'node-2' }));
      expect(registry.size).toBe(2);
    });
  });
});

describe('NodeRegistry with initial nodes', () => {
  it('should accept initial nodes in constructor', () => {
    const mockLogger = createMockLogger();
    const initialNodes: Node[] = [
      createTestNode({ nodeId: 'node-1' }),
      createTestNode({ nodeId: 'node-2' }),
    ];

    const registry = new NodeRegistry({ initialNodes }, mockLogger);

    expect(registry.size).toBe(2);
    expect(registry.getNode('node-1')).toBeDefined();
    expect(registry.getNode('node-2')).toBeDefined();
  });
});
