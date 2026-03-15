import { describe, it, expect } from 'vitest';
import {
  createToolDefinition,
  createToolCallResult,
  validateToolCall,
  type ToolDefinition,
  type ToolCallResult,
} from '../src/tools';

describe('Tools', () => {
  describe('createToolDefinition', () => {
    it('should create a tool definition', () => {
      const tool = createToolDefinition(
        'get_weather',
        'Get current weather for a location',
        {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'City name',
            },
            unit: {
              type: 'string',
              enum: ['celsius', 'fahrenheit'],
              default: 'celsius',
            },
          },
          required: ['location'],
        }
      );

      expect(tool.name).toBe('get_weather');
      expect(tool.description).toBe('Get current weather for a location');
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.properties?.['location']?.type).toBe('string');
      expect(tool.parameters.required).toContain('location');
    });

    it('should create a tool definition with nested parameters', () => {
      const tool = createToolDefinition('search', 'Search for items', {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          filters: {
            type: 'object',
            properties: {
              category: { type: 'string' },
              priceRange: {
                type: 'object',
                properties: {
                  min: { type: 'number' },
                  max: { type: 'number' },
                },
              },
            },
          },
        },
        required: ['query'],
      });

      expect(tool.name).toBe('search');
      expect(tool.parameters.properties?.['filters']?.type).toBe('object');
    });

    it('should create a tool definition with array items', () => {
      const tool = createToolDefinition('batch_process', 'Process multiple items', {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      });

      expect(tool.parameters.properties?.['items']?.type).toBe('array');
      expect(tool.parameters.properties?.['items']?.items?.type).toBe('string');
    });
  });

  describe('createToolCallResult', () => {
    it('should create a successful tool call result', () => {
      const result = createToolCallResult(
        'call_123',
        'get_weather',
        '{"temperature": 22, "condition": "sunny"}'
      );

      expect(result.toolCallId).toBe('call_123');
      expect(result.name).toBe('get_weather');
      expect(result.content).toBe('{"temperature": 22, "condition": "sunny"}');
      expect(result.isError).toBe(false);
    });

    it('should create an error tool call result', () => {
      const result = createToolCallResult(
        'call_456',
        'get_weather',
        'Error: API unavailable',
        true
      );

      expect(result.toolCallId).toBe('call_456');
      expect(result.isError).toBe(true);
    });
  });

  describe('validateToolCall', () => {
    it('should return true when tool call matches definition', () => {
      const definition: ToolDefinition = {
        name: 'get_weather',
        description: 'Get weather',
        parameters: { type: 'object' },
      };

      const isValid = validateToolCall(
        { id: 'call_123', name: 'get_weather', arguments: '{}' },
        definition
      );

      expect(isValid).toBe(true);
    });

    it('should return false when tool call does not match definition', () => {
      const definition: ToolDefinition = {
        name: 'get_weather',
        description: 'Get weather',
        parameters: { type: 'object' },
      };

      const isValid = validateToolCall(
        { id: 'call_123', name: 'different_tool', arguments: '{}' },
        definition
      );

      expect(isValid).toBe(false);
    });
  });

  describe('ToolCallResult type', () => {
    it('should define valid tool call results', () => {
      const results: ToolCallResult[] = [
        { toolCallId: 'call_1', name: 'tool_a', content: 'result_a' },
        { toolCallId: 'call_2', name: 'tool_b', content: 'result_b', isError: true },
      ];

      expect(results).toHaveLength(2);
      expect(results[0]?.isError).toBeFalsy();
      expect(results[1]?.isError).toBe(true);
    });
  });
});
