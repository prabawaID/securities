// chatUI.js - Modular Chat Interface for Treasury Security AI Assistant

/**
 * Get CSS styles for the chat interface
 */
function getStyles() {
    return `
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
        
        .chat-header h1 { 
            font-size: 24px; 
            margin-bottom: 8px; 
        }
        
        .chat-header p { 
            font-size: 14px; 
            opacity: 0.9; 
        }
        
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
        }
        
        .examples li {
            padding: 4px 0;
            cursor: pointer;
            color: #666;
            transition: color 0.2s;
        }
        
        .examples li:hover { 
            color: #667eea; 
        }
    `;
}

/**
 * Get HTML structure for the chat interface
 */
function getHTMLStructure() {
    return `
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
    `;
}

/**
 * Get client-side JavaScript for chat functionality
 */
function getClientScript() {
    return `
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
                return formatNSSInitialParameters(result);
            }

            // Format NSS Spot Rate result
            if (toolName === 'calculate_nss_spot_rate') {
                return formatNSSSpotRate(result);
            }

            // Format CUSIP Analysis result
            if (toolName === 'analyze_cusip') {
                return formatCUSIPAnalysis(result);
            }

            return '';
        }

        function formatNSSInitialParameters(result) {
            const params = result.parameters;
            const explain = result.explanation;
            
            let html = \`<div class="tool-result">
                <div class="tool-result-header">📊 NSS Initial Parameters <span class="nss-badge">Curve Fitting</span></div>
                <strong>Starting Guesses for Optimization:</strong><br><br>\`;
            
            html += \`θ₀ (theta0): \${params.theta0} - \${explain.theta0}<br>\`;
            html += \`θ₁ (theta1): \${params.theta1} - \${explain.theta1}<br>\`;
            html += \`θ₂ (theta2): \${params.theta2} - \${explain.theta2}<br>\`;
            html += \`θ₃ (theta3): \${params.theta3} - \${explain.theta3}<br>\`;
            html += \`τ₁ (lambda1): \${params.lambda1} - \${explain.lambda1}<br>\`;
            html += \`τ₂ (lambda2): \${params.lambda2} - \${explain.lambda2}<br>\`;
            html += \`</div>\`;
            
            return html;
        }

        function formatNSSSpotRate(result) {
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

        function formatCUSIPAnalysis(result) {
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
    `;
}

/**
 * Generate complete HTML page for the chat interface
 * @returns {string} Complete HTML document
 */
export function getChatbotHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Treasury Security AI Assistant</title>
    <style>${getStyles()}</style>
</head>
<body>
    ${getHTMLStructure()}
    <script>${getClientScript()}</script>
</body>
</html>`;
}
