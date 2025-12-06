export function getChatbotHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Treasury Security AI Analyst</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
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
            --sidebar-width: 280px;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: var(--bg-color);
            background-image: radial-gradient(#e5e7eb 1px, transparent 1px);
            background-size: 20px 20px;
            height: 100vh;
            width: 100vw;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-primary);
            overflow: hidden; /* Prevent body scroll */
        }

        .main-container {
            width: 100%;
            max-width: 1200px;
            height: 90vh;
            background: var(--chat-bg);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-lg);
            display: flex;
            overflow: hidden;
            position: relative;
            transition: all 0.3s ease;
        }

        /* Sidebar */
        .sidebar {
            width: var(--sidebar-width);
            background: #f9fafb;
            border-right: 1px solid #e5e7eb;
            display: flex;
            flex-direction: column;
            padding: 1.5rem;
            flex-shrink: 0;
            z-index: 50;
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
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
            overflow-y: auto;
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
            display: flex;
            align-items: center;
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
            min-width: 0; /* Important for flex child truncation */
            position: relative;
        }

        .chat-header {
            padding: 1rem 1.5rem;
            border-bottom: 1px solid #e5e7eb;
            background: rgba(255, 255, 255, 0.9);
            backdrop-filter: blur(10px);
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 10;
        }

        /* Mobile Menu Button - Hidden by default */
        .mobile-menu-btn {
            display: none;
            background: none;
            border: none;
            font-size: 1.25rem;
            color: var(--text-primary);
            cursor: pointer;
            padding: 0.5rem;
            margin-right: 0.5rem;
        }

        /* Overlay for mobile sidebar */
        .sidebar-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 40;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s ease;
            backdrop-filter: blur(2px);
        }

        .header-info { display: flex; flex-direction: column; }
        .header-info h2 { font-size: 1rem; font-weight: 600; }
        .header-info p { font-size: 0.875rem; color: var(--text-secondary); }

        .messages-container {
            flex: 1;
            overflow-y: auto;
            padding: 1.5rem;
            scroll-behavior: smooth;
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
            -webkit-overflow-scrolling: touch; /* Smooth scrolling on iOS */
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
            width: 2.25rem;
            height: 2.25rem;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            font-size: 0.9rem;
        }

        .bot-avatar { background: #e0e7ff; color: #4F46E5; }
        .user-avatar { background: #f3f4f6; color: #4b5563; }

        .message-content {
            padding: 1rem 1.25rem;
            border-radius: 1rem;
            font-size: 0.95rem;
            line-height: 1.6;
            position: relative;
            word-wrap: break-word; /* Prevent overflow */
            max-width: 100%;
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
            width: 100%;
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
            flex-wrap: wrap;
        }

        .tool-body {
            padding: 1rem;
            font-size: 0.9rem;
            font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
            color: #374151;
            overflow-x: auto; /* Allow horizontal scroll for code/data */
        }

        /* Responsive Grid */
        .data-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 1rem;
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
            word-break: break-all;
        }

        /* Chart Container */
        .chart-container {
            position: relative;
            height: 300px; /* Reduced base height */
            min-height: 250px;
            margin-top: 1rem;
            padding: 0.5rem;
            background: white;
            border-radius: 0.5rem;
            width: 100%;
        }

        .chart-controls {
            display: flex;
            gap: 0.5rem;
            margin-top: 0.75rem;
            padding-top: 0.75rem;
            border-top: 1px dashed #e5e7eb;
            flex-wrap: wrap;
        }

        .chart-btn {
            padding: 0.5rem 1rem;
            background: #f3f4f6;
            border: 1px solid #e5e7eb;
            border-radius: 0.375rem;
            cursor: pointer;
            font-size: 0.875rem;
            color: var(--text-secondary);
            transition: all 0.2s;
            flex: 1; /* Expand on mobile */
            text-align: center;
            white-space: nowrap;
        }

        .chart-btn:hover {
            background: #eef2ff;
            border-color: #4F46E5;
            color: #4F46E5;
        }

        /* Input Area */
        .input-area {
            padding: 1.25rem;
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
            -webkit-appearance: none; /* iOS reset */
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
            z-index: 5;
        }

        .send-btn:hover { transform: scale(1.05); }
        .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        @keyframes slideIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* Typing Indicator */
        .typing { display: flex; gap: 4px; padding: 0.5rem; }
        .dot {
            width: 6px; height: 6px;
            background: #9CA3AF; border-radius: 50%;
            animation: bounce 1.4s infinite ease-in-out;
        }
        .dot:nth-child(1) { animation-delay: -0.32s; }
        .dot:nth-child(2) { animation-delay: -0.16s; }
        
        @keyframes bounce {
            0%, 80%, 100% { transform: scale(0); }
            40% { transform: scale(1); }
        }

        /* Custom Scrollbar */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #d1d5db; }

        /* =========================================
           Responsive Design / Media Queries
           ========================================= */
        
        @media (max-width: 1024px) {
            .main-container {
                max-width: 100%;
                height: 100vh;
                border-radius: 0;
            }
            body { padding: 0; }
        }

        @media (max-width: 768px) {
            .mobile-menu-btn { display: block; }
            
            .sidebar {
                position: absolute;
                left: 0;
                top: 0;
                bottom: 0;
                transform: translateX(-100%);
                box-shadow: 2px 0 10px rgba(0,0,0,0.1);
            }

            .sidebar.active {
                transform: translateX(0);
            }

            .sidebar-overlay.active {
                opacity: 1;
                pointer-events: auto;
            }

            .message { max-width: 92%; }
            .messages-container { padding: 1rem; }
            .chat-input { font-size: 16px; /* Prevents iOS zoom on focus */ }
            
            .data-grid {
                grid-template-columns: 1fr; /* Stack grid items on mobile */
            }
            
            .chart-container { height: 250px; }
        }
    `;
}

function getBody() {
    return `
    <div class="main-container">
        <div class="sidebar-overlay" id="sidebarOverlay"></div>

        <div class="sidebar" id="sidebar">
            <div class="brand">
                <i class="fas fa-chart-line"></i>
                <span>TreasuryAI</span>
            </div>
            
            <div class="suggestions">
                <div style="font-size: 0.75rem; font-weight: 600; color: #9CA3AF; margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em;">Example Questions</div>

                <button class="suggestion-btn" onclick="sendMessage('Show me the yield curve for today')">
                    <i class="fas fa-chart-area" style="margin-right: 12px; width: 16px;"></i> Current Yield Curve
                </button>
                <button class="suggestion-btn" onclick="sendMessage('What is the current 10-year Treasury yield?')">
                    <i class="fas fa-chart-bar" style="margin-right: 12px; width: 16px;"></i> 10-Year Yield Analysis
                </button>
                <button class="suggestion-btn" onclick="sendMessage('What is the 7.5 year spot rate?')">
                    <i class="fas fa-chart-line" style="margin-right: 12px; width: 16px;"></i> Spot Rate Calc
                </button>
                <button class="suggestion-btn" onclick="sendMessage('What are the fitted NSS parameters?')">
                    <i class="fas fa-wave-square" style="margin-right: 12px; width: 16px;"></i> NSS Parameters
                </button>
                <button class="suggestion-btn" onclick="sendMessage('Analyze CUSIP 91282CGH8')">
                    <i class="fas fa-search" style="margin-right: 12px; width: 16px;"></i> Analyze CUSIP
                </button>
                <button class="suggestion-btn" onclick="sendMessage('Calculate dirty price for CUSIP 912810TN4')">
                    <i class="fas fa-calculator" style="margin-right: 12px; width: 16px;"></i> Price Calculator
                </button>
                <button class="suggestion-btn" onclick="sendMessage('Analyze CUSIP 91282CGH8 with settlement date of Dec 23, 2025')">
                    <i class="fas fa-calendar" style="margin-right: 12px; width: 16px;"></i> Future Settlement
                </button>

            </div>
        </div>

        <div class="chat-area">
            <div class="chat-header">
                <div style="display: flex; align-items: center;">
                    <button class="mobile-menu-btn" id="mobileMenuBtn">
                        <i class="fas fa-bars"></i>
                    </button>
                    <div class="header-info">
                        <h2>Treasury Security AI Analyst</h2>
                        <p>Powered by Cloudflare Workers AI & TreasuryDirect</p>
                    </div>
                </div>
                <div style="color: #10B981; font-size: 0.875rem;">
                    <i class="fas fa-circle" style="font-size: 0.5rem; vertical-align: middle; margin-right: 4px;"></i> Online
                </div>
            </div>

            <div class="messages-container" id="messages">
                <div class="message assistant">
                    <div class="avatar bot-avatar"><i class="fas fa-robot"></i></div>
                    <div class="message-content">
                        👋 Welcome! I'm your Treasury Security AI Analyst. I can help you with:
                        <br><br>
                        • Real-time yield curve analysis using NSS models<br>
                        • CUSIP-based security pricing and calculations<br>
                        • Accrued interest and dirty price computations<br>
                        • Treasury market insights and analytics
                        <br><br>
                        What would you like to explore today?
                    </div>
                </div>
            </div>

            <div class="input-area">
                <form class="input-form" id="chatForm">
                    <input type="text" class="chat-input" id="messageInput" 
                           placeholder="Type your query..." autocomplete="off">
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
        const sidebar = document.getElementById('sidebar');
        const sidebarOverlay = document.getElementById('sidebarOverlay');
        const mobileMenuBtn = document.getElementById('mobileMenuBtn');
        
        const conversationHistory = [];
        let chartInstances = {};

        // Mobile Menu Logic
        function toggleSidebar() {
            sidebar.classList.toggle('active');
            sidebarOverlay.classList.toggle('active');
        }

        mobileMenuBtn.addEventListener('click', toggleSidebar);
        sidebarOverlay.addEventListener('click', toggleSidebar);

        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const message = messageInput.value.trim();
            if (message) sendMessage(message);
        });

        // Expose sendMessage globally for suggestion buttons
        window.sendMessage = async function(message) {
            // Close sidebar on mobile if it's open
            if (window.innerWidth <= 768 && sidebar.classList.contains('active')) {
                toggleSidebar();
            }

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
                    if (data.tool_result) {
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
        };

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
            setTimeout(() => {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }, 50);
        }

        function formatToolResult(result, toolName) {
            if (result.error) {
                return \`<div class="tool-card" style="border-left: 4px solid #EF4444;">
                    <div class="tool-header"><i class="fas fa-exclamation-circle" style="color:#EF4444"></i> Error Analysis</div>
                    <div class="tool-body">\${result.error}</div>
                </div>\`;
            }

            // Handle yield curve visualization
            if (toolName === 'get_yield_curve' || (result && result.curve && Array.isArray(result.curve))) {
                const chartId = 'chart-' + Date.now();
                
                setTimeout(() => {
                    createYieldCurveChart(chartId, result);
                }, 100);
                
                return \`<div class="tool-card">
                    <div class="tool-header">
                        <i class="fas fa-chart-area"></i> Treasury Yield Curve
                    </div>
                    <div class="tool-body">
                        <div class="chart-container">
                            <canvas id="\${chartId}"></canvas>
                        </div>
                        <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed #e5e7eb;">
                            <div class="data-grid">
                                <div class="data-item">
                                    <label>Model RMSE</label>
                                    <value>\${(result.parameters.squaredError * 100).toFixed(4)}%</value>
                                </div>
                                <div class="data-item">
                                    <label>Data Points</label>
                                    <value>\${result.parameters.dataPoints}</value>
                                </div>
                                <div class="data-item">
                                    <label>Iterations</label>
                                    <value>\${result.parameters.iterations}</value>
                                </div>
                            </div>
                        </div>
                        <div class="chart-controls">
                            <button class="chart-btn" onclick="downloadChartData('\${chartId}')">
                                <i class="fas fa-download"></i> CSV
                            </button>
                            <button class="chart-btn" onclick="downloadChartImage('\${chartId}')">
                                <i class="fas fa-image"></i> PNG
                            </button>
                        </div>
                    </div>
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
                            Fit Error (SSE): \${result.squaredError.toFixed(6)} \${result.squaredError ? ' | RMSE: ' + (result.squaredError * 100).toFixed(4) + '%' : ''}
                        </div>
                        <div style="margin-top: 10px; font-size: 0.8rem; color: #6B7280; border-top: 1px dashed #E5E7EB; padding-top: 8px;">
                           Data Points: \${result.dataPoints}
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

            if (toolName === 'analyze_cusip' || (result && result.price_info)) {
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
                                <div class="data-item"><label>Issue Used</label><value>\${result.selected_issue.which}</value></div>
                                <div class="data-item"><label>Accrual</label><value>\${calcs.days_accrued} / \${calcs.days_in_period}</value></div>
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
                    </div>
                </div>\`;
            }
        }

        function createYieldCurveChart(chartId, data) {
            const ctx = document.getElementById(chartId);
            if (!ctx) return;

            if (chartInstances[chartId]) {
                chartInstances[chartId].destroy();
            }

            const chartData = {
                labels: data.curve.map(point => point.maturity.toFixed(2)),
                datasets: [{
                    label: 'Yield Curve (%)',
                    data: data.curve.map(point => point.rate),
                    borderColor: '#4F46E5',
                    backgroundColor: 'rgba(79, 70, 229, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointHitRadius: 15 // Easier to touch on mobile
                }]
            };

            chartInstances[chartId] = new Chart(ctx, {
                type: 'line',
                data: chartData,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false // Save space on mobile
                        },
                        tooltip: {
                            mode: 'index',
                            intersect: false,
                            backgroundColor: 'rgba(17, 24, 39, 0.95)',
                            titleColor: '#ffffff',
                            bodyColor: '#ffffff',
                            borderColor: '#4F46E5',
                            borderWidth: 1,
                            padding: 10
                        }
                    },
                    scales: {
                        x: {
                            title: { display: true, text: 'Maturity (Years)', color: '#9CA3AF' },
                            grid: { display: false },
                            ticks: { maxTicksLimit: 6, color: '#6B7280' }
                        },
                        y: {
                            title: { display: true, text: 'Yield (%)', color: '#9CA3AF' },
                            grid: { color: '#f3f4f6' },
                            ticks: { color: '#6B7280' }
                        }
                    },
                    interaction: {
                        mode: 'nearest',
                        axis: 'x',
                        intersect: false
                    }
                }
            });
        }

        window.downloadChartData = function(chartId) {
            const chart = chartInstances[chartId];
            if (!chart) return;

            try {
                const data = chart.data.datasets[0].data;
                const labels = chart.data.labels;
                let csvContent = "Maturity,Yield\\n";
                labels.forEach((label, index) => {
                    csvContent += label + "," + (data[index] || 0).toFixed(4) + "\\n";
                });
                const blob = new Blob([csvContent], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'yield_curve_data.csv';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (error) {
                console.error(error);
                alert('Download failed');
            }
        };

        window.downloadChartImage = function(chartId) {
            const chart = chartInstances[chartId];
            if (!chart) return;
            try {
                const url = chart.toBase64Image();
                const a = document.createElement('a');
                a.href = url;
                a.download = 'yield_curve.png';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            } catch (error) {
                alert('Download failed');
            }
        };
    `;
}