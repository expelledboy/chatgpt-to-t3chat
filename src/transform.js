// Remove Node.js specific imports and configurations
// const fs = require("fs");

// Types of content we want to exclude from the final output
const EXCLUDED_CONTENT_TYPES = ["asset_pointer", "audio", "video"];

// Remove Node.js specific configuration
// const config = {
//   inputFile: process.env.INPUT_FILE,
//   outputFile: process.env.OUTPUT_FILE,
// };

// Utility functions for date handling
const dateUtils = {
  toISOString: (unixTimestamp) => new Date(unixTimestamp * 1000).toISOString(),
};

// Message utilities for handling edits and conversation paths
const messageUtils = {
  isIncompleteMessage: (message) => {
    return (
      message?.status === "in_progress" ||
      message?.status !== "finished_successfully"
    );
  },

  isEditNode: (node) => {
    return node.children && node.children.length > 1;
  },

  getLatestCompletePath: (node, conversationMap, validPaths = new Set()) => {
    if (!node || !node.children || node.children.length === 0) {
      return;
    }

    // Sort children by creation time to get the latest edit
    const sortedChildren = [...node.children].sort((a, b) => {
      const timeA = conversationMap[a]?.message?.create_time || 0;
      const timeB = conversationMap[b]?.message?.create_time || 0;
      return timeB - timeA;
    });

    // Find the first complete path
    for (const childId of sortedChildren) {
      const childNode = conversationMap[childId];
      if (!childNode || !childNode.message) continue;

      // Skip incomplete messages
      if (messageUtils.isIncompleteMessage(childNode.message)) {
        continue;
      }

      // Add this message to valid paths
      validPaths.add(childId);

      // Recursively process this child's path
      messageUtils.getLatestCompletePath(
        childNode,
        conversationMap,
        validPaths
      );

      // We found a complete path, stop checking other children
      break;
    }

    return validPaths;
  },

  isInValidPath: (messageId, conversationMap, validPathsCache) => {
    if (!messageId || !conversationMap[messageId]) return false;

    // If we've already validated this message
    if (validPathsCache.has(messageId)) {
      return true;
    }

    const node = conversationMap[messageId];

    // Always include messages that are being edited
    // (nodes that have multiple children)
    if (messageUtils.isEditNode(node)) {
      return true;
    }

    // Traverse up the parent chain
    let currentId = messageId;
    while (currentId) {
      const currentNode = conversationMap[currentId];
      if (!currentNode) break;

      // If this is an edit node, check if we're in the valid path
      if (messageUtils.isEditNode(currentNode)) {
        const validPaths = messageUtils.getLatestCompletePath(
          currentNode,
          conversationMap,
          new Set()
        );
        return validPaths.has(messageId);
      }

      currentId = currentNode.parent;
    }

    // If we didn't find any edit nodes, this message is valid
    return true;
  },
};

// Core data transformers
const transformers = {
  createThread: (conversation) => ({
    title: conversation.title,
    id: conversation.conversation_id,
    created_at: dateUtils.toISOString(conversation.create_time),
    updated_at: dateUtils.toISOString(conversation.update_time),
    last_message_at: null,
  }),

  cleanContent: (content) => {
    // Remove ChatGPT's special Unicode characters
    return content.replace(/[\ue200-\ue2ff]/g, "");
  },

  processMessageContent: (content) => {
    if (!content) return "";

    // Handle direct string content
    if (typeof content === "string") return transformers.cleanContent(content);

    // Handle text property
    if (content.text) return transformers.cleanContent(content.text);

    // Handle array of parts
    if (content.parts) {
      return content.parts
        .map(transformers.processContentPart)
        .filter(Boolean)
        .join("\n");
    }

    return "";
  },

  processContentPart: (part) => {
    if (typeof part !== "object") return transformers.cleanContent(part);

    // Handle audio transcriptions
    if (part.content_type === "audio_transcription") {
      return transformers.cleanContent(part.text);
    }

    // Skip excluded content types
    if (
      EXCLUDED_CONTENT_TYPES.some((type) => part.content_type?.includes(type))
    ) {
      return "";
    }

    return transformers.cleanContent(JSON.stringify(part));
  },

  getModelFromMessage: (message) => {
    // User messages don't have a model
    if (message.author.role === "user") {
      return null;
    }

    // For assistant messages, check various metadata locations
    return (
      message.metadata?.model_slug ||
      message.metadata?.default_model_slug ||
      "gpt-3.5-turbo" // fallback for older conversations
    );
  },

  createMessage: (message, threadId) => {
    // Skip tool messages and web commands
    if (
      message.author.role === "tool" ||
      (message.recipient === "web" && message.author.role === "assistant") ||
      EXCLUDED_CONTENT_TYPES.some((type) =>
        message.content?.content_type?.includes(type)
      )
    ) {
      return null;
    }

    const content = transformers.processMessageContent(message.content);

    // Skip empty messages
    if (!content.trim()) return null;

    return {
      threadId,
      role: message.author.role,
      content,
      status: "done",
      model: transformers.getModelFromMessage(message),
      id: message.id,
      created_at: dateUtils.toISOString(message.create_time),
    };
  },
};

// Main processing functions
const processor = {
  processConversation: (conversation, messageMap) => {
    const thread = transformers.createThread(conversation);
    const validPathsCache = new Set();

    // Process all messages in the conversation
    for (const nodeId in conversation.mapping) {
      const node = conversation.mapping[nodeId];
      if (!node.message) continue;

      // Skip messages that aren't in the valid path
      if (
        !messageUtils.isInValidPath(
          nodeId,
          conversation.mapping,
          validPathsCache
        )
      ) {
        continue;
      }

      // Skip incomplete messages
      if (messageUtils.isIncompleteMessage(node.message)) {
        continue;
      }

      const message = transformers.createMessage(node.message, thread.id);
      if (!message) continue;

      // Store message and update thread
      if (!messageMap.has(thread.id)) {
        messageMap.set(thread.id, []);
      }
      messageMap.get(thread.id).push(message);

      // Update thread's last message timestamp
      const messageDate = new Date(message.created_at);
      if (
        !thread.last_message_at ||
        messageDate > new Date(thread.last_message_at)
      ) {
        thread.last_message_at = message.created_at;
      }

      // Add to valid paths cache
      validPathsCache.add(nodeId);
    }

    return thread;
  },

  transformData: (chatgptData) => {
    const messageMap = new Map();
    const threads = chatgptData.map((conversation) =>
      processor.processConversation(conversation, messageMap)
    );
    const messages = Array.from(messageMap.values()).flat();

    return { threads, messages };
  },
};

// Modify the main processing functions to export them
export function transformData(chatgptData) {
  const messageMap = new Map();
  const threads = chatgptData.map((conversation) =>
    processor.processConversation(conversation, messageMap)
  );
  const messages = Array.from(messageMap.values()).flat();

  return { threads, messages };
}
