import { parseDate, formatDate, addMonths, subtractMonths, daysBetween, addMonthsSafe, subtractMonthsSafe, calculateTerm } from './dateHelper.js';

// ============================================================================
// PAYMENT FREQUENCY UTILITIES
// ============================================================================

/**
 * Parse payment frequency string to numeric value
 * @param {string} frequencyStr - Payment frequency description
 * @returns {number} - Frequency (1=annual, 2=semi-annual, 4=quarterly, 12=monthly)
 */
export function getPaymentFrequency(frequencyStr) {
    if (!frequencyStr) return 2;
    const lower = frequencyStr.toLowerCase();
    if (lower.includes('annual') && !lower.includes('semi')) return 1;
    if (lower.includes('semi')) return 2;
    if (lower.includes('quarter')) return 4;
    if (lower.includes('month')) return 12;
    return 2;
}

/**
 * Convert frequency number to readable name
 * @param {number} frequency - Numeric frequency
 * @returns {string} - Frequency name
 */
export function getFrequencyName(frequency) {
    const names = { 1: 'Annual', 2: 'Semi-Annual', 4: 'Quarterly', 12: 'Monthly' };
    return names[frequency] || 'Semi-Annual';
}

// ============================================================================
// COUPON DATE GENERATION
// ============================================================================

/**
 * Determines the first coupon payment date
 * @param {string|null} firstPaymentDateStr - Database field (could be null)
 * @param {Date} issueDate - Issue date of the security
 * @param {number} frequency - Annual payment frequency (1, 2, 4, 12)
 * @returns {Date} - First payment date
 */
export function determineFirstPaymentDate(firstPaymentDateStr, issueDate, frequency) {
    let firstPaymentDate = parseDate(firstPaymentDateStr);
    
    if (!firstPaymentDate || isNaN(firstPaymentDate.getTime())) {
        // Fallback: estimate first payment as one period after issue
        const monthsToAdd = 12 / frequency;
        firstPaymentDate = addMonths(new Date(issueDate), monthsToAdd);
    }
    
    return firstPaymentDate;
}

/**
 * Generate all coupon dates for a Treasury security
 * Handles both regular and irregular first periods
 * 
 * @param {Date} maturityDate - Maturity date of the security
 * @param {Date|null} firstCouponDate - First interest payment date (important for irregular periods)
 * @param {number} frequency - Coupon frequency (1=annual, 2=semi-annual, 4=quarterly)
 * @param {Date} referenceDate - Settlement/today date for the calculation
 * @returns {Object} Object with lastCoupon, nextCoupon, and allCouponDates
 */
export function generateCouponDates(maturityDate, firstCouponDate, frequency, referenceDate) {
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
        
        // If reference date is before the first coupon, we need to go backwards
        // This handles the dated date period (from dated date to first coupon)
        if (couponDates.length > 0 && referenceDate < couponDates[0]) {
            // Calculate the quasi-coupon date before first coupon
            // This represents the theoretical previous coupon (usually the dated date)
            let priorDate = subtractMonths(new Date(firstCouponDate), monthsPerPeriod);
            
            // Only add if it's before reference date
            while (priorDate < referenceDate && couponDates.length < 300) {
                couponDates.unshift(new Date(priorDate));
                priorDate = subtractMonths(priorDate, monthsPerPeriod);
            }
            
            // Add one more to ensure we have a period containing reference date
            if (priorDate < referenceDate) {
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
            
            // Stop once we're well before the reference date
            if (currentDate < referenceDate) {
                break;
            }
        }
    }
    
    // Ensure we have at least 2 coupon dates
    if (couponDates.length < 2) {
        throw new Error('Unable to determine coupon period for reference date');
    }

    // Find the coupon period that contains the reference date
    let lastCoupon = null;
    let nextCoupon = null;
    
    for (let i = 0; i < couponDates.length - 1; i++) {
        if (couponDates[i] <= referenceDate && couponDates[i + 1] > referenceDate) {
            lastCoupon = couponDates[i];
            nextCoupon = couponDates[i + 1];
            break;
        }
    }
    
    // If we didn't find a period, reference date might be before all coupons or after maturity
    if (!lastCoupon || !nextCoupon) {
        if (referenceDate < couponDates[0]) {
            throw new Error(`Reference date ${formatDate(referenceDate)} is before first coupon ${formatDate(couponDates[0])}`);
        } else if (referenceDate > couponDates[couponDates.length - 1]) {
            throw new Error(`Reference date ${formatDate(referenceDate)} is after maturity ${formatDate(maturityDate)}`);
        } else {
            throw new Error('Unable to find coupon period containing reference date');
        }
    }
    
    // Additional validation
    if (lastCoupon > referenceDate) {
        throw new Error(`Last coupon ${formatDate(lastCoupon)} is after reference date ${formatDate(referenceDate)}`);
    }
    
    if (nextCoupon <= referenceDate) {
        throw new Error(`Next coupon ${formatDate(nextCoupon)} is not after reference date ${formatDate(referenceDate)}`);
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

/**
 * Finds the last coupon payment date before a reference date
 * Used for accrued interest calculations
 * 
 * @param {Date} maturity - Maturity date
 * @param {Date} referenceDate - Reference date (today/settlement)
 * @param {Date} issueDate - Issue date
 * @param {number} frequency - Payment frequency
 * @param {number} paymentDay - Day of month for coupon payments
 * @returns {Date} - Last coupon payment date (period start)
 */
export function findLastCouponDate(maturity, referenceDate, issueDate, frequency, paymentDay) {
    const monthsToSubtract = 12 / frequency;
    let periodStart = new Date(maturity);

    // Work backward from maturity to find the period containing reference date
    while (periodStart > referenceDate) {
        const newPeriodStart = subtractMonthsSafe(periodStart, monthsToSubtract, paymentDay);
        
        // Don't go before issue date
        if (newPeriodStart < issueDate) {
            return issueDate;
        }
        
        periodStart = newPeriodStart;
    }

    return periodStart;
}

// ============================================================================
// ACCRUED INTEREST CALCULATION
// ============================================================================

/**
 * Calculates accrued interest for a coupon-bearing security
 * Uses Actual/Actual day count convention (standard for US Treasuries)
 * 
 * @param {Object} params - Parameters object
 * @param {Date} params.lastCouponDate - Last coupon payment date
 * @param {Date} params.nextCouponDate - Next coupon payment date
 * @param {Date} params.referenceDate - Settlement/today date
 * @param {number} params.couponRate - Annual coupon rate (as decimal, e.g., 0.03 for 3%)
 * @param {number} params.frequency - Payment frequency (1, 2, 4, 12)
 * @param {number} params.faceValue - Face value (typically 100)
 * @returns {Object} - Accrued interest details
 */
export function calculateAccruedInterest({
    lastCouponDate,
    nextCouponDate,
    referenceDate,
    couponRate,
    frequency,
    faceValue = 100
}) {
    const daysInPeriod = daysBetween(lastCouponDate, nextCouponDate);
    const daysAccrued = daysBetween(lastCouponDate, referenceDate);
    const f = daysAccrued / daysInPeriod;

    const couponPayment = couponRate / frequency;
    const accruedInterest = couponPayment * faceValue * f;

    return {
        accruedInterest: accruedInterest,
        daysInPeriod: daysInPeriod,
        daysAccrued: daysAccrued,
        f: f,
        couponPayment: couponPayment
    };
}

/**
 * Alternative accrued interest calculation given full security details
 * Finds the appropriate coupon period automatically
 * 
 * @param {Object} params - Parameters object
 * @param {Date} params.maturity - Maturity date
 * @param {Date} params.referenceDate - Settlement/today date
 * @param {Date} params.issueDate - Issue date
 * @param {number} params.frequency - Payment frequency
 * @param {number} params.couponAmount - Coupon payment per period
 * @param {number} params.paymentDay - Day of month for payments
 * @returns {number} - Accrued interest amount
 */
export function calculateAccruedInterestFromDates({
    maturity,
    referenceDate,
    issueDate,
    frequency,
    couponAmount,
    paymentDay
}) {
    const periodStart = findLastCouponDate(maturity, referenceDate, issueDate, frequency, paymentDay);
    
    // Calculate period end (next coupon date)
    const monthsToAdd = 12 / frequency;
    const periodEnd = addMonthsSafe(periodStart, monthsToAdd, paymentDay);

    // Calculate accrued interest using Actual/Actual convention
    const daysInPeriod = daysBetween(periodStart, periodEnd);
    const daysAccrued = daysBetween(periodStart, referenceDate);

    // Only calculate accrued if we're in a valid period
    if (daysInPeriod > 0 && daysAccrued >= 0 && daysAccrued <= daysInPeriod) {
        return couponAmount * (daysAccrued / daysInPeriod);
    }

    return 0;
}

// ============================================================================
// CASHFLOW GENERATION
// ============================================================================

/**
 * Generates cashflows for a zero-coupon security (T-Bills)
 * @param {Date} maturity - Maturity date
 * @param {Date} referenceDate - Today/settlement date
 * @param {number} faceValue - Face value (typically 100)
 * @returns {Array} - Array of cashflow objects
 */
export function generateZeroCouponCashflows(maturity, referenceDate, faceValue = 100) {
    return [{
        date: maturity,
        term: calculateTerm(referenceDate, maturity),
        amount: faceValue,
        type: 'Principal'
    }];
}

/**
 * Generates all future coupon cashflows and final principal payment
 * @param {Object} params - Parameters object
 * @param {Date} params.firstPaymentDate - First coupon payment date
 * @param {Date} params.maturity - Maturity date
 * @param {Date} params.referenceDate - Today/settlement date
 * @param {number} params.couponAmount - Coupon payment per period
 * @param {number} params.faceValue - Face value (typically 100)
 * @param {number} params.frequency - Payment frequency
 * @returns {Array} - Array of cashflow objects
 */
export function generateCouponCashflows({
    firstPaymentDate,
    maturity,
    referenceDate,
    couponAmount,
    faceValue = 100,
    frequency
}) {
    const cashflows = [];
    const paymentDay = firstPaymentDate.getDate();
    const monthsToAdd = 12 / frequency;
    let nextPaymentDate = new Date(firstPaymentDate);

    // Generate all coupon payments before maturity
    while (nextPaymentDate < maturity) {
        if (nextPaymentDate > referenceDate) {
            cashflows.push({
                date: new Date(nextPaymentDate),
                term: calculateTerm(referenceDate, nextPaymentDate),
                amount: couponAmount,
                type: 'Coupon'
            });
        }
        
        nextPaymentDate = addMonthsSafe(nextPaymentDate, monthsToAdd, paymentDay);
    }

    // Add final payment (principal + final coupon)
    cashflows.push({
        date: maturity,
        term: calculateTerm(referenceDate, maturity),
        amount: faceValue + couponAmount,
        type: 'Principal + Coupon'
    });

    return cashflows;
}

// ============================================================================
// PRICE CALCULATIONS
// ============================================================================

/**
 * Calculates clean price, dirty price, and accrued interest for a security
 * This is the main pricing function used for price display and analysis
 * 
 * @param {Object} params - Parameters object
 * @param {number} params.cleanPrice - Clean price (quoted price)
 * @param {number} params.couponRate - Annual coupon rate (as decimal)
 * @param {string} params.securityType - Security type (e.g., 'MARKET BASED BILL')
 * @param {Date} params.maturityDate - Maturity date
 * @param {Date} params.referenceDate - Settlement/today date
 * @param {Date|null} params.firstCouponDate - First coupon payment date
 * @param {number} params.frequency - Payment frequency
 * @returns {Object} - Pricing details including accrued interest and dirty price
 */
export function calculatePricing({
    cleanPrice,
    couponRate,
    securityType,
    maturityDate,
    referenceDate,
    firstCouponDate,
    frequency
}) {
    // For bills (zero coupon)
    if (securityType === 'MARKET BASED BILL' || couponRate === 0) {
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

    // Generate coupon dates
    const couponDates = generateCouponDates(maturityDate, firstCouponDate, frequency, referenceDate);
    const lastCouponDate = couponDates.lastCoupon;
    const nextCouponDate = couponDates.nextCoupon;

    // Calculate accrued interest
    const accruedCalc = calculateAccruedInterest({
        lastCouponDate,
        nextCouponDate,
        referenceDate,
        couponRate,
        frequency,
        faceValue: 100
    });

    const dirtyPrice = cleanPrice + accruedCalc.accruedInterest;

    return {
        clean_price: roundTo(cleanPrice, 6),
        accrued_interest: roundTo(accruedCalc.accruedInterest, 6),
        dirty_price: roundTo(dirtyPrice, 6),
        f_offset: roundTo(accruedCalc.f, 8),
        calculation_details: {
            coupon_rate_percent: roundTo(couponRate * 100, 3),
            payment_frequency: `${frequency}x per year (${getFrequencyName(frequency)})`,
            coupon_payment_per_period: roundTo(accruedCalc.couponPayment, 6),
            last_coupon_date: formatDate(lastCouponDate),
            next_coupon_date: formatDate(nextCouponDate),
            days_in_period: accruedCalc.daysInPeriod,
            days_accrued: accruedCalc.daysAccrued,
            f_calculation: `${accruedCalc.daysAccrued} days accrued ÷ ${accruedCalc.daysInPeriod} days in period = ${roundTo(accruedCalc.f, 8)}`,
            accrued_interest_formula: `(${roundTo(couponRate * 100, 3)}% / ${frequency}) × ${roundTo(accruedCalc.f, 8)} = ${roundTo(accruedCalc.accruedInterest, 6)}`,
            day_count_convention: 'Actual/Actual (for US Treasuries)',
            dirty_price_formula: `${roundTo(cleanPrice, 6)} + ${roundTo(accruedCalc.accruedInterest, 6)} = ${roundTo(dirtyPrice, 6)}`
        }
    };
}

/**
 * Generates cashflows and calculates dirty price for a security
 * Used for yield curve fitting and discounted cashflow analysis
 * 
 * @param {Object} sec - Security data from database
 * @param {Date} referenceDate - Reference date (today)
 * @returns {Object} - { cashflows, dirtyPrice }
 */
export function generateCashflowsAndPrice(sec, referenceDate) {
    const faceValue = 100;
    const cleanPrice = parseFloat(sec.cleanPrice) || 0;
    const maturity = new Date(sec.maturityDate);
    const issueDate = new Date(sec.issueDate);
    
    // Zero-coupon securities (T-Bills)
    if (sec.interestPaymentFrequency === 'None' || sec.interestRate == null) {
        return {
            cashflows: generateZeroCouponCashflows(maturity, referenceDate, faceValue),
            dirtyPrice: cleanPrice  // No accrued interest for zero-coupon
        };
    }

    // Coupon-bearing securities (Notes & Bonds)
    const couponRateAnnual = parseFloat(sec.interestRate) / 100;
    const frequency = getPaymentFrequency(sec.interestPaymentFrequency);
    
    // Determine first payment date
    const firstPaymentDate = determineFirstPaymentDate(
        sec.firstInterestPaymentDate,
        issueDate,
        frequency
    );
    
    // Generate coupon dates to find last and next coupon
    const couponDates = generateCouponDates(maturity, firstPaymentDate, frequency, referenceDate);
    const lastCouponDate = couponDates.lastCoupon;
    const nextCouponDate = couponDates.nextCoupon;

    // Generate all cashflows
    const cashflows = generateCouponCashflows({
        firstPaymentDate,
        maturity,
        referenceDate,
        couponAmount: (couponRateAnnual * faceValue) / frequency,
        faceValue,
        frequency
    });

    // Calculate accrued interest using explicit coupon dates (consistent with calculatePricing)
    const accruedCalc = calculateAccruedInterest({
        lastCouponDate,
        nextCouponDate,
        referenceDate,
        couponRate: couponRateAnnual,
        frequency,
        faceValue: 100
    });

    return {
        cashflows,
        dirtyPrice: cleanPrice + accruedCalc.accruedInterest
    };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Round a number to specified decimal places
 * @param {number} num - Number to round
 * @param {number} decimals - Number of decimal places
 * @returns {number} - Rounded number
 */
export function roundTo(num, decimals) {
    const multiplier = Math.pow(10, decimals);
    return Math.round(num * multiplier) / multiplier;
}
