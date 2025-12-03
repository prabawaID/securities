// Cloudflare Worker AI Chatbot with CUSIP Analysis Tool (Relational Database)
// Handles treasury security pricing with one-to-many issue relationships

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
      tools: [getCusipAnalysisTool()],
    });

    if (response.tool_calls && response.tool_calls.length > 0) {
      const toolCall = response.tool_calls[0];
      
      if (toolCall.name === 'analyze_cusip') {
        const toolResult = await analyzeCusip(
          toolCall.arguments.cusip,
          toolCall.arguments.settlement_date,
          toolCall.arguments.issue_preference,
          env
        );

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

function getSystemPrompt() {
  return `You are a Treasury securities analysis assistant. You help users analyze US Treasury securities including Bills, Notes, Bonds, and TIPS.

When a user mentions a CUSIP, use the analyze_cusip tool. Note that each CUSIP may have multiple issuances (original issue and reopenings). By default, use the most recent issue for pricing calculations, but explain that multiple issues exist if relevant.

Always explain:
- Which issue you're using (most recent, original, or specific date)
- The settlement date (T+1 business day)
- The accrued interest calculation with f offset details
- Day count convention (Actual/Actual)

If a user asks about historical issuances or reopenings, explain how the security has been issued multiple times with different auction characteristics.`;
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

async function analyzeCusip(cusip, settlementDateStr, issuePreference = 'latest', env) {
  try {
    // Get base price
    const { results: prices } = await env.DB.prepare(
      'SELECT * FROM prices WHERE cusip = ?'
    ).bind(cusip).all();

    if (!prices || prices.length === 0) {
      return { error: `CUSIP ${cusip} not found`, cusip };
    }

    const price = prices[0];

    // Get all issues for this CUSIP
    const { results: issues } = await env.DB.prepare(
      'SELECT * FROM securities WHERE cusip = ? ORDER BY issueDate DESC'
    ).bind(cusip).all();

    // Determine which issue to use
    let selectedIssue;
    if (issuePreference === 'all') {
      // Return info about all issues
      selectedIssue = issues[0]; // Use latest for calculations
    } else if (issuePreference === 'original') {
      selectedIssue = issues[issues.length - 1]; // Oldest issue
    } else {
      selectedIssue = issues[0]; // Latest issue (default)
    }

    // Determine settlement date
    const today = new Date();
    const settlementDate = settlementDateStr 
      ? parseDate(settlementDateStr)
      : getNextBusinessDay(today);

    // Calculate pricing using selected issue
    const analysis = calculatePricing(price, selectedIssue, settlementDate);

    return {
      success: true,
      cusip,
      issue_count: issues.length,
      issue_summary: issues.map(i => ({
        issue_date: i.issueDate,
        auction_date: i.auctionDate,
        eopening: i.reopening,
        total_accepted: i.totalAccepted,
        bid_to_cover_ratio: i.bidToCoverRatio
      })),
      selected_issue: {
        issue_date: selectedIssue?.issueDate,
        auction_date: selectedIssue?.auctionDate,
        reopening: selectedIssue?.reopening,
        which: issuePreference === 'original' ? 'Original Issue' : 'Most Recent Issue'
      },
      price_info: {
        cusip: price.cusip,
        security_type: price.security_type,
        coupon_rate: parseFloat(price.rate || selectedIssue?.interestRate || 0),
        maturity_date: price.maturity_date || selectedIssue?.maturityDate,
        clean_price: parseFloat(price.sell || selectedIssue?.priceper100 || 0),
        
        // From selected issue
        issue_date: selectedIssue?.issueDate,
        first_coupon_date: selectedIssue?.firstInterestPaymentDate,
        payment_frequency: selectedIssue?.interestPaymentFrequency || 'Semi-Annual',
        dated_date: selectedIssue?.datedDate,
        tips: selectedIssue?.tips === 'Yes',
        callable: selectedIssue?.callable === 'Yes',
        high_yield: selectedIssue?.highYield,
        bid_to_cover: selectedIssue?.bidToCoverRatio
      },
      settlement_info: {
        today: formatDate(today),
        settlement_date: formatDate(settlementDate),
        is_t_plus_1: !settlementDateStr
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

function calculatePricing(price, issue, settlementDate) {
  const couponRate = parseFloat(price.rate || issue?.interestRate || 0);
  const cleanPrice = parseFloat(price.sell || issue?.pricePer100 || 0);
  
  // For bills (zero coupon)
  if (price.security_type === 'MARKET BASED BILL' || couponRate === 0) {
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

  const frequency = getPaymentFrequency(issue?.interestPaymentFrequency);
  const maturityDate = parseDate(price.maturity_date || issue?.maturityDate);
  const firstCouponDate = issue?.firstInterestPaymentDate 
    ? parseDate(issue.firstInterestPaymentDate)
    : null;

  const couponDates = generateCouponDates(maturityDate, firstCouponDate, frequency, settlementDate);
  const lastCouponDate = couponDates.lastCoupon;
  const nextCouponDate = couponDates.nextCoupon;

  const daysInPeriod = daysBetween(lastCouponDate, nextCouponDate);
  const daysAccrued = daysBetween(lastCouponDate, settlementDate);
  const f = daysAccrued / daysInPeriod;

  const couponPayment = couponRate / frequency;
  const accruedInterest = couponPayment * f;
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

function generateCouponDates(maturityDate, firstCouponDate, frequency, settlementDate) {
  const monthsPerPeriod = 12 / frequency;
  const couponDates = [maturityDate];
  let currentDate = new Date(maturityDate);
  
  for (let i = 0; i < 200; i++) {
    currentDate = subtractMonths(currentDate, monthsPerPeriod);
    couponDates.unshift(new Date(currentDate));
    if (currentDate < settlementDate) break;
  }

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

function subtractMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() - months);
  if (result.getDate() !== date.getDate()) {
    result.setDate(0);
  }
  return result;
}

function daysBetween(date1, date2) {
  return Math.round((date2 - date1) / (24 * 60 * 60 * 1000));
}

function getNextBusinessDay(date) {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function getPaymentFrequency(frequencyStr) {
  if (!frequencyStr) return 2;
  const lower = frequencyStr.toLowerCase();
  if (lower.includes('annual') && !lower.includes('semi')) return 1;
  if (lower.includes('semi')) return 2;
  if (lower.includes('quarter')) return 4;
  if (lower.includes('month')) return 12;
  return 2;
}

function getFrequencyName(frequency) {
  const names = { 1: 'Annual', 2: 'Semi-Annual', 4: 'Quarterly', 12: 'Monthly' };
  return names[frequency] || 'Semi-Annual';
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  if (dateStr.includes('T')) return new Date(dateStr.split('T')[0]);
  return new Date(dateStr);
}

function formatDate(date) {
  if (!date) return null;
  return date.toISOString().split('T')[0];
}

function roundTo(num, decimals) {
  const multiplier = Math.pow(10, decimals);
  return Math.round(num * multiplier) / multiplier;
}

function getChatbotHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Treasury Security AI Chatbot</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
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
            max-width: 900px;
            height: 700px;
            display: flex;
            flex-direction: column;
        }
        .chat-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            text-align: center;
            border-radius: 16px 16px 0 0;
        }
        .chat-header h1 { font-size: 24px; margin-bottom: 5px; }
        .chat-header p { font-size: 14px; opacity: 0.9; }
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
        .message.user { flex-direction: row-reverse; }
        .message-content {
            max-width: 75%;
            padding: 12px 16px;
            border-radius: 12px;
            word-wrap: break-word;
            font-size: 14px;
            line-height: 1.5;
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
            <p>Multi-Issue Analysis • Accrued Interest • Dirty Price Calculator</p>
        </div>
        
        <div class="chat-messages" id="messages">
            <div class="examples">
                <h4>Try asking:</h4>
                <ul>
                    <li onclick="sendMessage('Analyze CUSIP 912797QR1')">📊 "Analyze CUSIP 912797QR1"</li>
                    <li onclick="sendMessage('Show all issues for 912797QR1')">📈 "Show all issues for 912797QR1"</li>
                    <li onclick="sendMessage('Compare original vs latest issue for 912797QR1')">🔄 "Compare original vs latest issue for 912797QR1"</li>
                </ul>
            </div>
        </div>
        
        <div class="chat-input-container">
            <form class="chat-input-form" id="chatForm">
                <input type="text" class="chat-input" id="messageInput" 
                       placeholder="Ask about a CUSIP..." autocomplete="off">
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
                        content += formatToolResult(data.tool_result);
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

        function formatToolResult(result) {
            if (result.error) {
                return \`<div class="tool-result">
                    <div class="tool-result-header">❌ Error</div>\${result.error}</div>\`;
            }

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
                <strong>📐 Calculation:</strong><br>
                \${calcs.f_calculation}<br>
                AI: \${calcs.accrued_interest_formula}<br>
                Dirty: \${calcs.dirty_price_formula}\`;
            
            if (result.issue_count > 1) {
                html += \`<br><br><strong>📋 All Issues:</strong><br>\`;
                result.issue_summary.forEach((iss, idx) => {
                    html += \`\${idx + 1}. \${iss.issue_date} - \${iss.reopening || 'Original'} - BTC: \${iss.bid_to_cover_ratio || 'N/A'}<br>\`;
                });
            }
            
            html += \`</div>\`;
            return html;
        }
    </script>
</body>
</html>`;
}
