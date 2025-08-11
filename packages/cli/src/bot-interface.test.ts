
import { describe, it, expect, vi } from 'vitest';
import { runGeminiCli } from './bot-interface';

describe('runGeminiCli', () => {
  it('should call the callback with the prompt and a placeholder message', async () => {
    const callback = vi.fn();
    const prompt = 'test prompt';

    await runGeminiCli(prompt, callback);

    expect(callback).toHaveBeenCalledWith(`Running Gemini CLI with prompt: "${prompt}"`);
    expect(callback).toHaveBeenCalledWith('This is a placeholder response from the Gemini CLI.');
  });
});
