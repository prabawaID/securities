import { analyzeCusip } from './analyzeCusip.js';
import { getNSSParameters, calculateSpotRate } from './analyzeNNS.js';
import { getChatbotHTML } from './chatUI.js';

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                }
            });
        }

        const url = new URL(request.url);

        if (url.pathname === '/' && request.method === 'GET') {
            return new Response(getChatbotHTML(), {
                headers: { 'Content-Type': 'text/html' }
            });
        }

        if (url.pathname === '/chat' && request.method === 'POST') {
            return handleChat(request, env);
        }

        return new Response('Not found', { status: 404 });
    }
};

async function handleChat(request, env) {
    try {
        const { message, history } = await request.json();

        const messages = [
            { role: 'system', content: getSystemPrompt() },
            ...(history || []),
            { role: 'user', content: message }
        ];

        const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
            messages,
            tools: [
                getCusipAnalysisTool(),
                getNSSParametersTool(),
                getSpotRateTool()
            ],
        });

        if (response.tool_calls && response.tool_calls.length > 0) {
            const toolCall = response.tool_calls[0];
            let toolResult;
            let toolName = toolCall.name;

            if (toolName === 'analyze_cusip') {
                toolResult = await analyzeCusip(
                    toolCall.arguments.cusip,
                    toolCall.arguments.settlement_date,
                    toolCall.arguments.issue_preference,
                    env
                );
            } else if (toolName === 'get_nss_parameters') {
                toolResult = await getNSSParameters(
                    env
                );
            } else if (toolName === 'get_spot_rate') {
                toolResult = await calculateSpotRate(
                    toolCall.arguments.years,
                    env
                );
            }

            if (toolResult) {
                const finalMessages = [
                    ...messages,
                    {
                        role: 'assistant',
                        content: response.response || '',
                        tool_calls: response.tool_calls
                    },
                    {
                        role: 'tool',
                        name: toolName,
                        content: JSON.stringify(toolResult)
                    }
                ];

                const finalResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
                    messages: finalMessages
                });

                return Response.json({
                    response: finalResponse.response,
                    tool_used: true,
                    tool_name: toolName,
                    tool_result: toolResult
                }, {
                    headers: { 'Access-Control-Allow-Origin': '*' }
                });
            }
        }

        return Response.json({
            response: response.response,
            tool_used: false
        }, {
            headers: { 'Access-Control-Allow-Origin': '*' }
        });

    } catch (error) {
        return Response.json({
            error: error.message,
            ...(env.ENVIRONMENT === 'development' && { stack: error.stack })
        }, {
            status: 500,
            headers: { 'Access-Control-Allow-Origin': '*' }
        });
    }
}

function getSystemPrompt() {
    return `You are a Treasury securities analysis assistant. You help users analyze US Treasury securities and the Yield Curve.

Capabilities:
1. Analyze specific CUSIPs (accrued interest, dirty price).
2. Calculate Nelson-Siegel-Svensson (NSS) Curve Parameters based on market data of Nov 18, 2025.
3. Estimate annualized spot rates for any time T (0-30 years) using the fitted NSS curve.

When a user mentions a CUSIP, use 'analyze_cusip'.
When a user asks for "NSS parameters", "curve parameters", or "fitted parameters", use 'get_nss_parameters'.
When a user asks for a "spot rate" at a specific year/time (e.g. "7.5 year spot rate"), use 'get_spot_rate'.

Always explain the result clearly. For spot rates, mention that it's derived from the NSS model fitted to current market data.

IMPORTANT: Format your response using HTML tags for better readability.
- Use <b> or <strong> for emphasis on key values.
- Use <ul> and <li> for lists.
- Use <p> for paragraphs.
- Do not use Markdown syntax (like * or ** or #).`;
}

function getCusipAnalysisTool() {
    return {
        name: 'analyze_cusip',
        description: 'Analyze a US Treasury security by CUSIP. Retrieves security and issue information, then calculates accrued interest and dirty price.',
        parameters: {
            type: 'object',
            properties: {
                cusip: {
                    type: 'string',
                    description: 'The CUSIP identifier (9 characters)'
                },
                settlement_date: {
                    type: 'string',
                    description: 'Optional settlement date (YYYY-MM-DD). Defaults to T+1.'
                },
                issue_preference: {
                    type: 'string',
                    enum: ['latest', 'original', 'all'],
                    description: 'Which issue to use: latest (most recent), original (first issue), or all (show all issues). Default: latest'
                }
            },
            required: ['cusip']
        }
    };
}

function getNSSParametersTool() {
    return {
        name: 'get_nss_parameters',
        description: 'Calculates the initial Nelson-Siegel-Svensson (NSS) curve parameters (Theta0-3, Lambda1-2) by fitting a curve to current treasury market data.',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        }
    };
}

function getSpotRateTool() {
    return {
        name: 'get_spot_rate',
        description: 'Calculates the annualized spot rate for a specific time horizon using the NSS model.',
        parameters: {
            type: 'object',
            properties: {
                years: { 
                    type: 'number', 
                    description: 'Time horizon in years (e.g. 7.5). Must be between 0 and 30.' 
                }
            },
            required: ['years']
        }
    };
}
