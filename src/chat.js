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
            ...(env.ENVIRONMENT === 'development' && { stack: error.stack })
        }, {
            status: 500,
            headers: { 'Access-Control-Allow-Origin': '*' }
        });
    }
}

function getSystemPrompt() {
    return `You are a Treasury securities analysis assistant. You help users analyze US Treasury securities including Bills, Notes, and Bonds.

When a user mentions a CUSIP, use the analyze_cusip tool. Note that each CUSIP may have multiple issuances (original issue and reopenings). By default, use the most recent issue for pricing calculations, but explain that multiple issues exist if relevant.

Always explain:
- Which issue you're using (most recent, original, or specific date)
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
        // Validate CUSIP
        const cusipValidation = validateCUSIP(cusip);
        if (!cusipValidation.valid) {
            return {
                error: cusipValidation.error,
                cusip,
                suggestion: 'CUSIP should be 9 characters (e.g., 912828ZG8)'
            };
        }

        // Get base price
        const { results: prices } = await env.DB.prepare(
            'SELECT * FROM prices WHERE cusip = ?'
        ).bind(cusip).all();

        if (!prices || prices.length === 0) {
            return {
                error: `CUSIP ${cusip} not found in database`,
                cusip,
                suggestion: 'Please verify the CUSIP is correct'
            };
        }

        const price = prices[0];

        // Get all issues for this CUSIP
        const { results: issues } = await env.DB.prepare(
            'SELECT * FROM securities WHERE cusip = ? ORDER BY issueDate DESC'
        ).bind(cusip).all();

        if (!issues || issues.length === 0) {
            return {
                error: `No issue information found for CUSIP ${cusip}`,
                cusip,
                price_found: true
            };
        }

        // Determine which issue to use
        let selectedIssue;
        if (issuePreference === 'all') {
            selectedIssue = issues[0]; // Use latest for calculations
        } else if (issuePreference === 'original') {
            selectedIssue = issues[issues.length - 1]; // Oldest issue
        } else {
            selectedIssue = issues[0]; // Latest issue (default)
        }

        // Determine settlement date
        const today = new Date();
        let settlementDate;

        if (settlementDateStr) {
            settlementDate = parseDate(settlementDateStr);
            if (!settlementDate || isNaN(settlementDate.getTime())) {
                return {
                    error: `Invalid settlement date: ${settlementDateStr}`,
                    cusip,
                    suggestion: 'Use format YYYY-MM-DD'
                };
            }
        } else {
            settlementDate = getNextBusinessDay(today);
        }

        // Calculate pricing using selected issue
        const analysis = calculatePricing(price, selectedIssue, settlementDate);

        return {
            success: true,
            cusip,
            issue_count: issues.length,
            issue_summary: issues.map(i => ({
                issue_date: i.issueDate,
                auction_date: i.auctionDate,
                reopening: i.reopening,
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
                is_t_plus_1: !settlementDateStr,
                is_business_day: isBusinessDay(settlementDate)
            },
            pricing: analysis,
            calculations: analysis.calculation_details
        };

    } catch (error) {
        return {
            error: `Error analyzing CUSIP: ${error.message}`,
            cusip,
            // Don't include stack trace in production for security
            ...(env.ENVIRONMENT === 'development' && { stack: error.stack })
        };
    }
}

function validateCUSIP(cusip) {
    /**
     * Validate CUSIP format (9 characters: 6 letters/digits + 2 digits + 1 check digit)
     */
    if (!cusip || typeof cusip !== 'string') {
        return { valid: false, error: 'CUSIP must be a string' };
    }

    if (cusip.length !== 9) {
        return { valid: false, error: 'CUSIP must be exactly 9 characters' };
    }

    // First 6 can be letters or digits
    // Next 2 must be digits
    // Last 1 is check digit
    const pattern = /^[0-9]{5}[0-9A-Z]{3}[0-9]$/;
    if (!pattern.test(cusip)) {
        return { valid: false, error: 'Invalid CUSIP format' };
    }

    return { valid: true };
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
    /**
     * Generate coupon dates for a Treasury security
     * CORRECTED VERSION: Properly uses firstCouponDate parameter
     * 
     * @param {Date} maturityDate - Maturity date of the security
     * @param {Date|null} firstCouponDate - First interest payment date (important for irregular periods)
     * @param {number} frequency - Coupon frequency (1=annual, 2=semi-annual, 4=quarterly)
     * @param {Date} settlementDate - Settlement date for the calculation
     * @returns {Object} Object with lastCoupon, nextCoupon, and allCouponDates
     */
    
    if (!maturityDate || !(maturityDate instanceof Date)) {
        throw new Error('Invalid maturity date');
    }

    const monthsPerPeriod = 12 / frequency;
    const couponDates = [];
    
    // STRATEGY: Use firstCouponDate as anchor if available (handles irregular first periods)
    // Otherwise, fall back to calculating backwards from maturity
    
    if (firstCouponDate && firstCouponDate instanceof Date && !isNaN(firstCouponDate.getTime())) {
        // CASE 1: We have a valid first coupon date - use it as the anchor
        // This properly handles irregular first periods (short or long)
        
        let currentDate = new Date(firstCouponDate);
        
        // Build forward from first coupon to maturity
        while (currentDate <= maturityDate) {
            couponDates.push(new Date(currentDate));
            
            // Check if we've reached maturity
            if (currentDate.getTime() === maturityDate.getTime()) {
                break;
            }
            
            currentDate = addMonths(currentDate, monthsPerPeriod);
            
            // Safety check to prevent infinite loop
            if (couponDates.length > 300) {
                throw new Error('Too many coupon periods - check security data');
            }
        }
        
        // Ensure maturity date is in the list
        if (couponDates[couponDates.length - 1].getTime() !== maturityDate.getTime()) {
            couponDates.push(new Date(maturityDate));
        }
        
        // If settlement is before the first coupon, we need to go backwards
        // This handles the dated date period (from dated date to first coupon)
        if (couponDates.length > 0 && settlementDate < couponDates[0]) {
            // Calculate the quasi-coupon date before first coupon
            // This represents the theoretical previous coupon (usually the dated date)
            let priorDate = subtractMonths(new Date(firstCouponDate), monthsPerPeriod);
            
            // Only add if it's before settlement
            while (priorDate < settlementDate && couponDates.length < 300) {
                couponDates.unshift(new Date(priorDate));
                priorDate = subtractMonths(priorDate, monthsPerPeriod);
            }
            
            // Add one more to ensure we have a period containing settlement
            if (priorDate < settlementDate) {
                couponDates.unshift(new Date(priorDate));
            }
        }
        
    } else {
        // CASE 2: No first coupon date - calculate backwards from maturity
        // This is the fallback for when we don't have first coupon information
        
        couponDates.push(new Date(maturityDate));
        let currentDate = new Date(maturityDate);
        
        // Generate dates going backwards
        for (let i = 0; i < 300; i++) {
            currentDate = subtractMonths(currentDate, monthsPerPeriod);
            couponDates.unshift(new Date(currentDate));
            
            // Stop once we're well before the settlement date
            if (currentDate < settlementDate) {
                break;
            }
        }
    }
    
    // Ensure we have at least 2 coupon dates
    if (couponDates.length < 2) {
        throw new Error('Unable to determine coupon period for settlement date');
    }

    // Find the coupon period that contains the settlement date
    let lastCoupon = null;
    let nextCoupon = null;
    
    for (let i = 0; i < couponDates.length - 1; i++) {
        if (couponDates[i] <= settlementDate && couponDates[i + 1] > settlementDate) {
            lastCoupon = couponDates[i];
            nextCoupon = couponDates[i + 1];
            break;
        }
    }
    
    // If we didn't find a period, settlement might be before all coupons or after maturity
    if (!lastCoupon || !nextCoupon) {
        if (settlementDate < couponDates[0]) {
            throw new Error(`Settlement date ${formatDate(settlementDate)} is before first coupon ${formatDate(couponDates[0])}`);
        } else if (settlementDate > couponDates[couponDates.length - 1]) {
            throw new Error(`Settlement date ${formatDate(settlementDate)} is after maturity ${formatDate(maturityDate)}`);
        } else {
            throw new Error('Unable to find coupon period containing settlement date');
        }
    }
    
    // Additional validation
    if (lastCoupon > settlementDate) {
        throw new Error(`Last coupon ${formatDate(lastCoupon)} is after settlement ${formatDate(settlementDate)}`);
    }
    
    if (nextCoupon <= settlementDate) {
        throw new Error(`Next coupon ${formatDate(nextCoupon)} is not after settlement ${formatDate(settlementDate)}`);
    }

    return { 
        lastCoupon, 
        nextCoupon,
        allCouponDates: couponDates,
        // Additional metadata for debugging/validation
        usedFirstCouponDate: !!(firstCouponDate && firstCouponDate instanceof Date && !isNaN(firstCouponDate.getTime())),
        totalCouponDates: couponDates.length
    };
}

function formatDate(date) {
    if (!date || !(date instanceof Date)) return 'null';
    return date.toISOString().split('T')[0];
}

function addMonths(date, months) {
    /**
     * Add months to a date, handling end-of-month edge cases
     */
    const result = new Date(date);
    const originalDay = result.getDate();
    
    result.setMonth(result.getMonth() + months);
    
    // If the day changed due to month length differences
    if (result.getDate() !== originalDay) {
        // Set to last day of the target month
        result.setDate(0);
    }
    
    return result;
}

function subtractMonths(date, months) {
    const result = new Date(date);
    const originalDay = result.getDate();

    result.setMonth(result.getMonth() - months);

    // If the day changed due to month length differences
    if (result.getDate() !== originalDay) {
        // Set to last day of the target month
        result.setDate(0);
    }

    return result;
}

function daysBetween(date1, date2) {
    if (!(date1 instanceof Date) || !(date2 instanceof Date)) {
        throw new Error('Both arguments must be Date objects');
    }

    if (isNaN(date1.getTime()) || isNaN(date2.getTime())) {
        throw new Error('Invalid date provided');
    }

    if (date2 < date1) {
        throw new Error(`date2 (${formatDate(date2)}) must be after date1 (${formatDate(date1)})`);
    }

    return Math.round((date2 - date1) / (24 * 60 * 60 * 1000));
}

function getNextBusinessDay(date) {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);

    while (!isBusinessDay(next)) {
        next.setDate(next.getDate() + 1);
    }

    return next;
}

function isBusinessDay(date) {
    /**
     * Check if a date is a business day (not weekend or holiday)
     */
    // Check weekend
    const day = date.getDay();
    if (day === 0 || day === 6) return false;

    // Check holidays
    const holidays = getUSFederalHolidays(date.getFullYear());
    const dateStr = formatDate(date);

    for (const holiday of holidays) {
        if (formatDate(holiday) === dateStr) {
            return false;
        }
    }

    return true;
}

function getUSFederalHolidays(year) {
    /**
     * Returns array of US federal holiday dates for given year
     * Includes Good Friday (market closed but not federal holiday)
     */
    const holidays = [];

    // New Year's Day
    holidays.push(new Date(year, 0, 1));

    // Martin Luther King Jr. Day (3rd Monday in January)
    holidays.push(getNthWeekdayOfMonth(year, 0, 1, 3));

    // Presidents' Day (3rd Monday in February)
    holidays.push(getNthWeekdayOfMonth(year, 1, 1, 3));

    // Good Friday (Friday before Easter - market closed)
    holidays.push(getGoodFriday(year));

    // Memorial Day (last Monday in May)
    holidays.push(getLastWeekdayOfMonth(year, 4, 1));

    // Independence Day
    holidays.push(new Date(year, 6, 4));

    // Labor Day (1st Monday in September)
    holidays.push(getNthWeekdayOfMonth(year, 8, 1, 1));

    // Columbus Day (2nd Monday in October)
    holidays.push(getNthWeekdayOfMonth(year, 9, 1, 2));

    // Veterans Day
    holidays.push(new Date(year, 10, 11));

    // Thanksgiving (4th Thursday in November)
    holidays.push(getNthWeekdayOfMonth(year, 10, 4, 4));

    // Christmas
    holidays.push(new Date(year, 11, 25));

    // Adjust for weekends (observed on Friday if Saturday, Monday if Sunday)
    return holidays.map(holiday => {
        const day = holiday.getDay();
        if (day === 6) { // Saturday -> Friday
            return new Date(holiday.getFullYear(), holiday.getMonth(), holiday.getDate() - 1);
        } else if (day === 0) { // Sunday -> Monday
            return new Date(holiday.getFullYear(), holiday.getMonth(), holiday.getDate() + 1);
        }
        return holiday;
    });
}

function getNthWeekdayOfMonth(year, month, weekday, n) {
    /**
     * Get the nth occurrence of a weekday in a month
     * weekday: 0=Sunday, 1=Monday, etc.
     * n: which occurrence (1=first, 2=second, etc.)
     */
    let date = new Date(year, month, 1);
    let count = 0;

    while (date.getMonth() === month) {
        if (date.getDay() === weekday) {
            count++;
            if (count === n) return new Date(date);
        }
        date.setDate(date.getDate() + 1);
    }

    return null;
}

function getLastWeekdayOfMonth(year, month, weekday) {
    /**
     * Get the last occurrence of a weekday in a month
     */
    let date = new Date(year, month + 1, 0); // Last day of month

    while (date.getDay() !== weekday) {
        date.setDate(date.getDate() - 1);
    }

    return new Date(date);
}

function getGoodFriday(year) {
    /**
     * Calculate Good Friday (Friday before Easter)
     * Using simplified Easter calculation (Gauss algorithm)
     */
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-indexed
    const day = ((h + l - 7 * m + 114) % 31) + 1;

    const easter = new Date(year, month, day);
    const goodFriday = new Date(easter);
    goodFriday.setDate(easter.getDate() - 2);

    return goodFriday;
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
                    <li onclick="sendMessage('Analyze CUSIP 91282CGH8')">📊 "Analyze CUSIP 91282CGH8"</li>
                    <li onclick="sendMessage('Show all issues for 91282CGH8')">📈 "Show all issues for 91282CGH8"</li>
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
    </script>
</body>
</html>`;
}
