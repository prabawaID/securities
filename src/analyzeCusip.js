/**
 * Analyzes a US Treasury security by CUSIP.
 * Includes logic for accrued interest, dirty price, and issue selection.
 */
export async function analyzeCusip(cusip, settlementDateStr, issuePreference = 'latest', env) {
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
            ...(env.ENVIRONMENT === 'development' && { stack: error.stack })
        };
    }
}

// --- Helper Functions ---

function validateCUSIP(cusip) {
    if (!cusip || typeof cusip !== 'string') {
        return { valid: false, error: 'CUSIP must be a string' };
    }

    if (cusip.length !== 9) {
        return { valid: false, error: 'CUSIP must be exactly 9 characters' };
    }

    const pattern = /^[0-9]{5}[0-9A-Z]{3}[0-9]$/;
    if (!pattern.test(cusip)) {
        return { valid: false, error: 'Invalid CUSIP format' };
    }

    return { valid: true };
}

function calculatePricing(price, issue, settlementDate) {
    const couponRate = parseFloat(price.rate || issue?.interestRate || 0);
    const cleanPrice = parseFloat(issue?.pricePer100 || price.buy || 0);

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
    const accruedInterest = couponPayment * 100 * f;
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
    if (!maturityDate || !(maturityDate instanceof Date)) {
        throw new Error('Invalid maturity date');
    }

    const monthsPerPeriod = 12 / frequency;
    const couponDates = [];
    
    if (firstCouponDate && firstCouponDate instanceof Date && !isNaN(firstCouponDate.getTime())) {
        let currentDate = new Date(firstCouponDate);
        while (currentDate <= maturityDate) {
            couponDates.push(new Date(currentDate));
            if (currentDate.getTime() === maturityDate.getTime()) break;
            currentDate = addMonths(currentDate, monthsPerPeriod);
            if (couponDates.length > 300) throw new Error('Too many coupon periods - check security data');
        }
        if (couponDates[couponDates.length - 1].getTime() !== maturityDate.getTime()) {
            couponDates.push(new Date(maturityDate));
        }
        if (couponDates.length > 0 && settlementDate < couponDates[0]) {
            let priorDate = subtractMonths(new Date(firstCouponDate), monthsPerPeriod);
            while (priorDate < settlementDate && couponDates.length < 300) {
                couponDates.unshift(new Date(priorDate));
                priorDate = subtractMonths(priorDate, monthsPerPeriod);
            }
            if (priorDate < settlementDate) couponDates.unshift(new Date(priorDate));
        }
    } else {
        couponDates.push(new Date(maturityDate));
        let currentDate = new Date(maturityDate);
        for (let i = 0; i < 300; i++) {
            currentDate = subtractMonths(currentDate, monthsPerPeriod);
            couponDates.unshift(new Date(currentDate));
            if (currentDate < settlementDate) break;
        }
    }
    
    if (couponDates.length < 2) throw new Error('Unable to determine coupon period for settlement date');

    let lastCoupon = null;
    let nextCoupon = null;
    
    for (let i = 0; i < couponDates.length - 1; i++) {
        if (couponDates[i] <= settlementDate && couponDates[i + 1] > settlementDate) {
            lastCoupon = couponDates[i];
            nextCoupon = couponDates[i + 1];
            break;
        }
    }
    
    if (!lastCoupon || !nextCoupon) {
        if (settlementDate < couponDates[0]) {
            throw new Error(`Settlement date ${formatDate(settlementDate)} is before first coupon ${formatDate(couponDates[0])}`);
        } else if (settlementDate > couponDates[couponDates.length - 1]) {
            throw new Error(`Settlement date ${formatDate(settlementDate)} is after maturity ${formatDate(maturityDate)}`);
        } else {
            throw new Error('Unable to find coupon period containing settlement date');
        }
    }
    
    return { lastCoupon, nextCoupon, allCouponDates: couponDates };
}

function formatDate(date) {
    if (!date || !(date instanceof Date)) return 'null';
    return date.toISOString().split('T')[0];
}

function addMonths(date, months) {
    const result = new Date(date);
    const originalDay = result.getDate();
    result.setMonth(result.getMonth() + months);
    if (result.getDate() !== originalDay) result.setDate(0);
    return result;
}

function subtractMonths(date, months) {
    const result = new Date(date);
    const originalDay = result.getDate();
    result.setMonth(result.getMonth() - months);
    if (result.getDate() !== originalDay) result.setDate(0);
    return result;
}

function daysBetween(date1, date2) {
    return Math.round((date2 - date1) / (24 * 60 * 60 * 1000));
}

function getNextBusinessDay(date) {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    while (!isBusinessDay(next)) next.setDate(next.getDate() + 1);
    return next;
}

function isBusinessDay(date) {
    const day = date.getDay();
    if (day === 0 || day === 6) return false;
    const holidays = getUSFederalHolidays(date.getFullYear());
    const dateStr = formatDate(date);
    for (const holiday of holidays) {
        if (formatDate(holiday) === dateStr) return false;
    }
    return true;
}

function getUSFederalHolidays(year) {
    const holidays = [];
    holidays.push(new Date(year, 0, 1)); // New Year's
    holidays.push(getNthWeekdayOfMonth(year, 0, 1, 3)); // MLK
    holidays.push(getNthWeekdayOfMonth(year, 1, 1, 3)); // Presidents
    holidays.push(getGoodFriday(year)); // Good Friday
    holidays.push(getLastWeekdayOfMonth(year, 4, 1)); // Memorial
    holidays.push(new Date(year, 6, 4)); // Independence
    holidays.push(getNthWeekdayOfMonth(year, 8, 1, 1)); // Labor
    holidays.push(getNthWeekdayOfMonth(year, 9, 1, 2)); // Columbus
    holidays.push(new Date(year, 10, 11)); // Veterans
    holidays.push(getNthWeekdayOfMonth(year, 10, 4, 4)); // Thanksgiving
    holidays.push(new Date(year, 11, 25)); // Christmas
    return holidays.map(holiday => {
        const day = holiday.getDay();
        if (day === 6) return new Date(holiday.getFullYear(), holiday.getMonth(), holiday.getDate() - 1);
        if (day === 0) return new Date(holiday.getFullYear(), holiday.getMonth(), holiday.getDate() + 1);
        return holiday;
    });
}

function getNthWeekdayOfMonth(year, month, weekday, n) {
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
    let date = new Date(year, month + 1, 0);
    while (date.getDay() !== weekday) date.setDate(date.getDate() - 1);
    return new Date(date);
}

function getGoodFriday(year) {
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
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
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