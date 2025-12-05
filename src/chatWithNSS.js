// chat.js - Main Cloudflare Worker Handler with AI Chat and Treasury Analysis
import { analyzeCusip } from './cusipAnalyzer.js';
import { getInitialNSSParameters, calculateSpotRate } from './nssCalculator.js';

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
                getNSSInitialParametersTool(),
                getNSSSpotRateTool()
            ],
        });

        if (response.tool_calls && response.tool_calls.length > 0) {
            const toolCall = response.tool_calls[0];
            let toolResult;

            // Handle different tool calls
            if (toolCall.name === 'analyze_cusip') {
                toolResult = await analyzeCusip(
                    toolCall.arguments.cusip,
                    toolCall.arguments.settlement_date,
                    toolCall.arguments.issue_preference,
                    env
                );
            } 
            else if (toolCall.name === 'get_nss_initial_parameters') {
                toolResult = getInitialNSSParameters();
            }
            else if (toolCall.name === 'calculate_nss_spot_rate') {
                toolResult = await calculateSpotRate(
                    env,
                    toolCall.arguments.maturity_years,
                    {
                        asOfDate: toolCall.arguments.as_of_date
                    }
                );
            }

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

function getChatbotHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Treasury Security AI Assistant</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        .chat-container {
            width: 100%;
            max-width: 800px;
            height: 90vh;
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .chat-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 24px;
            text-align: center;
        }
        .chat-header h1 { font-size: 24px; margin-bottom: 8px; }
        .chat-header p { font-size: 14px; opacity: 0.9; }
        .chat-messages {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .message {
            margin-bottom: 16px;
            display: flex;
            animation: slideIn 0.3s ease;
        }
        @keyframes slideIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .message.user { justify-content: flex-end; }
        .message.assistant { justify-content: flex-start; }
        .message-content {
            max-width: 70%;
            padding: 12px 16px;
            border-radius: 12px;
            line-height: 1.5;
            word-wrap: break-word;
        }
        .message.user .message-content {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-bottom-right-radius: 4px;
        }
        .message.assistant .message-content {
            background: white;
            color: #333;
            border-bottom-left-radius: 4px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .tool-result {
            margin-top: 12px;
            padding: 12px;
            background: #f0f0f0;
            border-radius: 8px;
            font-size: 12px;
            font-family: 'Courier New', monospace;
            max-height: 400px;
            overflow-y: auto;
        }
        .tool-result-header {
            font-weight: bold;
            margin-bottom: 8px;
            color: #667eea;
            font-size: 13px;
        }
        .issue-badge {
            display: inline-block;
            padding: 2px 6px;
            background: #667eea;
            color: white;
            border-radius: 4px;
            font-size: 11px;
            margin-left: 6px;
        }
        .nss-badge {
            display: inline-block;
            padding: 2px 6px;
            background: #10b981;
            color: white;
            border-radius: 4px;
            font-size: 11px;
            margin-left: 6px;
        }
        .chat-input-container {
            padding: 20px;
            background: white;
            border-top: 1px solid #e0e0e0;
        }
        .chat-input-form { display: flex; gap: 12px; }
        .chat-input {
            flex: 1;
            padding: 12px 16px;
            border: 2px solid #e0e0e0;
            border-radius: 24px;
            font-size: 14px;
            outline: none;
        }
        .chat-input:focus { border-color: #667eea; }
        .send-button {
            padding: 12px 24px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 24px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
        }
        .send-button:hover:not(:disabled) { transform: translateY(-2px); }
        .send-button:disabled { opacity: 0.6; cursor: not-allowed; }
        .examples {
            padding: 12px;
            background: #f0f0f0;
            border-radius: 8px;
            margin-bottom: 12px;
            font-size: 13px;
        }
        .examples h4 { margin-bottom: 8px; color: #667eea; }
        .examples ul { list-style: none; }
        .examples li {
            padding: 4px 0;
            cursor: pointer;
            color: #666;
        }
        .examples li:hover { color: #667eea; }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <h1>🏛️ Treasury Security AI Assistant</h1>
            <p>CUSIP Analysis • NSS Yield Curve • Spot Rate Calculator</p>
        </div>
        
        <div class="chat-messages" id="messages">
            <div class="examples">
                <h4>Try asking:</h4>
                <ul>
                    <li onclick="sendMessage('Analyze CUSIP 91282CGH8')">📊 "Analyze CUSIP 91282CGH8"</li>
                    <li onclick="sendMessage('What are the initial NSS parameters?')">📈 "What are the initial NSS parameters?"</li>
                    <li onclick="sendMessage('What is the 7.5 year spot rate?')">🎯 "What is the 7.5 year spot rate?"</li>
                    <li onclick="sendMessage('Show me the spot rate for 15 years')">📉 "Show me the spot rate for 15 years"</li>
                </ul>
            </div>
        </div>
        
        <div class="chat-input-container">
            <form class="chat-input-form" id="chatForm">
                <input type="text" class="chat-input" id="messageInput" 
                       placeholder="Ask about a CUSIP or spot rate..." autocomplete="off">
                <button type="submit" class="send-button" id="sendButton">Send</button>
            </form>
        </div>
    </div>

    <script>
        const messagesContainer = document.getElementById('messages');
        const chatForm = document.getElementById('chatForm');
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');
        const conversationHistory = [];

        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const message = messageInput.value.trim();
            if (message) sendMessage(message);
        });

        async function sendMessage(message) {
            addMessage(message, 'user');
            messageInput.value = '';
            conversationHistory.push({ role: 'user', content: message });
            
            sendButton.disabled = true;
            messageInput.disabled = true;
            const loadingId = addMessage('Analyzing...', 'assistant', true);

            try {
                const response = await fetch('/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message, history: conversationHistory })
                });

                const data = await response.json();
                document.getElementById(loadingId).remove();

                if (data.error) {
                    addMessage('Error: ' + data.error, 'assistant');
                } else {
                    let content = data.response;
                    if (data.tool_used && data.tool_result) {
                        content += formatToolResult(data.tool_result, data.tool_name);
                    }
                    addMessage(content, 'assistant');
                    conversationHistory.push({ role: 'assistant', content: data.response });
                }
            } catch (error) {
                document.getElementById(loadingId).remove();
                addMessage('Error: ' + error.message, 'assistant');
            }

            sendButton.disabled = false;
            messageInput.disabled = false;
            messageInput.focus();
        }

        function addMessage(content, role, isLoading = false) {
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${role}\`;
            const id = 'msg-' + Date.now();
            messageDiv.id = id;
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.innerHTML = content;
            
            messageDiv.appendChild(contentDiv);
            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            return id;
        }

        function formatToolResult(result, toolName) {
            if (result.error) {
                return \`<div class="tool-result">
                    <div class="tool-result-header">❌ Error</div>\${result.error}</div>\`;
            }

            // Format NSS Initial Parameters result
            if (toolName === 'get_nss_initial_parameters') {
                let html = \`<div class="tool-result">
                    <div class="tool-result-header">📊 NSS Initial Parameters <span class="nss-badge">Curve Fitting</span></div>
                    <strong>Starting Guesses for Optimization:</strong><br><br>\`;
                
                const params = result.parameters;
                const explain = result.explanation;
                
                html += \`θ₀ (theta0): \${params.theta0} - \${explain.theta0}<br>\`;
                html += \`θ₁ (theta1): \${params.theta1} - \${explain.theta1}<br>\`;
                html += \`θ₂ (theta2): \${params.theta2} - \${explain.theta2}<br>\`;
                html += \`θ₃ (theta3): \${params.theta3} - \${explain.theta3}<br>\`;
                html += \`τ₁ (lambda1): \${params.lambda1} - \${explain.lambda1}<br>\`;
                html += \`τ₂ (lambda2): \${params.lambda2} - \${explain.lambda2}<br>\`;
                html += \`</div>\`;
                
                return html;
            }

            // Format NSS Spot Rate result
            if (toolName === 'calculate_nss_spot_rate') {
                let html = \`<div class="tool-result">
                    <div class="tool-result-header">🎯 NSS Spot Rate Calculation <span class="nss-badge">Optimized</span></div>
                    <strong>Target Maturity:</strong> \${result.targetMaturity} years<br>
                    <strong>Spot Rate:</strong> <span style="font-size: 16px; color: #10b981; font-weight: bold;">\${result.spotRate.toFixed(3)}%</span><br><br>
                    <strong>Fitted NSS Parameters:</strong><br>
                    θ₀: \${result.fittedParameters.theta0.toFixed(6)}<br>
                    θ₁: \${result.fittedParameters.theta1.toFixed(6)}<br>
                    θ₂: \${result.fittedParameters.theta2.toFixed(6)}<br>
                    θ₃: \${result.fittedParameters.theta3.toFixed(6)}<br>
                    τ₁: \${result.fittedParameters.lambda1.toFixed(6)}<br>
                    τ₂: \${result.fittedParameters.lambda2.toFixed(6)}<br><br>
                    <strong>Optimization:</strong><br>
                    Iterations: \${result.optimizationInfo.iterations}<br>
                    Final Error: \${result.optimizationInfo.finalError.toFixed(8)}<br>
                    Data Points: \${result.optimizationInfo.dataPoints}<br><br>
                    <strong>Market Data Range:</strong><br>
                    Min Maturity: \${result.marketDataSummary.minMaturity} years<br>
                    Max Maturity: \${result.marketDataSummary.maxMaturity} years<br>
                    Securities: \${result.marketDataSummary.securities}<br>
                    </div>\`;
                
                return html;
            }

            // Format CUSIP Analysis result
            if (toolName === 'analyze_cusip') {
                const sec = result.price_info;
                const pricing = result.pricing;
                const calcs = pricing.calculation_details;

                let html = \`<div class="tool-result">
                    <div class="tool-result-header">📊 Analysis - \${sec.cusip}</div>
                    <strong>Security:</strong> \${sec.security_type}\`;
                
                if (result.issue_count > 1) {
                    html += \` <span class="issue-badge">\${result.issue_count} Issues</span>\`;
                }
                
                html += \`<br><strong>Using:</strong> \${result.selected_issue.which} (\${result.selected_issue.issue_date})<br>
                    <strong>Coupon:</strong> \${sec.coupon_rate}% \${sec.payment_frequency}<br>
                    <strong>Maturity:</strong> \${sec.maturity_date}<br><br>
                    <strong>💰 Pricing (Settlement: \${result.settlement_info.settlement_date}):</strong><br>
                    Clean Price: \${pricing.clean_price}<br>
                    Accrued Interest: \${pricing.accrued_interest}<br>
                    <strong>Dirty Price: \${pricing.dirty_price}</strong><br><br>
                    <strong>📐 Calculation (Note & Bond only):</strong><br>
                    \${calcs.f_calculation}<br>
                    Accrued Interest: \${calcs.accrued_interest_formula}<br>
                    Dirty Price: \${calcs.dirty_price_formula}\`;
                
                if (result.issue_count > 1) {
                    html += \`<br><br><strong>📋 All Issues:</strong><br>\`;
                    result.issue_summary.forEach((iss, idx) => {
                        html += \`\${idx + 1}. \${iss.issue_date} - \${iss.reopening || 'Original'} - BTC: \${iss.bid_to_cover_ratio || 'N/A'}<br>\`;
                    });
                }
                
                html += \`</div>\`;
                return html;
            }

            return '';
        }
    </script>
</body>
</html>`;
}
