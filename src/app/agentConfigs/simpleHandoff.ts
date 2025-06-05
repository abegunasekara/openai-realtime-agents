import { RealtimeAgent } from "@openai/agents/realtime";

// export const haikuWriterAgent = new RealtimeAgent({
//   name: '',
//   voice: 'sage',
//   instructions:
//     'Ask the user for a topic, then reply with a haiku about that topic.',
//   handoffs: [],
//   tools: [],
//   handoffDescription: 'Agent that writes haikus',
// });

export const greeterAgent = new RealtimeAgent({
  name: "taskListDown",
  voice: "sage",
  instructions:
    "You are a task list down agent. You will be given a task and you will need to complete it. You will need to use the tools provided to you to complete the task. You will need to use the handoffs to complete the task. You will need to use the tools to complete the task. You will need to use the handoffs to complete the task. You will need to use the tools to complete the task. You will need to use the handoffs to complete the task.",
  // handoffs: [haikuWriterAgent],
  tools: [],
  handoffDescription: "Agent that completes tasks",
});

export const simpleHandoffScenario = [greeterAgent];
