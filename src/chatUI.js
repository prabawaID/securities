export function getChatbotHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
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

        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: var(--bg-color);
            background-image: radial-gradient(#e5e7eb 1px, transparent 1px);
            background-size: 20px 20px;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-primary);
            padding: 0.5rem;
        }

        .main-container {
            width: 100%;
            max-width: 1200px;
            height: 95vh;
            min-height: 500px;
            background: var(--chat-bg);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-lg);
            display: flex;
            overflow: hidden;
            position: relative;
        }

        /* Mobile Menu Toggle */
        .mobile-menu-toggle {
            display: none;
            position: fixed;
            top: 1rem;
            left: 1rem;
            z-index: 1000;
            background: var(--user-msg-bg);
            color: white;
            border: none;
            border-radius: 0.5rem;
            width: 2.5rem;
            height: 2.5rem;
            cursor: pointer;
            box-shadow: var(--shadow-lg);
            transition: transform 0.2s;
        }

        .mobile-menu-toggle:active {
            transform: scale(0.95);
        }

        /* Sidebar Overlay for Mobile */
        .sidebar-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 998;
            opacity: 0;
            transition: opacity 0.3s;
        }

        .sidebar-overlay.active {
            opacity: 1;
        }

        /* Sidebar */
        .sidebar {
            width: var(--sidebar-width);
            background: #f9fafb;
            border-right: 1px solid #e5e7eb;
            display: flex;
            flex-direction: column;
            padding: 1.5rem;
            transition: transform 0.3s ease;
            z-index: 999;
        }

        .brand {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 2rem;
            color: #4F46E5;
        }

        .brand i { font-size: 1.5rem; }
        .brand span { 
            font-weight: 700; 
            font-size: 1.125rem; 
            color: #111827;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .sidebar-close {
            display: none;
            position: absolute;
            top: 1rem;
            right: 1rem;
            background: transparent;
            border: none;
            color: #6B7280;
            font-size: 1.5rem;
            cursor: pointer;
            padding: 0.25rem;
        }

        .suggestions {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
            overflow-y: auto;
            flex: 1;
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
            min-height: 44px; /* Touch-friendly */
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
            min-width: 0; /* Fix flex overflow */
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
            min-height: 60px;
        }

        .header-info h2 { 
            font-size: 1rem; 
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .header-info p { 
            font-size: 0.875rem; 
            color: var(--text-secondary);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .messages-container {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 1.5rem;
            scroll-behavior: smooth;
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
        }

        .message {
            display: flex;
            gap: 0.75rem;
            max-width: 90%;
            animation: slideIn 0.3s ease-out;
            word-wrap: break-word;
            overflow-wrap: break-word;
        }

        .message.user {
            align-self: flex-end;
            flex-direction: row-reverse;
        }

        .avatar {
            width: 2.5rem;
            height: 2.5rem;
            min-width: 2.5rem;
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
            min-width: 0;
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
            overflow-x: auto;
        }

        .data-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-bottom: 1rem;
        }

        .data-item {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
        }

        .data-item label {
            font-size: 0.75rem;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.025em;
        }

        .data-item value {
            font-size: 0.9rem;
            font-weight: 600;
            color: var(--text-primary);
        }

        .chart-container {
            position: relative;
            height: 350px;
            width: 100%;
            margin: 1rem 0;
        }

        .chart-actions {
            display: flex;
            gap: 0.5rem;
            margin-top: 0.75rem;
            flex-wrap: wrap;
        }

        .chart-btn {
            padding: 0.5rem 0.75rem;
            font-size: 0.875rem;
            border: 1px solid #e5e7eb;
            border-radius: 0.5rem;
            background: white;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            min-height: 44px; /* Touch-friendly */
        }

        .chart-btn:hover {
            background: #f9fafb;
            border-color: #4F46E5;
            color: #4F46E5;
        }

        /* Input Area */
        .input-area {
            padding: 1rem 1.5rem;
            border-top: 1px solid #e5e7eb;
            background: white;
        }

        .input-wrapper {
            display: flex;
            gap: 0.75rem;
            align-items: flex-end;
        }

        #user-input {
            flex: 1;
            padding: 0.875rem 1rem;
            border: 1px solid #e5e7eb;
            border-radius: 0.75rem;
            font-size: 0.95rem;
            font-family: inherit;
            resize: vertical;
            min-height: 44px;
            max-height: 150px;
            transition: border-color 0.2s;
        }

        #user-input:focus {
            outline: none;
            border-color: #4F46E5;
            box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
        }

        #send-btn {
            padding: 0.875rem 1.5rem;
            background: var(--primary-gradient);
            color: white;
            border: none;
            border-radius: 0.75rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
            min-height: 44px;
        }

        #send-btn:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: var(--shadow-lg);
        }

        #send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .thinking {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            color: var(--text-secondary);
            font-style: italic;
        }

        .typing-dots {
            display: flex;
            gap: 0.25rem;
        }

        .typing-dots span {
            width: 0.375rem;
            height: 0.375rem;
            background: #9CA3AF;
            border-radius: 50%;
            animation: bounce 1.4s infinite;
        }

        .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
        .typing-dots span:nth-child(3) { animation-delay: 0.4s; }

        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        @keyframes bounce {
            0%, 60%, 100% { transform: translateY(0); }
            30% { transform: translateY(-0.5rem); }
        }

        /* ===== RESPONSIVE BREAKPOINTS ===== */

        /* Tablet and below */
        @media (max-width: 1024px) {
            .main-container {
                max-width: 100%;
                height: 100vh;
                border-radius: 0;
            }

            .data-grid {
                grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                gap: 0.75rem;
            }

            .chart-container {
                height: 300px;
            }
        }

        /* Mobile landscape and below */
        @media (max-width: 768px) {
            body {
                padding: 0;
            }

            .main-container {
                border-radius: 0;
                height: 100vh;
            }

            /* Hide sidebar by default on mobile */
            .sidebar {
                position: fixed;
                top: 0;
                left: 0;
                bottom: 0;
                transform: translateX(-100%);
                width: 280px;
                max-width: 80vw;
            }

            .sidebar.active {
                transform: translateX(0);
            }

            .sidebar-overlay {
                display: block;
            }

            .mobile-menu-toggle {
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .sidebar-close {
                display: block;
            }

            .chat-header {
                padding: 1rem;
                padding-left: 4rem; /* Space for mobile menu button */
            }

            .messages-container {
                padding: 1rem;
                gap: 1rem;
            }

            .message {
                max-width: 95%;
                gap: 0.5rem;
            }

            .avatar {
                width: 2rem;
                height: 2rem;
                min-width: 2rem;
                font-size: 0.875rem;
            }

            .message-content {
                padding: 0.875rem 1rem;
                font-size: 0.9rem;
            }

            .input-area {
                padding: 0.75rem;
            }

            .input-wrapper {
                gap: 0.5rem;
            }

            #user-input {
                font-size: 16px; /* Prevent zoom on iOS */
            }

            #send-btn {
                padding: 0.875rem 1rem;
            }

            .data-grid {
                grid-template-columns: 1fr;
                gap: 0.75rem;
            }

            .chart-container {
                height: 250px;
            }

            .tool-body {
                padding: 0.75rem;
                font-size: 0.85rem;
            }
        }

        /* Small mobile */
        @media (max-width: 480px) {
            .header-info h2 {
                font-size: 0.875rem;
            }

            .header-info p {
                font-size: 0.75rem;
            }

            .brand span {
                font-size: 1rem;
            }

            .message {
                max-width: 100%;
            }

            .avatar {
                width: 1.75rem;
                height: 1.75rem;
                min-width: 1.75rem;
                font-size: 0.75rem;
            }

            .message-content {
                padding: 0.75rem 0.875rem;
                font-size: 0.875rem;
            }

            .suggestion-btn {
                font-size: 0.8125rem;
                padding: 0.625rem;
            }

            .tool-header {
                font-size: 0.8125rem;
                padding: 0.625rem 0.75rem;
            }

            .chart-container {
                height: 220px;
            }

            .chart-btn {
                padding: 0.5rem;
                font-size: 0.8125rem;
            }

            #send-btn {
                padding: 0.875rem;
            }
        }

        /* Landscape mode optimizations */
        @media (max-height: 600px) and (orientation: landscape) {
            .main-container {
                height: 100vh;
            }

            .messages-container {
                padding: 0.75rem;
            }

            .message {
                gap: 0.5rem;
            }

            .chat-header {
                padding: 0.75rem 1rem;
                min-height: 50px;
            }

            .input-area {
                padding: 0.75rem;
            }
        }

        /* Print styles */
        @media print {
            body {
                background: white;
            }

            .main-container {
                box-shadow: none;
                border: 1px solid #e5e7eb;
            }

            .sidebar,
            .input-area,
            .mobile-menu-toggle,
            .chart-actions {
                display: none;
            }

            .chat-area {
                border: none;
            }

            .message {
                page-break-inside: avoid;
            }
        }
    `;
}

function getBody() {
    return `
    <button class="mobile-menu-toggle" id="mobile-menu-toggle" aria-label="Toggle menu">
        <i class="fas fa-bars"></i>
    </button>
    <div class="sidebar-overlay" id="sidebar-overlay"></div>
    <div class="main-container">
        <div class="sidebar" id="sidebar">
            <button class="sidebar-close" id="sidebar-close" aria-label="Close sidebar">
                <i class="fas fa-times"></i>
            </button>
            <div class="brand">
                <i class="fas fa-chart-line"></i>
                <span>Treasury Analyst</span>
            </div>
            <div class="suggestions">
                <button class="suggestion-btn" onclick="setSuggestion('What is the current 10-year Treasury yield?')">
                    <i class="fas fa-chart-bar"></i> 10-Year Yield Analysis
                </button>
                <button class="suggestion-btn" onclick="setSuggestion('Show me the yield curve for today')">
                    <i class="fas fa-chart-area"></i> Current Yield Curve
                </button>
                <button class="suggestion-btn" onclick="setSuggestion('Calculate dirty price for CUSIP 912810TN4')">
                    <i class="fas fa-calculator"></i> Price Calculator
                </button>
                <button class="suggestion-btn" onclick="setSuggestion('Compare 2Y vs 10Y spread')">
                    <i class="fas fa-chart-line"></i> Spread Analysis
                </button>
                <button class="suggestion-btn" onclick="setSuggestion('Explain the NSS model parameters')">
                    <i class="fas fa-info-circle"></i> NSS Model Info
                </button>
            </div>
        </div>

        <div class="chat-area">
            <div class="chat-header">
                <div class="header-info">
                    <h2>Treasury Security AI Analyst</h2>
                    <p>Powered by Claude & NSS Model</p>
                </div>
            </div>

            <div class="messages-container" id="messages-container">
                <div class="message assistant">
                    <div class="avatar bot-avatar">
                        <i class="fas fa-robot"></i>
                    </div>
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
                <div class="input-wrapper">
                    <textarea 
                        id="user-input" 
                        placeholder="Ask about Treasury securities..."
                        rows="1"
                        aria-label="Message input"
                    ></textarea>
                    <button id="send-btn" onclick="sendMessage()" aria-label="Send message">
                        <i class="fas fa-paper-plane"></i> Send
                    </button>
                </div>
            </div>
        </div>
    </div>
    `;
}

function getScript() {
    return `
        const messagesContainer = document.getElementById('messages-container');
        const userInput = document.getElementById('user-input');
        const sendBtn = document.getElementById('send-btn');
        const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
        const sidebarOverlay = document.getElementById('sidebar-overlay');
        const sidebar = document.getElementById('sidebar');
        const sidebarClose = document.getElementById('sidebar-close');
        const chartInstances = {};

        // Mobile menu functionality
        function toggleSidebar() {
            sidebar.classList.toggle('active');
            sidebarOverlay.classList.toggle('active');
            document.body.style.overflow = sidebar.classList.contains('active') ? 'hidden' : '';
        }

        mobileMenuToggle.addEventListener('click', toggleSidebar);
        sidebarOverlay.addEventListener('click', toggleSidebar);
        sidebarClose.addEventListener('click', toggleSidebar);

        // Auto-resize textarea
        userInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 150) + 'px';
        });

        // Send on Enter (but allow Shift+Enter for new line)
        userInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        function setSuggestion(text) {
            userInput.value = text;
            userInput.focus();
            // Auto-resize after setting text
            userInput.style.height = 'auto';
            userInput.style.height = Math.min(userInput.scrollHeight, 150) + 'px';
            // Close sidebar on mobile after selection
            if (window.innerWidth <= 768) {
                toggleSidebar();
            }
        }

        async function sendMessage() {
            const message = userInput.value.trim();
            if (!message) return;

            addMessage('user', message);
            userInput.value = '';
            userInput.style.height = 'auto';
            sendBtn.disabled = true;

            addMessage('assistant', '<div class="thinking">Analyzing... <div class="typing-dots"><span></span><span></span><span></span></div></div>', true);

            try {
                const response = await fetch('/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message })
                });

                const data = await response.json();
                removeLastMessage();

                if (data.error) {
                    addMessage('assistant', '❌ ' + data.error);
                } else {
                    let content = data.response || '';
                    
                    if (data.tool_results && data.tool_results.length > 0) {
                        for (const result of data.tool_results) {
                            content += formatToolResult(result);
                        }
                    }
                    
                    addMessage('assistant', content);

                    if (data.tool_results) {
                        setTimeout(() => {
                            data.tool_results.forEach((result, index) => {
                                if (result.tool === 'get_yield_curve' && result.data) {
                                    const chartId = 'chart-' + Date.now() + '-' + index;
                                    createYieldCurveChart(chartId, result.data);
                                }
                            });
                        }, 100);
                    }
                }
            } catch (error) {
                removeLastMessage();
                addMessage('assistant', '❌ Connection error. Please try again.');
                console.error('Error:', error);
            }

            sendBtn.disabled = false;
            userInput.focus();
        }

        function addMessage(role, content, temporary = false) {
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${role}\`;
            if (temporary) messageDiv.id = 'temp-message';

            const avatarIcon = role === 'user' ? 'fa-user' : 'fa-robot';
            const avatarClass = role === 'user' ? 'user-avatar' : 'bot-avatar';

            messageDiv.innerHTML = \`
                <div class="avatar \${avatarClass}">
                    <i class="fas \${avatarIcon}"></i>
                </div>
                <div class="message-content">\${content}</div>
            \`;

            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        function removeLastMessage() {
            const temp = document.getElementById('temp-message');
            if (temp) temp.remove();
        }

        function formatToolResult(result) {
            if (result.tool === 'get_yield_curve' && result.data) {
                const chartId = 'chart-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                return \`<div class="tool-card">
                    <div class="tool-header">
                        <i class="fas fa-chart-line"></i> Yield Curve Analysis
                        <span style="background:#EEF2FF; color:#4F46E5; padding:2px 8px; border-radius:4px; font-size:0.7rem; margin-left:auto;">
                            \${result.data.parameters.date || 'Live Data'}
                        </span>
                    </div>
                    <div class="tool-body">
                        <div class="data-grid">
                            <div class="data-item">
                                <label>Beta0 (Level)</label>
                                <value>\${result.data.parameters.beta0.toFixed(4)}</value>
                            </div>
                            <div class="data-item">
                                <label>Beta1 (Slope)</label>
                                <value>\${result.data.parameters.beta1.toFixed(4)}</value>
                            </div>
                            <div class="data-item">
                                <label>Beta2 (Curvature)</label>
                                <value>\${result.data.parameters.beta2.toFixed(4)}</value>
                            </div>
                            <div class="data-item">
                                <label>Beta3 (Extra)</label>
                                <value>\${result.data.parameters.beta3.toFixed(4)}</value>
                            </div>
                            <div class="data-item">
                                <label>Tau1</label>
                                <value>\${result.data.parameters.tau1.toFixed(4)}</value>
                            </div>
                            <div class="data-item">
                                <label>Tau2</label>
                                <value>\${result.data.parameters.tau2.toFixed(4)}</value>
                            </div>
                        </div>
                        <div class="chart-container">
                            <canvas id="\${chartId}"></canvas>
                        </div>
                        <div class="chart-actions">
                            <button class="chart-btn" onclick="downloadChartData('\${chartId}')">
                                <i class="fas fa-download"></i> Download Data
                            </button>
                            <button class="chart-btn" onclick="downloadChartImage('\${chartId}')">
                                <i class="fas fa-image"></i> Download Chart
                            </button>
                        </div>
                    </div>
                </div>\`;
            }

            if (result.tool === 'get_cusip_details' && result.data) {
                const sec = result.data.security_details;
                const pricing = result.data.pricing;
                const calcs = result.data.calculation_details;

                return \`<div class="tool-card">
                    <div class="tool-header">
                        <i class="fas fa-file-invoice-dollar"></i> Analysis: \${sec.cusip}
                        \${result.data.issue_count > 1 ? '<span style="background:#EEF2FF; color:#4F46E5; padding:2px 6px; border-radius:4px; font-size:0.7rem; margin-left:auto;">Multi-Issue</span>' : ''}
                    </div>
                    <div class="tool-body">
                        <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px dashed #e5e7eb;">
                            <div class="data-grid">
                                <div class="data-item"><label>Security Type</label><value>\${sec.security_type}</value></div>
                                <div class="data-item"><label>Coupon</label><value>\${sec.coupon_rate}% \${sec.payment_frequency}</value></div>
                                <div class="data-item"><label>Maturity</label><value>\${sec.maturity_date}</value></div>
                                <div class="data-item"><label>Settlement</label><value>\${result.data.settlement_info.settlement_date}</value></div>
                                <div class="data-item"><label>Issue Used</label><value>\${result.data.selected_issue.which} (\${result.data.selected_issue.issue_date})</value></div>
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

                        <div style="margin-top: 12px; font-size: 0.75rem; color: #6B7280; word-break: break-word;">
                            <strong>Calculation:</strong> \${calcs.accrued_interest_formula}
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
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointHoverBackgroundColor: '#4F46E5',
                    pointHoverBorderColor: '#ffffff',
                    pointHoverBorderWidth: 2
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
                            display: true,
                            position: 'top',
                            labels: {
                                font: { size: 12, weight: '600' },
                                color: '#374151',
                                usePointStyle: true,
                                padding: 15
                            }
                        },
                        tooltip: {
                            mode: 'index',
                            intersect: false,
                            backgroundColor: 'rgba(17, 24, 39, 0.95)',
                            titleColor: '#ffffff',
                            bodyColor: '#ffffff',
                            borderColor: '#4F46E5',
                            borderWidth: 1,
                            padding: 12,
                            displayColors: false,
                            callbacks: {
                                title: (context) => {
                                    return 'Maturity: ' + parseFloat(context[0].label).toFixed(2) + ' years';
                                },
                                label: (context) => {
                                    return 'Yield: ' + context.parsed.y.toFixed(3) + '%';
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            title: {
                                display: true,
                                text: 'Time to Maturity (Years)',
                                color: '#374151',
                                font: { size: 12, weight: '600' }
                            },
                            grid: {
                                color: '#f3f4f6',
                                drawBorder: false
                            },
                            ticks: {
                                maxTicksLimit: 10,
                                color: '#6B7280',
                                font: { size: 11 }
                            }
                        },
                        y: {
                            title: {
                                display: true,
                                text: 'Yield (%)',
                                color: '#374151',
                                font: { size: 12, weight: '600' }
                            },
                            grid: {
                                color: '#f3f4f6',
                                drawBorder: false
                            },
                            ticks: {
                                color: '#6B7280',
                                font: { size: 11 },
                                callback: function(value) {
                                    return value.toFixed(2) + '%';
                                }
                            }
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
            if (!chart) {
                alert('Chart not found. Please try again.');
                return;
            }

            try {
                const data = chart.data.datasets[0].data;
                const labels = chart.data.labels;
                
                let csvContent = "Maturity (Years),Yield (%)\\n";
                labels.forEach((label, index) => {
                    const value = data[index];
                    const formattedValue = (value !== null && value !== undefined) 
                        ? value.toFixed(4) 
                        : 'N/A';
                    csvContent += label + "," + formattedValue + "\\n";
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
                console.error('Error downloading chart data:', error);
                alert('Failed to download data: ' + error.message);
            }
        };

        window.downloadChartImage = function(chartId) {
            const chart = chartInstances[chartId];
            if (!chart) {
                alert('Chart not found. Please try again.');
                return;
            }

            try {
                const url = chart.toBase64Image();
                const a = document.createElement('a');
                a.href = url;
                a.download = 'yield_curve.png';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            } catch (error) {
                console.error('Error downloading chart image:', error);
                alert('Failed to download image: ' + error.message);
            }
        };
    `;
}