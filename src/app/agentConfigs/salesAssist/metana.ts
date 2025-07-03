import { RealtimeAgent } from "@openai/agents/realtime";
// import { getNextResponseFromSupervisor } from "./supervisorAgent";
import apexPrompt from "./prompt";


export const salesAssistAgent = new RealtimeAgent({
  name: "salesAssist",
  voice: "sage",
  instructions: apexPrompt,
  tools: [],
});

export const salesAssistScenario = [salesAssistAgent];

export default salesAssistScenario;
