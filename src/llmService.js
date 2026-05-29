import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

/**
 * Streams a message from the configured LLM provider.
 * @param {Array} history - The chat history (format: [{role: 'user'|'jarvis', text: '...'}])
 * @param {Object} config - The LLM configuration
 * @param {Function} onChunk - Callback fired for each new text chunk
 * @param {AbortSignal} abortSignal - Optional signal to abort the generation
 */
export async function streamLLMResponse(history, config, onChunk, abortSignal = null, ragContext = null) {
  const { provider, geminiKey, openaiKey, ollamaUrl, ollamaModel, speechLanguage } = config;
  const isIt = speechLanguage?.startsWith('it') || false;
  const langName = isIt ? 'Italian' : 'English';

  if (provider === 'gemini') {
    if (!geminiKey) throw new Error("Gemini API key is missing. Please add it in System Preferences.");
    const ai = new GoogleGenAI({ apiKey: geminiKey });
    
    // Only send the last 6 messages (3 conversation turns) to minimize token usage
    const trimmedHistory = history.slice(-6);
    const contents = trimmedHistory.map(msg => ({
      role: msg.role === 'jarvis' ? 'model' : 'user',
      parts: [{ text: msg.text }]
    }));
    
    let systemInstruction = `You are Jarvis. Act as a proactive company representative. You MUST write your response in ${langName}. Keep your responses extremely concise (1-2 sentences max).`;
    if (ragContext && ragContext.length > 0) {
      systemInstruction += "\n\nYou have access to the following Knowledge Base projects/articles:\n";
      ragContext.forEach(article => {
         systemInstruction += `\n--- ID: ${article.id} | Title: ${article.title} ---\n${article.content}\n`;
      });
      systemInstruction += `\nIf the user's query relates to these projects, use the information to answer. If you recommend a project or talk about it in detail, you MUST include the exact tag [MEDIA:{ID}] (e.g. [MEDIA:1]) in your response to trigger the visual media gallery. Do not include the tag if you are just answering a generic greeting.`;
    }
    
    const responseStream = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents,
      systemInstruction,
    }, { signal: abortSignal });
    
    try {
      for await (const chunk of responseStream) {
        if (abortSignal?.aborted) break;
        if (chunk.text) onChunk(chunk.text);
      }
    } catch (e) {
      if (e.name === 'AbortError' || abortSignal?.aborted) {
        console.log("LLM stream aborted");
        return;
      }
      throw e;
    }
    return;
  }

  // OpenAI and Ollama both support the OpenAI SDK interface
  const isOllama = provider === 'ollama';
  const apiKey = isOllama ? 'ollama' : openaiKey;
  if (!isOllama && !apiKey) throw new Error("OpenAI API key is missing. Please add it in System Preferences.");
  if (isOllama && !ollamaUrl) throw new Error("Ollama URL is missing. Please add it in System Preferences.");

  const openai = new OpenAI({ 
    baseURL: isOllama ? (ollamaUrl.endsWith('/') ? `${ollamaUrl}v1` : `${ollamaUrl}/v1`) : undefined, 
    apiKey: apiKey,
    dangerouslyAllowBrowser: true 
  });
  
  // Only send the last 6 messages (3 conversation turns) to minimize token usage
  const trimmedHistory = history.slice(-6);
  let messages = trimmedHistory.map(msg => ({
    role: msg.role === 'jarvis' ? 'assistant' : 'user',
    content: msg.text
  }));

  let systemInstruction = `You are Jarvis. Act as a proactive company representative. You MUST write your response in ${langName}. Keep your responses extremely concise (1-2 sentences max).`;
  if (ragContext && ragContext.length > 0) {
    systemInstruction += "\n\nYou have access to the following Knowledge Base projects/articles:\n";
    ragContext.forEach(article => {
       systemInstruction += `\n--- ID: ${article.id} | Title: ${article.title} ---\n${article.content}\n`;
    });
    systemInstruction += `\nIf the user's query relates to these projects, use the information to answer. If you recommend a project or talk about it in detail, you MUST include the exact tag [MEDIA:{ID}] (e.g. [MEDIA:1]) in your response to trigger the visual media gallery. Do not include the tag if you are just answering a generic greeting.`;
  }
  
  messages.unshift({ role: 'system', content: systemInstruction });

  try {
    const stream = await openai.chat.completions.create({
      model: isOllama ? (ollamaModel || 'llama3') : 'gpt-4o-mini',
      messages,
      stream: true,
    }, { signal: abortSignal });

    for await (const chunk of stream) {
      if (abortSignal?.aborted) break;
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) onChunk(content);
    }
  } catch (e) {
    if (e.name === 'AbortError' || abortSignal?.aborted) {
      console.log("LLM stream aborted");
      return;
    }
    throw e;
  }
}

/**
 * Generates a mathematical vector embedding for the given text.
 */
export async function generateEmbedding(text, config) {
  const { provider, geminiKey, openaiKey } = config;

  if (provider === 'gemini') {
    if (!geminiKey) throw new Error("Gemini API key is missing.");
    const ai = new GoogleGenAI({ apiKey: geminiKey });
    
    const response = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: text
    });
    return response.embeddings[0].values;
  }
  
  if (provider === 'openai' || provider === 'ollama') {
    const isOllama = provider === 'ollama';
    const apiKey = isOllama ? 'ollama' : openaiKey;
    if (!isOllama && !apiKey) throw new Error("OpenAI API key is missing.");
    
    const openai = new OpenAI({ 
      baseURL: isOllama ? (config.ollamaUrl?.endsWith('/') ? `${config.ollamaUrl}v1` : `${config.ollamaUrl}/v1`) : undefined, 
      apiKey: apiKey,
      dangerouslyAllowBrowser: true 
    });
    
    const response = await openai.embeddings.create({
      model: isOllama ? 'nomic-embed-text' : 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  }
  
  throw new Error("Unsupported provider for embeddings.");
}
