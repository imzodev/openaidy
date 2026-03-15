import { describe, it, expect } from 'vitest';
import {
  isSystemMessage,
  isUserMessage,
  isAssistantMessage,
  isToolResultMessage,
  type Message,
  type SystemMessage,
  type UserMessage,
  type AssistantMessage,
  type ToolResultMessage,
} from '../src/messages';

describe('Messages', () => {
  describe('isSystemMessage', () => {
    it('should return true for system messages', () => {
      const message: SystemMessage = {
        role: 'system',
        content: 'You are a helpful assistant.',
      };
      expect(isSystemMessage(message)).toBe(true);
    });

    it('should return false for non-system messages', () => {
      const message: UserMessage = { role: 'user', content: 'Hello' };
      expect(isSystemMessage(message)).toBe(false);
    });
  });

  describe('isUserMessage', () => {
    it('should return true for user messages', () => {
      const message: UserMessage = { role: 'user', content: 'Hello' };
      expect(isUserMessage(message)).toBe(true);
    });

    it('should return false for non-user messages', () => {
      const message: SystemMessage = {
        role: 'system',
        content: 'System message',
      };
      expect(isUserMessage(message)).toBe(false);
    });
  });

  describe('isAssistantMessage', () => {
    it('should return true for assistant messages without tool calls', () => {
      const message: AssistantMessage = {
        role: 'assistant',
        content: 'Hello! How can I help?',
      };
      expect(isAssistantMessage(message)).toBe(true);
    });

    it('should return true for assistant messages with tool calls', () => {
      const message: AssistantMessage = {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call_123',
            name: 'get_weather',
            arguments: '{"location": "Berlin"}',
          },
        ],
      };
      expect(isAssistantMessage(message)).toBe(true);
      expect(message.toolCalls).toHaveLength(1);
      expect(message.toolCalls?.[0]?.name).toBe('get_weather');
    });

    it('should return false for non-assistant messages', () => {
      const message: UserMessage = { role: 'user', content: 'Hello' };
      expect(isAssistantMessage(message)).toBe(false);
    });
  });

  describe('isToolResultMessage', () => {
    it('should return true for tool result messages', () => {
      const message: ToolResultMessage = {
        role: 'tool',
        toolCallId: 'call_123',
        content: '{"temperature": 22}',
      };
      expect(isToolResultMessage(message)).toBe(true);
    });

    it('should return true for tool result messages with error flag', () => {
      const message: ToolResultMessage = {
        role: 'tool',
        toolCallId: 'call_123',
        content: 'Error: API unavailable',
        isError: true,
      };
      expect(isToolResultMessage(message)).toBe(true);
      expect(message.isError).toBe(true);
    });

    it('should return false for non-tool result messages', () => {
      const message: AssistantMessage = {
        role: 'assistant',
        content: 'Response',
      };
      expect(isToolResultMessage(message)).toBe(false);
    });
  });

  describe('Message type union', () => {
    it('should accept all message types', () => {
      const messages: Message[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User question' },
        { role: 'assistant', content: 'Assistant response' },
        { role: 'tool', toolCallId: 'call_123', content: 'Tool result' },
      ];

      expect(messages).toHaveLength(4);
      expect(messages.filter(isSystemMessage)).toHaveLength(1);
      expect(messages.filter(isUserMessage)).toHaveLength(1);
      expect(messages.filter(isAssistantMessage)).toHaveLength(1);
      expect(messages.filter(isToolResultMessage)).toHaveLength(1);
    });
  });
});
