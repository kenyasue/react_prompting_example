import { Configuration, OpenAIApi } from "openai";
import type { GoogleParameters } from "serpapi";
import { getJson } from "serpapi";
import dotenv from "dotenv";
dotenv.config();

// how many times allow to search the result
const MaxToolAttemptLimit = 5;

class reAct {

    openai: OpenAIApi;
    currentPrompt: string;

    constructor() {
        const configuration = new Configuration({
            apiKey: process.env.OPENAI_API_KEY,
        });
        this.openai = new OpenAIApi(configuration);
        this.currentPrompt = "";
    }

    async getTemplate(params: any): Promise<string> {

        const prompt: string = `
Answer the following questions as best you can. You have access to the following tools:

search: a search engine. useful for when you need to answer questions about current events. input should be a search query.

Use the following format in your response, the order is very important you shold keep this order in the response.

1.Question: the input question you must answer
2.Thought: you should always think about what to do. No need to answer the Action and Action Input if you know the answer.
3.Action: the action to take, should be one of [search]
4.Action Input: the input to the action
1.Observation: the result of the action
... (this Thought/Action/Action Input/Observation can repeat N times)
2.Thought: I now know the final answer
3.Final Answer: the final answer to the original input question

Begin!

1.Question: ${params.input}
`;

        return prompt;

    }

    async executeTool(toolName: string, toolInput: string): Promise<string> {

        let toolResult: string = "";

        if (toolName === "search") {


            const params = {
                api_key: process.env.SERPAPI_API_KEY,
                q: toolInput,
                location: "Austin, Texas, United States",
                google_domain: "google.com",
                gl: "us",
                hl: "en"
            } satisfies GoogleParameters;

            // Show result as JSON
            const res = await getJson("google", params);

            if (res.answer_box?.answer) {
                toolResult = res.answer_box.answer;
            }
            if (res.answer_box?.snippet) {
                toolResult = res.answer_box.snippet;
            }
            if (res.answer_box?.snippet_highlighted_words) {
                toolResult = res.answer_box.snippet_highlighted_words[0];
            }
            if (res.sports_results?.game_spotlight) {
                toolResult = res.sports_results.game_spotlight;
            }
            if (res.knowledge_graph?.description) {
                toolResult = res.knowledge_graph.description;
            }
            if (res.organic_results?.[0]?.snippet) {
                toolResult = res.organic_results?.[0]?.snippet;
            }

        }

        console.log(`Search: ${toolInput}, Result: ${toolResult}`)
        return toolResult;

    }

    async start(question: string) {
        this.currentPrompt = await this.getTemplate({ input: question, agent_scratchpad: "What to do in next step." });
        return await this.call();
    }

    async call(): Promise<string> {

        const answer: string = await this.callchatGPT(this.currentPrompt)

        if (answer.includes("Final Answer:")) {
            const parts = answer.split("Final Answer:");
            const finalAnswer = parts[parts.length - 1].trim();
            return finalAnswer;
        }

        // going to search 
        const match = /2.Thought: (.*)\n3.Action: (.*)\n4.Action Input: (.*)/s.exec(answer);
        if (!match) {
            throw new Error(`Could not parse LLM output: ${answer} `);
        }

        this.currentPrompt = `${this.currentPrompt}\n${answer}\n`
        let retry: number = 0;

        while (retry < MaxToolAttemptLimit) {

            const thoughts = match[1].trim().replace(/^"+|"+$/g, "");
            const tool = match[2].trim();
            const toolInput = match[3].trim().replace(/^"+|"+$/g, "");

            const toolResult = await this.executeTool(tool, toolInput);

            if (toolResult) {

                this.currentPrompt = `\n${this.currentPrompt}
        1.Observation: ${toolResult}
        2.Thoughts:
        `
                break;

            } else {
                retry++;
            }
        }

        return await this.call();

    }

    async callchatGPT(prompt: string): Promise<string> {
        const chat_completion = await this.openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "user", content: prompt
                },
            ],
            temperature: 0.6,

            // chatGPT shouldn't generate observation by self, so ignore everything after this command if chatGPT generates
            stop: ["\n1.Observation"]
        });

        return chat_completion.data.choices[0].message?.content as string;
    }
}


(async () => {

    try {

        const reActCompletion = new reAct();
        const question = "Which movie did Tom Cruise star in during 2023 ? ";
        const answer1 = await reActCompletion.start(question);
        console.log(`Answer is ${answer1}`);

    } catch (error) {
        console.error(error);
    }



})();
