export function getChatbotHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Treasury Security AI Analyst</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>${getStyles()}</style>
</head>
<body>
    ${getBody()}
    <script>${getScript()}</script>
</body>
</html>`;
}

function getStyles() {
    return `
        :root {
            --primary-gradient: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%);
            --bg-color: #f3f4f6;
            --chat-bg: #ffffff;
            --user-msg-bg: #4F46E5;
            --bot-msg-bg: #F3F4F6;
            --text-primary: #1F2937;
            --text-secondary: #6B7280;
            --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
            --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
            --radius-lg: 1rem;
            --radius-xl: 1.5rem;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: var(--bg-color);
            background-image: radial-gradient(#e5e7eb 1px, transparent 1px);
            background-size: 20px 20px;
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-primary);
        }

        .main-container {
            width: 100%;
            max-width: 1000px;
            height: 90vh;
            background: var(--chat-bg);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-lg);
            display: flex;
            overflow: hidden;
            position: relative;
        }

        /* Sidebar */
        .sidebar {
            width: 280px;
            background: #f9fafb;
            border-right: 1px solid #e5e7eb;
            display: flex;
            flex-direction: column;
            padding: 1.5rem;
        }

        .brand {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 2rem;
            color: #4F46E5;
        }

        .brand i { font-size: 1.5rem; }
        .brand span { font-weight: 700; font-size: 1.125rem; color: #111827; }

        .suggestions {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }

        .suggestion-btn {
            text-align: left;
            padding: 0.75rem;
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 0.5rem;
            cursor: pointer;
            font-size: 0.875rem;
            color: var(--text-secondary);
            transition: all 0.2s;
        }

        .suggestion-btn:hover {
            border-color: #4F46E5;
            color: #4F46E5;
            background: #eef2ff;
        }

        /* Chat Area */
        .chat-area {
            flex: 1;
            display: flex;
            flex-direction: column;
            background: white;
        }

        .chat-header {
            padding: 1.25rem 2rem;
            border-bottom: 1px solid #e5e7eb;
            background: rgba(255, 255, 255, 0.9);
            backdrop-filter: blur(10px);
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 10;
        }

        .header-info h2 { font-size: 1rem; font-weight: 600; }
        .header-info p { font-size: 0.875rem; color: var(--text-secondary); }

        .messages-container {
            flex: 1;
            overflow-y: auto;
            padding: 2rem;
            scroll-behavior: smooth;
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
        }

        .message {
            display: flex;
            gap: 1rem;
            max-width: 85%;
            animation: slideIn 0.3s ease-out;
        }

        .message.user {
            align-self: flex-end;
            flex-direction: row-reverse;
        }

        .avatar {
            width: 2.5rem;
            height: 2.5rem;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            font-size: 1rem;
        }

        .bot-avatar { background: #e0e7ff; color: #4F46E5; }
        .user-avatar { background: #f3f4f6; color: #4b5563; }

        .message-content {
            padding: 1rem 1.25rem;
            border-radius: 1rem;
            font-size: 0.95rem;
            line-height: 1.6;
            position: relative;
        }

        .user .message-content {
            background: var(--user-msg-bg);
            color: white;
            border-bottom-right-radius: 0.25rem;
        }

        .assistant .message-content {
            background: var(--bot-msg-bg);
            color: var(--text-primary);
            border-bottom-left-radius: 0.25rem;
        }

        /* Tool Result Styling */
        .tool-card {
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 0.75rem;
            margin-top: 0.75rem;
            overflow: hidden;
            box-shadow: var(--shadow-sm);
        }

        .tool-header {
            background: #f9fafb;
            padding: 0.75rem 1rem;
            border-bottom: 1px solid #e5e7eb;
            font-weight: 600;
            font-size: 0.85rem;
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .tool-body {
            padding: 1rem;
            font-size: 0.9rem;
            font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
            color: #374151;
        }

        .data-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 0.75rem;
            margin-top: 0.5rem;
        }

        .data-item label {
            display: block;
            font-size: 0.75rem;
            color: var(--text-secondary);
            margin-bottom: 0.25rem;
        }
        
        .data-item value {
            font-weight: 600;
            color: var(--text-primary);
        }

        /* Input Area */
        .input-area {
            padding: 1.5rem 2rem;
            background: white;
            border-top: 1px solid #e5e7eb;
        }

        .input-form {
            position: relative;
            display: flex;
            align-items: center;
        }

        .chat-input {
            width: 100%;
            padding: 1rem 3.5rem 1rem 1.5rem;
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 3rem;
            font-size: 1rem;
            transition: all 0.2s;
            outline: none;
        }

        .chat-input:focus {
            background: white;
            border-color: #4F46E5;
            box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
        }

        .send-btn {
            position: absolute;
            right: 0.5rem;
            width: 2.5rem;
            height: 2.5rem;
            border-radius: 50%;
            background: var(--primary-gradient);
            color: white;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s;
        }

        .send-btn:hover { transform: scale(1.05); }
        .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        @keyframes slideIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* Typing Indicator */
        .typing {
            display: flex;
            gap: 4px;
            padding: 0.5rem;
        }
        .dot {
            width: 6px;
            height: 6px;
            background: #9CA3AF;
            border-radius: 50%;
            animation: bounce 1.4s infinite ease-in-out;
        }
        .dot:nth-child(1) { animation-delay: -0.32s; }
        .dot:nth-child(2) { animation-delay: -0.16s; }
        
        @keyframes bounce {
            0%, 80%, 100% { transform: scale(0); }
            40% { transform: scale(1); }
        }

        /* Scrollbar */
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #d1d5db; }
    `;
}

function getBody() {
    return `
    <div class="main-container">
        <!-- Sidebar -->
        <div class="sidebar">
            <div class="brand">
                <i class="fas fa-chart-line"></i>
                <span>TreasuryAI</span>
            </div>
            
            <div class="suggestions">
                <div style="font-size: 0.75rem; font-weight: 600; color: #9CA3AF; margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em;">Example Questions</div>
                <button class="suggestion-btn" onclick="sendMessage('Analyze CUSIP 91282CGH8')">
                    <i class="fas fa-search" style="margin-right: 8px;"></i> Analyze CUSIP
                </button>
                <button class="suggestion-btn" onclick="sendMessage('Analyze CUSIP 91282CGH8 with settlement date of Dec 23, 2025')">
                    <i class="fas fa-calendar" style="margin-right: 8px;"></i> Set Settlement Date
                </button>
                <button class="suggestion-btn" onclick="sendMessage('What are the initial NSS parameters?')">
                    <i class="fas fa-wave-square" style="margin-right: 8px;"></i> NSS Parameters
                </button>
                <button class="suggestion-btn" onclick="sendMessage('What is the 7.5 year spot rate?')">
                    <i class="fas fa-calculator" style="margin-right: 8px;"></i> Spot Rate Calc
                </button>
            </div>
        </div>

        <!-- Chat Area -->
        <div class="chat-area">
            <div class="chat-header">
                <div class="header-info">
                    <h2>Financial Assistant</h2>
                    <p>Powered by Cloudflare Workers AI</p>
                </div>
                <div style="color: #10B981; font-size: 0.875rem;">
                    <i class="fas fa-circle" style="font-size: 0.5rem; vertical-align: middle; margin-right: 4px;"></i> Online
                </div>
            </div>

            <div class="messages-container" id="messages">
                <!-- Welcome Message -->
                <div class="message assistant">
                    <div class="avatar bot-avatar"><i class="fas fa-robot"></i></div>
                    <div class="message-content">
                        Hello! I'm your Treasury Security analysis assistant. I can help you analyze CUSIPs, calculate accrued interest, or fit the Nelson-Siegel-Svensson yield curve. How can I help you today?
                    </div>
                </div>
            </div>

            <div class="input-area">
                <form class="input-form" id="chatForm">
                    <input type="text" class="chat-input" id="messageInput" 
                           placeholder="Type your query here..." autocomplete="off">
                    <button type="submit" class="send-btn" id="sendButton">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </form>
            </div>
        </div>
    </div>`;
}

function getScript() {
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
            
            toggleInput(false);
            const loadingId = addLoadingIndicator();

            try {
                const response = await fetch('/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message, history: conversationHistory })
                });

                const data = await response.json();
                removeLoadingIndicator(loadingId);

                if (data.error) {
                    addMessage('Error: ' + data.error, 'assistant', true);
                } else {
                    let content = data.response;
                    if (data.tool_used && data.tool_result) {
                        content += formatToolResult(data.tool_result, data.tool_name);
                    }
                    addMessage(content, 'assistant');
                    conversationHistory.push({ role: 'assistant', content: data.response });
                }
            } catch (error) {
                removeLoadingIndicator(loadingId);
                addMessage('Connection Error: ' + error.message, 'assistant', true);
            }

            toggleInput(true);
            messageInput.focus();
        }

        function toggleInput(enabled) {
            messageInput.disabled = !enabled;
            sendButton.disabled = !enabled;
            if (enabled) {
                sendButton.innerHTML = '<i class="fas fa-paper-plane"></i>';
            } else {
                sendButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            }
        }

        function addMessage(content, role, isError = false) {
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${role}\`;
            
            const avatarDiv = document.createElement('div');
            avatarDiv.className = \`avatar \${role === 'user' ? 'user-avatar' : 'bot-avatar'}\`;
            avatarDiv.innerHTML = role === 'user' ? '<i class="fas fa-user"></i>' : '<i class="fas fa-robot"></i>';
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            if (isError) contentDiv.style.color = '#EF4444';
            contentDiv.innerHTML = content;
            
            if (role === 'user') {
                messageDiv.appendChild(contentDiv);
                messageDiv.appendChild(avatarDiv);
            } else {
                messageDiv.appendChild(avatarDiv);
                messageDiv.appendChild(contentDiv);
            }
            
            messagesContainer.appendChild(messageDiv);
            scrollToBottom();
        }

        function addLoadingIndicator() {
            const id = 'loading-' + Date.now();
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message assistant';
            messageDiv.id = id;
            
            messageDiv.innerHTML = \`
                <div class="avatar bot-avatar"><i class="fas fa-robot"></i></div>
                <div class="message-content">
                    <div class="typing">
                        <div class="dot"></div>
                        <div class="dot"></div>
                        <div class="dot"></div>
                    </div>
                </div>
            \`;
            
            messagesContainer.appendChild(messageDiv);
            scrollToBottom();
            return id;
        }

        function removeLoadingIndicator(id) {
            const el = document.getElementById(id);
            if (el) el.remove();
        }

        function scrollToBottom() {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        function formatToolResult(result, toolName) {
            if (result.error) {
                return \`<div class="tool-card" style="border-left: 4px solid #EF4444;">
                    <div class="tool-header"><i class="fas fa-exclamation-circle" style="color:#EF4444"></i> Error Analysis</div>
                    <div class="tool-body">\${result.error}</div>
                </div>\`;
            }

            if (toolName === 'get_nss_parameters' || (result && result.theta0 !== undefined)) {
                return \`<div class="tool-card">
                    <div class="tool-header"><i class="fas fa-chart-area"></i> NSS Curve Model</div>
                    <div class="tool-body">
                        <div class="data-grid">
                            <div class="data-item"><label>Theta 0 (Long-term)</label><value>\${result.theta0.toFixed(4)}</value></div>
                            <div class="data-item"><label>Theta 1 (Short-term)</label><value>\${result.theta1.toFixed(4)}</value></div>
                            <div class="data-item"><label>Theta 2 (Mid-term)</label><value>\${result.theta2.toFixed(4)}</value></div>
                            <div class="data-item"><label>Theta 3 (Mid-term 2)</label><value>\${result.theta3.toFixed(4)}</value></div>
                            <div class="data-item"><label>Lambda 1 (Decay)</label><value>\${result.lambda1.toFixed(4)}</value></div>
                            <div class="data-item"><label>Lambda 2 (Decay)</label><value>\${result.lambda2.toFixed(4)}</value></div>
                        </div>
                        <div style="margin-top: 10px; font-size: 0.8rem; color: #6B7280; border-top: 1px dashed #E5E7EB; padding-top: 8px;">
                            Fit Error (SSE): \${result.squaredError.toFixed(6)} | Data Points: \${result.dataPoints}
                        </div>
                    </div>
                </div>\`;
            }

            if (toolName === 'get_spot_rate' || (result && result.spotRate !== undefined)) {
                 return \`<div class="tool-card">
                    <div class="tool-header"><i class="fas fa-crosshairs"></i> Spot Rate Estimate</div>
                    <div class="tool-body">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-size: 0.8rem; color: #6B7280;">Time Horizon</div>
                                <div style="font-weight: 600; font-size: 1.1rem;">\${result.t} Years</div>
                            </div>
                            <div style="text-align: right;">
                                <div style="font-size: 0.8rem; color: #6B7280;">Annualized Spot Rate</div>
                                <div style="font-weight: 700; font-size: 1.5rem; color: #4F46E5;">\${result.spotRate.toFixed(3)}%</div>
                            </div>
                        </div>
                    </div>
                </div>\`;
            }

            if (result && result.price_info) {
                // Default: analyze_cusip
                const sec = result.price_info;
                const pricing = result.pricing;
                const calcs = pricing.calculation_details;

                return \`<div class="tool-card">
                    <div class="tool-header">
                        <i class="fas fa-file-invoice-dollar"></i> Analysis: \${sec.cusip}
                        \${result.issue_count > 1 ? '<span style="background:#EEF2FF; color:#4F46E5; padding:2px 6px; border-radius:4px; font-size:0.7rem; margin-left:auto;">Multi-Issue</span>' : ''}
                    </div>
                    <div class="tool-body">
                        <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px dashed #e5e7eb;">
                            <div class="data-grid">
                                <div class="data-item"><label>Security Type</label><value>\${sec.security_type}</value></div>
                                <div class="data-item"><label>Coupon</label><value>\${sec.coupon_rate}% \${sec.payment_frequency}</value></div>
                                <div class="data-item"><label>Maturity</label><value>\${sec.maturity_date}</value></div>
                                <div class="data-item"><label>Settlement</label><value>\${result.settlement_info.settlement_date}</value></div>
                                <div class="data-item"><label>Issue Used</label><value>\${result.selected_issue.which} (\${result.selected_issue.issue_date})</value></div>
                                <div class="data-item"><label>Days Accrued / Period</label><value>\${calcs.days_accrued} / \${calcs.days_in_period}</value></div>
                            </div>
                        </div>

                        <div style="background: #F9FAFB; padding: 10px; border-radius: 6px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                <span>Clean Price</span>
                                <span>\${pricing.clean_price}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 4px; color: #059669;">
                                <span>+ Accrued Interest</span>
                                <span>\${pricing.accrued_interest}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-weight: 700; margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">
                                <span>Dirty Price</span>
                                <span style="color: #4F46E5;">\${pricing.dirty_price}</span>
                            </div>
                        </div>

                        <div style="margin-top: 12px; font-size: 0.75rem; color: #6B7280;">
                            <strong>Calculation:</strong> \${calcs.accrued_interest_formula}
                        </div>
                    </div>
                </div>\`;
            }
        }
    `;
}