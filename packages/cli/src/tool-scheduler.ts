
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  ToolCallRequestInfo,
  ShellExecutionService,
  isBinary,
  getErrorMessage,
  AnyToolInvocation,
} from '@google/gemini-cli-core';

// A simple result structure for the scheduler to return.
export interface ToolResult {
  callId: string;
  result: string;
}

/**
 * A class for scheduling and executing tool calls without a React context.
 */
export class ToolScheduler {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Executes a set of tool calls.
   * @param requests An array of tool call requests from the Gemini API.
   * @returns A promise that resolves with an array of tool results.
   */
  async execute(requests: ToolCallRequestInfo[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const request of requests) {
      let resultText: string;
      try {
        switch (request.name) {
          case 'run_shell_command':
            resultText = await this.runShellCommand(request.args['command'] as string);
            break;
          case 'read_many_files':
            resultText = await this.readManyFiles(request.args as any);
            break;
          case 'read_file':
            resultText = await this.readFile(request.args as any);
            break;
          case 'write_file':
            resultText = await this.writeFile(request.args as any);
            break;
          case 'replace':
            resultText = await this.replace(request.args as any);
            break;
          default:
            resultText = `[ERROR] Tool '${request.name}' is not implemented.`;
        }
      } catch (e) {
        const error = e as Error;
        resultText = `[ERROR] Tool '${request.name}' failed: ${error.message}`;
      }

      results.push({
        callId: request.callId,
        result: resultText,
      });
    }
    return results;
  }

  private async readFile(args: { path: string }): Promise<string> {
    const toolRegistry = await this.config.getToolRegistry();
    const readFileTool = toolRegistry.getTool('read_file');
    if (!readFileTool) {
      return '[ERROR] read_file tool not found.';
    }

    let invocation: AnyToolInvocation | undefined = undefined;
    try {
      invocation = readFileTool.build(args);
      const result = await invocation.execute(new AbortController().signal); // TODO: Plumb abort signal
      return result.llmContent?.toString() || '';
    } catch (error: unknown) {
      return `[ERROR] Error reading file: ${getErrorMessage(error)}`;
    }
  }

  private async replace(args: { path: string; old_string: string, new_string: string }): Promise<string> {
    const toolRegistry = await this.config.getToolRegistry();
    const replaceTool = toolRegistry.getTool('replace');
    if (!replaceTool) {
      return '[ERROR] replace tool not found.';
    }

    let invocation: AnyToolInvocation | undefined = undefined;
    try {
      invocation = replaceTool.build(args);
      const result = await invocation.execute(new AbortController().signal); // TODO: Plumb abort signal
      return result.llmContent?.toString() || '';
    } catch (error: unknown) {
      return `[ERROR] Error replacing content: ${getErrorMessage(error)}`;
    }
  }

  private async writeFile(args: { path: string; content: string }): Promise<string> {
    const toolRegistry = await this.config.getToolRegistry();
    const writeFileTool = toolRegistry.getTool('write_file');
    if (!writeFileTool) {
      return '[ERROR] write_file tool not found.';
    }

    let invocation: AnyToolInvocation | undefined = undefined;
    try {
      invocation = writeFileTool.build(args);
      const result = await invocation.execute(new AbortController().signal); // TODO: Plumb abort signal
      return result.llmContent?.toString() || '';
    } catch (error: unknown) {
      return `[ERROR] Error writing file: ${getErrorMessage(error)}`;
    }
  }

  private async readManyFiles(args: { paths: string[] }): Promise<string> {
    const toolRegistry = await this.config.getToolRegistry();
    const readManyFilesTool = toolRegistry.getTool('read_many_files');
    if (!readManyFilesTool) {
      return '[ERROR] read_many_files tool not found.';
    }

    let invocation: AnyToolInvocation | undefined = undefined;
    try {
      invocation = readManyFilesTool.build(args);
      const result = await invocation.execute(new AbortController().signal); // TODO: Plumb abort signal
      if (Array.isArray(result.llmContent)) {
        return result.llmContent.join('\n');
      }
      return result.llmContent?.toString() || '';
    } catch (error: unknown) {
      return `[ERROR] Error reading files: ${getErrorMessage(error)}`;
    }
  }

  private async runShellCommand(command: string): Promise<string> {
    if (!command) {
      return '[ERROR] No command provided to run_shell_command.';
    }

    const targetDir = this.config.getTargetDir();
    const { result } = ShellExecutionService.execute(command, targetDir);
    const executionResult = await result;

    if (executionResult.error) {
      return `[ERROR] ${executionResult.error.message}\n${executionResult.output}`;
    }
    if (executionResult.aborted) {
      return `[CANCELLED] Command was cancelled.\n${executionResult.output}`;
    }
    if (executionResult.signal) {
      return `[ERROR] Command terminated by signal: ${executionResult.signal}.\n${executionResult.output}`;
    }
    if (executionResult.exitCode !== 0) {
      return `[ERROR] Command exited with code ${executionResult.exitCode}.\n${executionResult.output}`;
    }
    if (isBinary(executionResult.rawOutput)) {
      return '[Command produced binary output, which is not shown.]';
    }

    return executionResult.output.trim() || '(Command produced no output)';
  }
}
