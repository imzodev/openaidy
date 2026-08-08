import { describe, it, expect } from 'vitest';
import { computeAutoLayout } from './workflow-layout';

describe('computeAutoLayout', () => {
  it('places a single node', () => {
    const positions = computeAutoLayout(['a'], []);
    expect(positions.a).toBeDefined();
    expect(typeof positions.a!.x).toBe('number');
    expect(typeof positions.a!.y).toBe('number');
  });

  it('places dependent nodes below their dependency, distinct positions', () => {
    const positions = computeAutoLayout(['a', 'b'], [{ from: 'a', to: 'b' }]);
    expect(positions.a).toBeDefined();
    expect(positions.b).toBeDefined();
    expect(positions.b!.y).toBeGreaterThan(positions.a!.y);
  });

  it('gives every node a distinct position for a small diamond graph', () => {
    const positions = computeAutoLayout(
      ['a', 'b', 'c', 'd'],
      [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
        { from: 'b', to: 'd' },
        { from: 'c', to: 'd' },
      ],
    );
    const coords = Object.values(positions).map((p) => `${p.x},${p.y}`);
    expect(new Set(coords).size).toBe(4);
  });

  it('still places disconnected nodes without throwing', () => {
    const positions = computeAutoLayout(['a', 'b', 'c'], []);
    expect(Object.keys(positions)).toHaveLength(3);
  });

  it('ignores edges referencing unknown node ids', () => {
    const positions = computeAutoLayout(['a'], [{ from: 'a', to: 'ghost' }]);
    expect(positions.a).toBeDefined();
    expect(positions.ghost).toBeUndefined();
  });
});
