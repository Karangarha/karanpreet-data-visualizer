import OpenAI from "openai";

const openai = new OpenAI();

// Swap the model here to compare results (e.g. "gpt-5.2", "gpt-5-mini", "gpt-4o-mini")
const MODEL = "gpt-5.2";

// The prompt: ChatGPT reads the dataset's columns and picks the chart that answers the question
const SYSTEM_PROMPT = `You are a data visualization assistant.
You get a dataset's columns (with types), a few sample rows, and a user's question.
Choose ONE chart that best answers the question. Reply with JSON only:
{
  "chart": "bar" | "line" | "scatter",
  "x": "<column name>",
  "y": "<numeric column name, or null when agg is count>",
  "agg": "sum" | "avg" | "count",
  "title": "<short chart title>",
  "reason": "<one sentence: why this chart answers the question>"
}
Rules: use "line" when x is a date/time column, "bar" to compare categories,
"scatter" to relate two numeric columns (agg is ignored for scatter).
Only use column names that exist exactly as given.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { question, columns, sample, rowCount } = req.body;
  if (!question || !Array.isArray(columns) || columns.length === 0) {
    return res.status(400).json({ error: "Upload data and ask a question first." });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({ question, columns, rowCount, sample }),
        },
      ],
    });
    res.status(200).json(JSON.parse(completion.choices[0].message.content));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}
