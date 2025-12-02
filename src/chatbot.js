// Cloudflare Worker AI Chatbot with CUSIP Analysis Tool
// Handles treasury security pricing calculations including accrued interest

export default {
  async fetch(request, env) {
    // Handle CORS
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

    // Serve chatbot UI
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(getChatbotHTML(), {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    // Chat endpoint
    if (url.pathname === '/chat' && request.method === 'POST') {
      return handleChat(request, env);
    }

    return new Response('Not found', { status: 404 });
  }
};

// Handle chat requests with AI
async function handleChat(request, env) {
  try {
    const { message, history } = await request.json();

    // Build conversation history
    const messages = [
      {
        role: 'system',
        content: getSystemPrompt()
      },
      ...(history || []),
      {
        role: 'user',
        content: message
      }
    ];

    // Call AI with tool definition
    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages,
      tools: [getCusipAnalysisTool()],
    });

    // Check if AI wants to use the tool
    if (response.tool_calls && response.tool_calls.length > 0) {
      const toolCall = response.tool_calls[0];
      
      if (toolCall.name === 'analyze_cusip') {
        // Execute the tool
        const toolResult = await analyzeCusip(
          toolCall.arguments.cusip,
          toolCall.arguments.settlement_date,
          env
        );

        // Get AI's final response with tool result
        const finalMessages = [
          ...messages,
          {
            role: 'assistant',
            content: response.response || '',
            tool_calls: response.tool_calls
          },
          {
            role: 'tool',
            name: 'analyze_cusip',
            content: JSON.stringify(toolResult)
          }
        ];

        const finalResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: finalMessages
        });

        return Response.json({
          response: finalResponse.response,
          tool_used: true,
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
      stack: error.stack
    }, {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  }
}

// System prompt for the AI
function getSystemPrompt() {
  return `You are a Treasury securities analysis assistant. You help users analyze US Treasury securities including Bills, Notes, Bonds, and TIPS.

When a user mentions a CUSIP or asks about a specific security, use the analyze_cusip tool to retrieve detailed information and calculate:
- Clean price (from database)
- Accrued interest
- Dirty price (clean price + accrued interest)
- Time offset (f) calculation details

Always explain the calculations clearly, including:
- The settlement date used (T+1 business day)
- Number of days in the coupon period
- Days from last coupon to settlement
- The day count convention used

Be conversational and helpful. Format numbers appropriately (e.g., prices to 6 decimals, percentages to 3 decimals).`;
}

// Tool definition for CUSIP analysis
function getCusipAnalysisTool() {
  return {
    name: 'analyze_cusip',
    description: 'Analyze a US Treasury security by CUSIP. Retrieves security information from database and calculates accrued interest, dirty price, and timing offsets. Automatically uses next business day as settlement date.',
    parameters: {
      type: 'object',
      properties: {
        cusip: {
          type: 'string',
          description: 'The CUSIP identifier for the Treasury security (9 characters)'
        },
        settlement_date: {
          type: 'string',
          description: 'Optional settlement date in YYYY-MM-DD format. If not provided, uses next business day from today.'
        }
      },
      required: ['cusip']
    }
  };
}

// Main CUSIP analysis function
async function analyzeCusip(cusip, settlementDateStr, env) {
  try {
    // Get security from database
    const { results } = await env.DB.prepare(
      'SELECT * FROM securities WHERE cusip = ?'
    ).bind(cusip).all();

    if (!results || results.length === 0) {
      return {
        error: `CUSIP ${cusip} not found in database`,
        cusip
      };
    }

    const security = results[0];

    // Determine settlement date (T+1 business day)
    const today = new Date();
    const settlementDate = settlementDateStr 
      ? parseDate(settlementDateStr)
      : getNextBusinessDay(today);

    // Calculate pricing
    const analysis = calculatePricing(security, settlementDate);

    return {
      success: true,
      cusip,
      security_info: {
        cusip: security.cusip,
        security_type: security.security_type,
        td_security_type: security.td_security_type,
        coupon_rate: parseFloat(security.coupon_rate || security.td_interest_rate || 0),
        maturity_date: security.maturity_date || security.td_maturity_date,
        clean_price: parseFloat(security.price_2 || security.td_price_per_100 || 0),
        issue_date: security.td_issue_date,
        first_coupon_date: security.td_first_interest_payment_date,
        payment_frequency: security.td_interest_payment_frequency || 'Semi-Annual',
        dated_date: security.td_dated_date,
        tips: security.td_tips === 'Yes',
        callable: security.td_callable === 'Yes'
      },
      settlement_info: {
        today: formatDate(today),
        settlement_date: formatDate(settlementDate),
        is_t_plus_1: !settlementDateStr,
        business_day_adjusted: true
      },
      pricing: analysis,
      calculations: analysis.calculation_details
    };

  } catch (error) {
    return {
      error: `Error analyzing CUSIP: ${error.message}`,
      cusip,
      stack: error.stack
    };
  }
}

// Calculate pricing details including accrued interest
function calculatePricing(security, settlementDate) {
  const couponRate = parseFloat(security.coupon_rate || security.td_interest_rate || 0);
  const cleanPrice = parseFloat(security.price_2 || security.td_price_per_100 || 0);
  
  // For bills (zero coupon), no accrued interest
  if (security.security_type === 'MARKET BASED BILL' || couponRate === 0) {
    return {
      clean_price: cleanPrice,
      accrued_interest: 0,
      dirty_price: cleanPrice,
      f_offset: 0,
      calculation_details: {
        security_type: 'Bill (Zero Coupon)',
        note: 'Bills have no coupon payments, so accrued interest is 0'
      }
    };
  }

  // Determine payment frequency
  const frequency = getPaymentFrequency(security.td_interest_payment_frequency);
  
  // Get coupon dates
  const maturityDate = parseDate(security.maturity_date || security.td_maturity_date);
  const firstCouponDate = security.td_first_interest_payment_date 
    ? parseDate(security.td_first_interest_payment_date)
    : null;
  const datedDate = security.td_dated_date 
    ? parseDate(security.td_dated_date)
    : null;

  // Find the last and next coupon dates relative to settlement
  const couponDates = generateCouponDates(maturityDate, firstCouponDate, frequency, settlementDate);
  
  const lastCouponDate = couponDates.lastCoupon;
  const nextCouponDate = couponDates.nextCoupon;

  // Calculate days
  const daysInPeriod = daysBetween(lastCouponDate, nextCouponDate);
  const daysAccrued = daysBetween(lastCouponDate, settlementDate);
  
  // Calculate f (fraction of period)
  const f = daysAccrued / daysInPeriod;

  // Calculate accrued interest
  // AI = (Coupon Rate / Frequency) × (Days Accrued / Days in Period) × 100
  const couponPayment = couponRate / frequency;
  const accruedInterest = couponPayment * f;

  // Dirty price = Clean price + Accrued interest
  const dirtyPrice = cleanPrice + accruedInterest;

  return {
    clean_price: roundTo(cleanPrice, 6),
    accrued_interest: roundTo(accruedInterest, 6),
    dirty_price: roundTo(dirtyPrice, 6),
    f_offset: roundTo(f, 8),
    calculation_details: {
      coupon_rate_percent: roundTo(couponRate, 3),
      payment_frequency: `${frequency}x per year (${getFrequencyName(frequency)})`,
      coupon_payment_per_period: roundTo(couponPayment, 6),
      last_coupon_date: formatDate(lastCouponDate),
      next_coupon_date: formatDate(nextCouponDate),
      days_in_period: daysInPeriod,
      days_accrued: daysAccrued,
      f_calculation: `${daysAccrued} days accrued ÷ ${daysInPeriod} days in period = ${roundTo(f, 8)}`,
      accrued_interest_formula: `(${roundTo(couponRate, 3)}% / ${frequency}) × ${roundTo(f, 8)} = ${roundTo(accruedInterest, 6)}`,
      day_count_convention: 'Actual/Actual (for US Treasuries)',
      dirty_price_formula: `${roundTo(cleanPrice, 6)} + ${roundTo(accruedInterest, 6)} = ${roundTo(dirtyPrice, 6)}`
    }
  };
}

// Generate coupon dates with leap year handling
function generateCouponDates(maturityDate, firstCouponDate, frequency, settlementDate) {
  const monthsPerPeriod = 12 / frequency;
  
  // Work backwards from maturity to find coupon dates
  const couponDates = [maturityDate];
  let currentDate = new Date(maturityDate);
  
  // Generate dates going backwards
  for (let i = 0; i < 200; i++) { // Max 200 periods (~100 years for semi-annual)
    currentDate = subtractMonths(currentDate, monthsPerPeriod);
    couponDates.unshift(new Date(currentDate));
    
    if (currentDate < settlementDate) {
      break;
    }
  }

  // Find the last coupon date before or on settlement
  let lastCoupon = couponDates[0];
  let nextCoupon = couponDates[1];
  
  for (let i = 0; i < couponDates.length - 1; i++) {
    if (couponDates[i] <= settlementDate && couponDates[i + 1] > settlementDate) {
      lastCoupon = couponDates[i];
      nextCoupon = couponDates[i + 1];
      break;
    }
  }

  return { lastCoupon, nextCoupon };
}

// Subtract months from a date, handling leap years
function subtractMonths(date, months) {
  const result = new Date(date);
  const targetMonth = result.getMonth() - months;
  
  result.setMonth(targetMonth);
  
  // Handle day overflow (e.g., Jan 31 -> Feb 31 becomes Feb 28/29)
  if (result.getDate() !== date.getDate()) {
    result.setDate(0); // Set to last day of previous month
  }
  
  return result;
}

// Calculate actual days between two dates
function daysBetween(date1, date2) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((date2 - date1) / msPerDay);
}

// Get next business day (skip weekends)
function getNextBusinessDay(date) {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  
  // Skip Saturday (6) and Sunday (0)
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1);
  }
  
  return next;
}

// Get payment frequency from string
function getPaymentFrequency(frequencyStr) {
  if (!frequencyStr) return 2; // Default semi-annual
  
  const lower = frequencyStr.toLowerCase();
  if (lower.includes('annual') && !lower.includes('semi')) return 1;
  if (lower.includes('semi')) return 2;
  if (lower.includes('quarter')) return 4;
  if (lower.includes('month')) return 12;
  
  return 2; // Default
}

// Get frequency name
function getFrequencyName(frequency) {
  const names = {
    1: 'Annual',
    2: 'Semi-Annual',
    4: 'Quarterly',
    12: 'Monthly'
  };
  return names[frequency] || 'Semi-Annual';
}

// Parse date string
function parseDate(dateStr) {
  if (!dateStr) return null;
  
  // Handle ISO format with time
  if (dateStr.includes('T')) {
    return new Date(dateStr.split('T')[0]);
  }
  
  return new Date(dateStr);
}

// Format date as YYYY-MM-DD
function formatDate(date) {
  if (!date) return null;
  return date.toISOString().split('T')[0];
}

// Round to specified decimals
function roundTo(num, decimals) {
  const multiplier = Math.pow(10, decimals);
  return Math.round(num * multiplier) / multiplier;
}

// HTML for chatbot interface
function getChatbotHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Treasury Security AI Chatbot</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .chat-container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            width: 100%;
            max-width: 800px;
            height: 600px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .chat-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            text-align: center;
        }
        
        .chat-header h1 {
            font-size: 24px;
            margin-bottom: 5px;
        }
        
        .chat-header p {
            font-size: 14px;
            opacity: 0.9;
        }
        
        .chat-messages {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            background: #f8f9fa;
        }
        
        .message {
            margin-bottom: 16px;
            display: flex;
            align-items: flex-start;
            animation: fadeIn 0.3s;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .message.user {
            flex-direction: row-reverse;
        }
        
        .message-content {
            max-width: 70%;
            padding: 12px 16px;
            border-radius: 12px;
            word-wrap: break-word;
        }
        
        .message.user .message-content {
            background: #667eea;
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
            font-size: 13px;
            font-family: 'Courier New', monospace;
        }
        
        .tool-result-header {
            font-weight: bold;
            margin-bottom: 8px;
            color: #667eea;
        }
        
        .chat-input-container {
            padding: 20px;
            background: white;
            border-top: 1px solid #e0e0e0;
        }
        
        .chat-input-form {
            display: flex;
            gap: 12px;
        }
        
        .chat-input {
            flex: 1;
            padding: 12px 16px;
            border: 2px solid #e0e0e0;
            border-radius: 24px;
            font-size: 14px;
            outline: none;
            transition: border-color 0.2s;
        }
        
        .chat-input:focus {
            border-color: #667eea;
        }
        
        .send-button {
            padding: 12px 24px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 24px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: transform 0.2s;
        }
        
        .send-button:hover:not(:disabled) {
            transform: translateY(-2px);
        }
        
        .send-button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        
        .loading {
            display: inline-block;
        }
        
        .loading::after {
            content: '...';
            animation: dots 1.5s steps(4, end) infinite;
        }
        
        @keyframes dots {
            0%, 20% { content: '.'; }
            40% { content: '..'; }
            60%, 100% { content: '...'; }
        }
        
        .examples {
            padding: 12px;
            background: #f0f0f0;
            border-radius: 8px;
            margin-bottom: 12px;
            font-size: 13px;
        }
        
        .examples h4 {
            margin-bottom: 8px;
            color: #667eea;
        }
        
        .examples ul {
            list-style: none;
            padding-left: 0;
        }
        
        .examples li {
            padding: 4px 0;
            cursor: pointer;
            color: #666;
        }
        
        .examples li:hover {
            color: #667eea;
        }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <h1>🏛️ Treasury Security AI Assistant</h1>
            <p>Ask about any CUSIP for detailed pricing analysis</p>
        </div>
        
        <div class="chat-messages" id="messages">
            <div class="examples">
                <h4>Try asking:</h4>
                <ul>
                    <li onclick="sendMessage('Analyze CUSIP 91282CNS6')">📊 "Analyze CUSIP 91282CNS6"</li>
                    <li onclick="sendMessage('What is the dirty price for 912810RM2?')">💰 "What is the dirty price for 912810RM2?"</li>
                    <li onclick="sendMessage('Calculate accrued interest for 912828N71')">📈 "Calculate accrued interest for 912828N71"</li>
                </ul>
            </div>
        </div>
        
        <div class="chat-input-container">
            <form class="chat-input-form" id="chatForm">
                <input 
                    type="text" 
                    class="chat-input" 
                    id="messageInput" 
                    placeholder="Ask about a CUSIP..."
                    autocomplete="off"
                >
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

        chatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const message = messageInput.value.trim();
            if (!message) return;
            
            sendMessage(message);
        });

        async function sendMessage(message) {
            // Add user message to UI
            addMessage(message, 'user');
            messageInput.value = '';
            
            // Add to history
            conversationHistory.push({
                role: 'user',
                content: message
            });

            // Disable input
            sendButton.disabled = true;
            messageInput.disabled = true;

            // Add loading indicator
            const loadingId = addMessage('Analyzing<span class="loading"></span>', 'assistant', true);

            try {
                const response = await fetch('/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        message,
                        history: conversationHistory
                    })
                });

                const data = await response.json();

                // Remove loading indicator
                document.getElementById(loadingId).remove();

                if (data.error) {
                    addMessage('Error: ' + data.error, 'assistant');
                } else {
                    // Add assistant response
                    let content = data.response;
                    
                    // Add tool result if present
                    if (data.tool_used && data.tool_result) {
                        content += formatToolResult(data.tool_result);
                    }
                    
                    addMessage(content, 'assistant');
                    
                    // Add to history
                    conversationHistory.push({
                        role: 'assistant',
                        content: data.response
                    });
                }
            } catch (error) {
                document.getElementById(loadingId).remove();
                addMessage('Error: ' + error.message, 'assistant');
            }

            // Re-enable input
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

        function formatToolResult(result) {
            if (result.error) {
                return \`<div class="tool-result">
                    <div class="tool-result-header">❌ Error</div>
                    \${result.error}
                </div>\`;
            }

            const sec = result.security_info;
            const pricing = result.pricing;
            const calcs = pricing.calculation_details;

            return \`<div class="tool-result">
                <div class="tool-result-header">📊 Detailed Analysis</div>
                <strong>Security:</strong> \${sec.cusip} - \${sec.td_security_type || sec.security_type}<br>
                <strong>Coupon:</strong> \${sec.coupon_rate}% \${sec.payment_frequency}<br>
                <strong>Maturity:</strong> \${sec.maturity_date}<br>
                <br>
                <strong>💰 Pricing (as of \${result.settlement_info.settlement_date}):</strong><br>
                Clean Price: \${pricing.clean_price}<br>
                Accrued Interest: \${pricing.accrued_interest}<br>
                <strong>Dirty Price: \${pricing.dirty_price}</strong><br>
                <br>
                <strong>📐 Calculation Details:</strong><br>
                Last Coupon: \${calcs.last_coupon_date}<br>
                Next Coupon: \${calcs.next_coupon_date}<br>
                Days Accrued: \${calcs.days_accrued}<br>
                Days in Period: \${calcs.days_in_period}<br>
                <strong>f = \${calcs.f_calculation}</strong><br>
                <br>
                AI Formula: \${calcs.accrued_interest_formula}<br>
                Dirty Price: \${calcs.dirty_price_formula}
            </div>\`;
        }
    </script>
</body>
</html>`;
}
