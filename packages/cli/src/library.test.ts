
import { describe, it, expect, vi } from 'vitest';
import { initialize, streamQuery, BotMessage } from './library.js';
import { Config, GeminiClient } from '@google/gemini-cli-core';

vi.mock('@google/gemini-cli-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/gemini-cli-core')>();
  return {
    ...actual,
    GeminiClient: vi.fn(),
  };
});

vi.mock('./tool-scheduler.js', () => {
  return {
    ToolScheduler: vi.fn().mockImplementation(() => {
      return {
        execute: vi.fn().mockResolvedValue([{ callId: '123', result: 'tool result' }]),
      };
    }),
  };
});

describe('library', () => {
  it('should handle a multi-turn conversation with a tool call', async () => {
    const mockSendMessageStream = vi
      .fn()
      .mockImplementationOnce(async function* () {
        yield { type: 'tool_call_request', value: { callId: '123', name: 'run_shell_command', args: { command: 'ls' } } };
      })
      .mockImplementationOnce(async function* () {
        yield { type: 'content', value: 'final answer' };
      });

    const mockConfig = {
      getToolRegistry: () => ({
        getTool: vi.fn(),
      }),
      getGeminiClient: vi.fn().mockReturnValue({
        sendMessageStream: mockSendMessageStream,
      }),
      getSessionId: () => 'session-id',
    } as unknown as Config;

    const messages: BotMessage[] = [];
    const callback = (message: BotMessage) => {
      messages.push(message);
    };

    await streamQuery(mockConfig, 'initial prompt', callback);

    // This is a hack to get the name of the tool.
    // In a real scenario, the tool name would be part of the response.
    const toolName = 'run_shell_command';

    expect(messages).toEqual([
      {
        type: 'tool_call_request',
        request: { callId: '123', name: 'run_shell_command', args: { command: 'ls' } },
      },
      { type: 'content', content: 'final answer' },
    ]);

    expect(mockSendMessageStream).toHaveBeenCalledTimes(2);
    expect(mockSendMessageStream).toHaveBeenCalledWith(
      'initial prompt',
      expect.any(AbortSignal),
      expect.any(String)
    );
    expect(mockSendMessageStream).toHaveBeenCalledWith(
      [{ functionResponse: { name: toolName, response: { name: toolName, content: 'tool result' } } }],
      expect.any(AbortSignal),
      expect.any(String)
    );
  });
});
