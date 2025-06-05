import { RealtimeAgent } from "@openai/agents/realtime";
import { getNextResponseFromSupervisor } from "./supervisorAgent";

export const chatAgent = new RealtimeAgent({
  name: "chatAgent",
  voice: "sage",
  instructions: `
You are a chat agent to take down tasks. You will be given a message from the user and you will need to respond to the user. You will need to use the tools provided to you to complete the task. You will need to use the handoffs to complete the task. You will need to use the tools to complete the task. You will need to use the handoffs to complete the task. You will need to use the tools to complete the task. You will need to use the handoffs to complete the task.
`,
  tools: [getNextResponseFromSupervisor],
});

export const chatSupervisorScenario = [chatAgent];

export default chatSupervisorScenario;
