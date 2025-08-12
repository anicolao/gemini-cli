/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  sessionId,
  GeminiClient,
  PartListUnion,
  ToolCallRequestInfo,
  ThoughtSummary,
  ServerGeminiStreamEvent,
} from '@google/gemini-cli-core';
import { FinishReason, Part } from '@google/genai';
import { loadCliConfig } from './config/config.js';
import { loadSettings } from './config/settings.js';
import { loadExtensions } from './config/extension.js';
import { getErrorMessage } from '@google/gemini-cli-core';
import { ToolScheduler, ToolResult } from './tool-scheduler.js';
import { validateAuthMethod } from './config/auth.js';

// Re-exporting this type for the bot's convenience.
export type { PartListUnion } from '@google/gemini-cli-core';

/**
 * A structured message object that the library will send to the bot.
 */
export type BotMessage =
  | { type: 'content'; content: string }
  | { type: 'thought'; thought: ThoughtSummary }
  | { type: 'tool_call_request'; request: ToolCallRequestInfo }
  | { type: 'tool_result'; request: ToolCallRequestInfo; result: ToolResult }
  | { type: 'error'; error: string }
  | { type: 'info'; message: string }
  | { type: 'finished'; reason: FinishReason; prompt_id: string };

/**
 * The callback function that the bot will provide to receive structured messages.
 */
export type BotMessageCallback = (message: BotMessage) => void;

/**
 * One-time initialization for the Gemini CLI library.
 * This should be called by the bot on startup.
 * @returns The initialized Config object.
 */
export async function initialize(): Promise<Config> {
  const workspaceRoot = process.cwd();
  const settings = loadSettings(workspaceRoot);
  if (settings.errors.length > 0) {
    // In a library context, we can't just exit. Throw an error.
    const errorMessages = settings.errors
      .map((error) => `Error in ${error.path}: ${error.message}`)
      .join('\n');
    throw new Error(`Failed to load settings:\n${errorMessages}`);
  }

  // Crucial check for authentication.
  if (!settings.merged.selectedAuthType) {
    throw new Error(
      'Authentication not configured. Please run `gemini auth` or `gemini init` to set up your authentication method.',
    );
  }

  const extensions = loadExtensions(workspaceRoot);
  const config = await loadCliConfig(
    settings.merged,
    extensions,
    sessionId,
    // We are not running in interactive mode, so we can provide mock argv.
    { interactive: false },
  );

  // Initialize first, so all components are ready.
  await config.initialize();

  // Then, refresh auth.
  try {
    const err = validateAuthMethod(settings.merged.selectedAuthType);
    if (err) {
      throw new Error(err);
    }
    await config.refreshAuth(settings.merged.selectedAuthType);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(`Authentication failed: ${errorMessage}`);
  }

  // Final check to ensure the client was created successfully.
  if (!config.getGeminiClient()) {
    throw new Error('Gemini client could not be initialized. This may be due to an issue with your authentication credentials.');
  }

  return config;
}

async function processStream(
  stream: AsyncIterable<ServerGeminiStreamEvent>,
  callback: BotMessageCallback,
  prompt_id: string,
): Promise<ToolCallRequestInfo[]> {
  const toolCallRequests: ToolCallRequestInfo[] = [];

  for await (const event of stream) {
    switch (event.type) {
      case 'thought':
        callback({ type: 'thought', thought: event.value });
        break;
      case 'content':
        callback({ type: 'content', content: event.value });
        break;
      case 'tool_call_request':
        toolCallRequests.push(event.value);
        callback({ type: 'tool_call_request', request: event.value });
        break;
      case 'error':
        callback({ type: 'error', error: JSON.stringify(event.value) });
        break;
      case 'finished':
        callback({
          type: 'finished',
          reason: event.value,
          prompt_id: prompt_id,
        });
        break;
      case 'user_cancelled':
        callback({ type: 'info', message: 'Request cancelled by user.' });
        break;
      case 'chat_compressed':
        callback({
          type: 'info',
          message: 'Chat history was compressed.',
        });
        break;
      case 'loop_detected':
        callback({
          type: 'error',
          error: 'Loop detected. Halting execution.',
        });
        break;
      case 'tool_call_confirmation':
      case 'tool_call_response':
      case 'max_session_turns':
        break;
      default:
        const unreachable: never = event;
        callback({
          type: 'error',
          error: `Unknown event type: ${unreachable}`,
        });
    }
  }
  return toolCallRequests;
}

/**
 * Processes a user query and streams the response back via structured messages.
 * This function now handles multi-turn conversations involving tool calls.
 *
 * @param config The initialized Config object from initialize().
 * @param prompt The user's query or tool response.
 * @param callback The function to call with structured status and result messages.
 * @returns A promise that resolves when the conversation turn is fully processed.
 */
export async function streamQuery(
  config: Config,
  prompt: PartListUnion,
  callback: BotMessageCallback,
): Promise<void> {
  const geminiClient = config.getGeminiClient();
  if (!geminiClient) {
    throw new Error('Gemini client is not initialized.');
  }

  const toolScheduler = new ToolScheduler(config);
  let currentPrompt: PartListUnion = prompt;

  try {
    // This loop continues as long as the model requests tool calls.
    while (true) {
      const abortController = new AbortController();
      const prompt_id = config.getSessionId() + '########' + Math.random();

      const stream = geminiClient.sendMessageStream(
        currentPrompt,
        abortController.signal,
        prompt_id,
      );

      const toolCallRequests = await processStream(
        stream,
        callback,
        prompt_id,
      );

      // If there are no more tool calls, the conversation turn is over.
      if (toolCallRequests.length === 0) {
        break;
      }

      // Execute the requested tool calls.
      const toolResults = await toolScheduler.execute(toolCallRequests);

      // Inform the bot about the tool results.
      for (const result of toolResults) {
        const originalRequest = toolCallRequests.find(
          (req) => req.callId === result.callId,
        );
        if (originalRequest) {
          callback({ type: 'tool_result', request: originalRequest, result });
        }
      }

      // Prepare the tool results to be sent back to the model.
      const toolResponseParts: Part[] = toolResults.map((result) => {
        // Find the original request to get the tool name
        const originalRequest = toolCallRequests.find(
          (req) => req.callId === result.callId,
        );
        return {
          functionResponse: {
            name: originalRequest?.name || '',
            response: {
              name: originalRequest?.name || '',
              content: result.result,
            },
          },
        };
      });

      currentPrompt = toolResponseParts;
    }
  } catch (error) {
    callback({ type: 'error', error: getErrorMessage(error) });
  }
}
