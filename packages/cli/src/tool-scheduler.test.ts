
import { describe, it, expect, vi } from 'vitest';
import { ToolScheduler } from './tool-scheduler.js';
import { Config, ShellExecutionService, AnyToolInvocation, Tool, ToolAction } from '@google/gemini-cli-core';

// Mock the ShellExecutionService
vi.mock('@google/gemini-cli-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/gemini-cli-core')>();
  return {
    ...actual,
    ShellExecutionService: {
      execute: vi.fn(),
    },
  };
});

describe('ToolScheduler', () => {
  it('should execute a shell command', async () => {
    const mockConfig = {
      getTargetDir: () => '/tmp',
    } as unknown as Config;

    const mockResult = {
      output: 'hello world',
      error: null,
      aborted: false,
      signal: null,
      exitCode: 0,
      rawOutput: 'hello world',
    };

    (ShellExecutionService.execute as vi.Mock).mockReturnValue({
      result: Promise.resolve(mockResult),
    });

    const scheduler = new ToolScheduler(mockConfig);
    const requests = [
      {
        callId: '123',
        name: 'run_shell_command',
        args: { command: 'echo "hello world"' },
      },
    ];

    const results = await scheduler.execute(requests);

    expect(results).toHaveLength(1);
    expect(results[0].callId).toBe('123');
    expect(results[0].result).toBe('hello world');
    expect(ShellExecutionService.execute).toHaveBeenCalledWith(
      'echo "hello world"',
      '/tmp'
    );
  });

  it('should execute read_many_files', async () => {
    const mockReadManyFilesTool = {
      build: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue({
          llmContent: 'file content',
        }),
      } as unknown as AnyToolInvocation),
    } as unknown as Tool<ToolAction<any, any>>;

    const mockConfig = {
      getToolRegistry: () => ({
        getTool: vi.fn().mockReturnValue(mockReadManyFilesTool),
      }),
    } as unknown as Config;

    const scheduler = new ToolScheduler(mockConfig);
    const requests = [
      {
        callId: '456',
        name: 'read_many_files',
        args: { paths: ['foo.txt'] },
      },
    ];

    const results = await scheduler.execute(requests);

    expect(results).toHaveLength(1);
    expect(results[0].callId).toBe('456');
    expect(results[0].result).toBe('file content');
    expect(mockReadManyFilesTool.build).toHaveBeenCalledWith({ paths: ['foo.txt'] });
  });

  it('should execute read_file', async () => {
    const mockReadFileTool = {
      build: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue({
          llmContent: 'file content',
        }),
      } as unknown as AnyToolInvocation),
    } as unknown as Tool<ToolAction<any, any>>;

    const mockConfig = {
      getToolRegistry: () => ({
        getTool: vi.fn().mockReturnValue(mockReadFileTool),
      }),
    } as unknown as Config;

    const scheduler = new ToolScheduler(mockConfig);
    const requests = [
      {
        callId: '111',
        name: 'read_file',
        args: { path: 'foo.txt' },
      },
    ];

    const results = await scheduler.execute(requests);

    expect(results).toHaveLength(1);
    expect(results[0].callId).toBe('111');
    expect(results[0].result).toBe('file content');
    expect(mockReadFileTool.build).toHaveBeenCalledWith({ path: 'foo.txt' });
  });

  it('should execute write_file', async () => {
    const mockWriteFileTool = {
      build: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue({
          llmContent: 'File written.',
        }),
      } as unknown as AnyToolInvocation),
    } as unknown as Tool<ToolAction<any, any>>;

    const mockConfig = {
      getToolRegistry: () => ({
        getTool: vi.fn().mockReturnValue(mockWriteFileTool),
      }),
    } as unknown as Config;

    const scheduler = new ToolScheduler(mockConfig);
    const requests = [
      {
        callId: '789',
        name: 'write_file',
        args: { path: 'foo.txt', content: 'bar' },
      },
    ];

    const results = await scheduler.execute(requests);

    expect(results).toHaveLength(1);
    expect(results[0].callId).toBe('789');
    expect(results[0].result).toBe('File written.');
    expect(mockWriteFileTool.build).toHaveBeenCalledWith({ path: 'foo.txt', content: 'bar' });
  });

  it('should execute replace', async () => {
    const mockReplaceTool = {
      build: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue({
          llmContent: 'Content replaced.',
        }),
      } as unknown as AnyToolInvocation),
    } as unknown as Tool<ToolAction<any, any>>;

    const mockConfig = {
      getToolRegistry: () => ({
        getTool: vi.fn().mockReturnValue(mockReplaceTool),
      }),
    } as unknown as Config;

    const scheduler = new ToolScheduler(mockConfig);
    const requests = [
      {
        callId: '101',
        name: 'replace',
        args: { path: 'foo.txt', old_string: 'bar', new_string: 'baz' },
      },
    ];

    const results = await scheduler.execute(requests);

    expect(results).toHaveLength(1);
    expect(results[0].callId).toBe('101');
    expect(results[0].result).toBe('Content replaced.');
    expect(mockReplaceTool.build).toHaveBeenCalledWith({ path: 'foo.txt', old_string: 'bar', new_string: 'baz' });
  });
});
