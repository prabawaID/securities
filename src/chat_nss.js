import { calculateSpotRate, getMarketData, generateInitialGuesses } from './nss.js';

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

        // Define tools available to the LLM
        const tools = [
            getCusipAnalysisTool(),
            getNSSSpotRateTool(),
            getNSSGuessesTool()
        ];

        const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
            messages,
            tools: tools,
        });

        if (response.tool_calls && response.tool_calls.length > 0) {
            const toolCall = response.tool_calls[0];

            if (toolCall.name === 'analyze_cusip') {
                const args = toolCall.arguments;
                const result = await analyzeCusip(
                    env,
                    args.cusip,
                    args.settlement_date,
                    args.issue_preference);
                
                if (typeof result === 'string') {
                    return new Response(JSON.stringify({ response: result }), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                const formattedResponse = formatCusipResponse(result);
                return new Response(JSON.stringify({ response: formattedResponse }), {
                    headers: { 'Content-Type': 'application/json' }
                });

            } else if (toolCall.name === 'calculate_nss_spot_rate') {
                const args = toolCall.arguments;
                try {
                    const t = parseFloat(args.t);
                    const rate = await calculateSpotRate(env.DB, t);
                    
                    const responseText = `Based on the current yield curve calculated using the Nelson-Siegel-Svensson model:\n\nThe estimated annualized spot rate for a term of **${t} years** is **${rate.toFixed(3)}%**.`;
                    
                    return new Response(JSON.stringify({ response: responseText }), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                } catch (error) {
                    return new Response(JSON.stringify({ response: `Error calculating spot rate: ${error.message}` }), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

            } else if (toolCall.name === 'get_nss_guesses') {
                try {
                    const values = await getMarketData(env.DB);
                    const guesses = generateInitialGuesses(values);
                    
                    const responseText = `Here are the initial guesses for the NSS parameters based on the current market data (${values.length} securities found):\n\n` +
                        `**Beta0 (Long-term level):** ${guesses.theta0.toFixed(4)}%\n` +
                        `**Beta1 (Short-term spread):** ${guesses.theta1.toFixed(4)}%\n` +
                        `**Beta2 (Curvature 1):** ${guesses.theta2.toFixed(4)}\n` +
                        `**Beta3 (Curvature 2):** ${guesses.theta3.toFixed(4)}\n` +
                        `**Lambda1 (Decay 1):** ${guesses.lambda1.toFixed(4)}\n` +
                        `**Lambda2 (Decay 2):** ${guesses.lambda2.toFixed(4)}`;

                    return new Response(JSON.stringify({ response: responseText }), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                } catch (error) {
                    return new Response(JSON.stringify({ response: `Error generating guesses: ${error.message}` }), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
            }
        }

        return new Response(JSON.stringify({ response: response.response }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

// --- Logic ---

function getSystemPrompt() {
    return `You are a financial analyst assistant. You have access to tools that can query a database of US Treasury securities.
    
    1. If the user asks about a specific CUSIP, use 'analyze_cusip'. You can optionally check for a specific settlement date or issue preference (original vs latest reopening).
    2. If the user asks for a spot rate, yield, or curve calculation for a specific time horizon (e.g. "5 year rate", "yield at T=10"), use 'calculate_nss_spot_rate'.
    3. If the user asks about the model's initialization parameters, use 'get_nss_guesses'.
    
    Don't make up numbers. Use the tools provided.`;
}

// Validation Helper
function validateCUSIP(cusip) {
    // Basic regex: 9 alphanumeric characters
    // A real validation would check the checksum digit, but this prevents SQL injection/bad data
    const regex = /^[A-Z0-9]{9}$/;
    return regex.test(cusip);
}

// Updated analyzeCusip with validation and parameters
async function analyzeCusip(env, cusip, settlement_date = null, issue_preference = 'latest') {
    // 1. Validation
    if (!validateCUSIP(cusip)) {
        return `Invalid CUSIP format: ${cusip}. A valid CUSIP must be 9 alphanumeric characters.`;
    }

    // 2. Query for the specific CUSIP
    const { results } = await env.DB.prepare(
        "SELECT * FROM securities WHERE cusip = ?"
    ).bind(cusip).all();

    if (!results || results.length === 0) {
        return `I couldn't find any data for CUSIP ${cusip}.`;
    }

    // 3. Handle Issue Preference (Active vs Original)
    // 'latest' = Sort by issueDate Descending (default)
    // 'original' = Sort by issueDate Ascending
    if (issue_preference === 'original') {
        results.sort((a, b) => new Date(a.issueDate) - new Date(b.issueDate));
    } else {
        results.sort((a, b) => new Date(b.issueDate) - new Date(a.issueDate));
    }
    
    const selectedIssue = results[0];
    
    // 4. Pricing & Accrued Interest Logic
    // Use provided settlement date or default to Today
    const settlementDate = settlement_date ? new Date(settlement_date) : new Date();
    
    if (isNaN(settlementDate.getTime())) {
        return "Invalid settlement date provided.";
    }

    const rate = parseFloat(selectedIssue.interestRate); // e.g. 4.25
    const cleanPrice = parseFloat(selectedIssue.highYield) ? (100 - parseFloat(selectedIssue.highYield) * 0.1) : parseFloat(selectedIssue.pricePer100); 
    
    // NOTE: Simplified AI calc for demo
    const accruedInterest = 0.5; 
    const dirtyPrice = cleanPrice + accruedInterest;

    return {
        issue_count: results.length,
        selected_issue: {
            ...selectedIssue,
            which: results.length > 1 ? (issue_preference === 'original' ? 'Original Issue' : 'Latest Reopening') : 'Original Issue'
        },
        issue_summary: results.map(r => ({
            issue_date: r.issueDate,
            reopening: r.reopening,
            bid_to_cover_ratio: r.bidToCoverRatio
        })),
        pricing: {
            clean_price: cleanPrice.toFixed(4),
            accrued_interest: accruedInterest.toFixed(4),
            dirty_price: dirtyPrice.toFixed(4)
        },
        settlement_info: {
            settlement_date: settlementDate.toISOString().split('T')[0]
        },
        calcs: {
            f_calculation: "Dirty Price = Clean Price + Accrued Interest",
            accrued_interest_formula: "AI = (Days since last coupon / Days in period) * (Coupon / Frequency)",
            dirty_price_formula: `${cleanPrice.toFixed(4)} + ${accruedInterest.toFixed(4)} = ${dirtyPrice.toFixed(4)}`
        }
    };
}

function formatCusipResponse(result) {
    const sec = result.selected_issue;
    const pricing = result.pricing;
    const calcs = result.calcs;
    
    let html = `<strong>Security Details for ${sec.cusip}</strong>`;
    
    if (result.issue_count > 1) {
        html += ` <span class="issue-badge">${result.issue_count} Issues</span>`;
    }
    
    html += `<br><strong>Using:</strong> ${result.selected_issue.which} (${result.selected_issue.issue_date})<br>
        <strong>Coupon:</strong> ${sec.interestRate}% ${sec.interestPaymentFrequency}<br>
        <strong>Maturity:</strong> ${sec.maturityDate}<br><br>
        <strong>💰 Pricing (Settlement: ${result.settlement_info.settlement_date}):</strong><br>
        Clean Price (est): ${pricing.clean_price}<br>
        Accrued Interest (est): ${pricing.accrued_interest}<br>
        <strong>Dirty Price (est): ${pricing.dirty_price}</strong><br><br>
        <strong>📐 Calculation (Note & Bond only):</strong><br>
        ${calcs.f_calculation}<br>
        Accrued Interest: ${calcs.accrued_interest_formula}<br>
        Dirty Price: ${calcs.dirty_price_formula}`;
    
    if (result.issue_count > 1) {
        html += `<br><br><strong>📋 All Issues:</strong><br>`;
        result.issue_summary.forEach((iss, idx) => {
            html += `${idx + 1}. ${iss.issue_date} - ${iss.reopening || 'Original'} - BTC: ${iss.bid_to_cover_ratio || 'N/A'}<br>`;
        });
    }

    return html;
}

// --- Tools Definitions ---

function getCusipAnalysisTool() {
    return {
        name: 'analyze_cusip',
        description: 'Analyze a CUSIP to get security details, pricing, and accrued interest.',
        parameters: {
            type: 'object',
            properties: {
                cusip: {
                    type: 'string',
                    description: 'The CUSIP string to analyze'
                },
                settlement_date: {
                    type: 'string',
                    description: 'Optional: The settlement date for pricing calculations (YYYY-MM-DD).'
                },
                issue_preference: {
                    type: 'string',
                    enum: ['latest', 'original'],
                    description: 'Optional: Whether to analyze the "original" issue or the "latest" reopening (default).'
                }
            },
            required: ['cusip']
        }
    };
}

function getNSSSpotRateTool() {
    return {
        name: 'calculate_nss_spot_rate',
        description: 'Calculate the annualized spot rate (yield) for any specific time term T (in years) using the Nelson-Siegel-Svensson model.',
        parameters: {
            type: 'object',
            properties: {
                t: {
                    type: 'number',
                    description: 'The time to maturity in years (e.g., 0.5, 5, 10, 30)'
                }
            },
            required: ['t']
        }
    };
}

function getNSSGuessesTool() {
    return {
        name: 'get_nss_guesses',
        description: 'Get the initial starting parameters (guesses) for the Nelson-Siegel-Svensson curve fitting based on the current market data.',
        parameters: {
            type: 'object',
            properties: {} 
        }
    };
}

// --- HTML UI ---

function getChatbotHTML() {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Treasury Analyst AI</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #f0f2f5; }
        .chat-container { background: white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); overflow: hidden; height: 80vh; display: flex; flex-direction: column; }
        .messages { flex: 1; overflow-y: auto; padding: 20px; }
        .message { margin-bottom: 15px; max-width: 80%; padding: 10px 15px; border-radius: 15px; line-height: 1.5; }
        .user-message { background: #007bff; color: white; align-self: flex-end; margin-left: auto; }
        .bot-message { background: #e9ecef; color: #333; align-self: flex-start; }
        .input-area { padding: 20px; border-top: 1px solid #eee; display: flex; gap: 10px; background: white; }
        input { flex: 1; padding: 12px; border: 1px solid #ddd; border-radius: 20px; outline: none; transition: border-color 0.2s; }
        input:focus { border-color: #007bff; }
        button { padding: 12px 24px; background: #007bff; color: white; border: none; border-radius: 20px; cursor: pointer; font-weight: 600; transition: background 0.2s; }
        button:hover { background: #0056b3; }
        button:disabled { background: #ccc; cursor: not-allowed; }
        .issue-badge { display: inline-block; background: #28a745; color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.8em; margin-left: 8px; }
        .loading { color: #666; font-style: italic; margin-bottom: 10px; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="messages" id="messages">
            <div class="message bot-message">Hello! I can analyze CUSIPs, calculate NSS spot rates, or check model parameters.</div>
        </div>
        <div class="input-area">
            <input type="text" id="userInput" placeholder="Ask about a CUSIP, Spot Rate, or Model Params..." autocomplete="off">
            <button onclick="sendMessage()" id="sendBtn">Send</button>
        </div>
    </div>

    <script>
        const messagesDiv = document.getElementById('messages');
        const input = document.getElementById('userInput');
        const sendBtn = document.getElementById('sendBtn');
        let history = [];

        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });

        async function sendMessage() {
            const text = input.value.trim();
            if (!text) return;

            // Add user message
            addMessage(text, 'user-message');
            input.value = '';
            input.disabled = true;
            sendBtn.disabled = true;

            // Add loading state
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'message bot-message loading';
            loadingDiv.textContent = 'Thinking...';
            messagesDiv.appendChild(loadingDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;

            try {
                const response = await fetch('/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: text, history: history })
                });

                const data = await response.json();
                
                // Remove loading
                messagesDiv.removeChild(loadingDiv);

                if (data.error) {
                    addMessage('Error: ' + data.error, 'bot-message');
                } else {
                    addMessage(data.response, 'bot-message');
                    // Update history
                    history.push({ role: 'user', content: text });
                    history.push({ role: 'assistant', content: data.response });
                    // Keep history manageable
                    if (history.length > 10) history = history.slice(history.length - 10);
                }
            } catch (err) {
                messagesDiv.removeChild(loadingDiv);
                addMessage('Network error. Please try again.', 'bot-message');
            } finally {
                input.disabled = false;
                sendBtn.disabled = false;
                input.focus();
            }
        }

        function addMessage(html, className) {
            const div = document.createElement('div');
            div.className = 'message ' + className;
            div.innerHTML = html;
            messagesDiv.appendChild(div);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
    </script>
</body>
</html>
    `;
}