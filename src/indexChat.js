// chat.js - Main Cloudflare Worker Handler with AI Chat and Treasury Analysis
import { analyzeCusip } from './cusipAnalyzer.js';
import { getInitialNSSParameters, calculateSpotRate } from './nssCalculator.js';
import { getChatbotHTML } from './chatUI.js';

// ============================================================================
// Main Worker Handler
// ============================================================================

export default {
    async fetch(request, env) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return createCORSResponse();
        }

        const url = new URL(request.url);

        // Route: Home page (GET /)
        if (url.pathname === '/' && request.method === 'GET') {
            return new Response(getChatbotHTML(), {
                headers: { 'Content-Type': 'text/html' }
            });
        }

        // Route: Chat endpoint (POST /chat)
        if (url.pathname === '/chat' && request.method === 'POST') {
            return handleChat(request, env);
        }

        // 404 for unknown routes
        return new Response('Not found', { status: 404 });
    }
};

// ============================================================================
// Chat Handler
// ============================================================================

async function handleChat(request, env) {
    try {
        const { message, history } = await request.json();

        // Build conversation context
        const messages = [
            { role: 'system', content: getSystemPrompt() },
            ...(history || []),
            { role: 'user', content: message }
        ];

        // Call AI with tools
        const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
            messages,
            tools: getAvailableTools(),
        });

        // Handle tool calls if present
        if (response.tool_calls && response.tool_calls.length > 0) {
            const toolCall = response.tool_calls[0];
            const toolResult = await executeToolCall(toolCall, env);

            // Build final messages with tool result
            const finalMessages = [
                ...messages,
                {
                    role: 'assistant',
                    content: response.response || '',
                    tool_calls: response.tool_calls
                },
                {
                    role: 'tool',
                    name: toolCall.name,
                    content: JSON.stringify(toolResult)
                }
            ];

            // Get final response from AI
            const finalResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
                messages: finalMessages
            });

            return Response.json({
                response: finalResponse.response,
                tool_used: true,
                tool_name: toolCall.name,
                tool_result: toolResult
            }, {
                headers: { 'Access-Control-Allow-Origin': '*' }
            });
        }

        // No tool calls - return direct response
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

// ============================================================================
// Tool Execution
// ============================================================================

async function executeToolCall(toolCall, env) {
    const { name, arguments: args } = toolCall;

    switch (name) {
        case 'analyze_cusip':
            return await analyzeCusip(
                args.cusip,
                args.settlement_date,
                args.issue_preference,
                env
            );

        case 'get_nss_initial_parameters':
            return getInitialNSSParameters();

        case 'calculate_nss_spot_rate':
            return await calculateSpotRate(
                env,
                args.maturity_years,
                { asOfDate: args.as_of_date }
            );

        default:
            return { error: `Unknown tool: ${name}` };
    }
}

// ============================================================================
// System Prompt
// ============================================================================

function getSystemPrompt() {
    return `You are a Treasury securities analysis assistant with advanced yield curve modeling capabilities. You help users:

1. Analyze US Treasury securities (Bills, Notes, Bonds) including:
   - CUSIP lookup with accrued interest and dirty price calculations
   - Multi-issue analysis (original vs reopenings)
   - Settlement date calculations

2. Perform Nelson-Siegel-Svensson (NSS) yield curve analysis:
   - Get initial NSS parameters for curve fitting
   - Calculate spot rates for any maturity using NSS model
   - Explain the six NSS parameters (β₀, β₁, β₂, β₃, τ₁, τ₂)

When users ask about:
- CUSIP analysis → use analyze_cusip tool
- "Initial NSS parameters" or "starting guesses" → use get_nss_initial_parameters tool
- Spot rates for specific maturities (e.g., "7.5 year spot rate") → use calculate_nss_spot_rate tool

Always explain calculations clearly, including day count conventions and the NSS formula when relevant.`;
}

// ============================================================================
// Tool Definitions
// ============================================================================

function getAvailableTools() {
    return [
        getCusipAnalysisTool(),
        getNSSInitialParametersTool(),
        getNSSSpotRateTool()
    ];
}

function getCusipAnalysisTool() {
    return {
        name: 'analyze_cusip',
        description: 'Analyze a US Treasury security by CUSIP. Retrieves security and issue information, then calculates accrued interest and dirty price. Each CUSIP may have multiple issuances.',
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

function getNSSInitialParametersTool() {
    return {
        name: 'get_nss_initial_parameters',
        description: 'Get the initial starting parameters for Nelson-Siegel-Svensson curve fitting. Returns the six parameters: theta0 (β₀), theta1 (β₁), theta2 (β₂), theta3 (β₃), lambda1 (τ₁), lambda2 (τ₂) with explanations.',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        }
    };
}

function getNSSSpotRateTool() {
    return {
        name: 'calculate_nss_spot_rate',
        description: 'Calculate the annualized spot rate for a specific maturity using Nelson-Siegel-Svensson curve fitting. Fits NSS parameters to market data from the securities database, then calculates the spot rate.',
        parameters: {
            type: 'object',
            properties: {
                maturity_years: {
                    type: 'number',
                    description: 'Target maturity in years (e.g., 7.5 for 7.5 years). Must be between 0 and 30.'
                },
                as_of_date: {
                    type: 'string',
                    description: 'Optional reference date (YYYY-MM-DD) for curve fitting. Defaults to today.'
                }
            },
            required: ['maturity_years']
        }
    };
}

// ============================================================================
// Utilities
// ============================================================================

function createCORSResponse() {
    return new Response(null, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        }
    });
}
