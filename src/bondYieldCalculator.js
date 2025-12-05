/**
 * Bond Yield Calculator for Cloudflare Workers
 * Calculates yield to maturity from bond price using Newton-Raphson method
 */

/**
 * Calculate the number of days between two dates
 */
function daysBetween(date1, date2) {
    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    const diff = date2.getTime() - date1.getTime();
    return Math.floor(diff / MS_PER_DAY);
}

/**
 * Add months to a date (handles month-end edge cases)
 */
function addMonths(date, months) {
    const result = new Date(date);
    const targetMonth = result.getMonth() + months;
    const targetYear = result.getFullYear() + Math.floor(targetMonth / 12);
    const normalizedMonth = ((targetMonth % 12) + 12) % 12;
    
    result.setFullYear(targetYear);
    result.setMonth(normalizedMonth);
    
    // Handle month-end dates
    if (result.getDate() !== date.getDate()) {
        result.setDate(0); // Go to last day of previous month
    }
    
    return result;
}

/**
 * Generate all coupon payment dates from settlement to maturity
 */
function getCouponDates(settlementDate, maturityDate, frequency = 2) {
    const couponDates = [];
    const monthsBetween = 12 / frequency;
    
    let currentDate = new Date(maturityDate);
    
    while (currentDate > settlementDate) {
        couponDates.unshift(new Date(currentDate));
        currentDate = addMonths(currentDate, -monthsBetween);
    }
    
    return couponDates;
}

/**
 * Calculate accrued interest using ACT/ACT convention
 */
function calculateAccruedInterest(settlementDate, lastCouponDate, nextCouponDate, 
                                 couponRate, faceValue = 100.0, frequency = 2) {
    const daysAccrued = daysBetween(lastCouponDate, settlementDate);
    const daysInPeriod = daysBetween(lastCouponDate, nextCouponDate);
    
    if (daysInPeriod === 0) return 0;
    
    const couponPayment = (couponRate * faceValue) / frequency;
    const accrued = couponPayment * (daysAccrued / daysInPeriod);
    
    return accrued;
}

/**
 * Calculate bond price given yield to maturity
 * Returns [cleanPrice, dirtyPrice]
 */
function bondPriceFromYield(ytm, settlementDate, maturityDate, couponRate, 
                           frequency = 2, faceValue = 100.0) {
    const couponDates = getCouponDates(settlementDate, maturityDate, frequency);
    
    // Handle zero-coupon bonds
    if (couponDates.length === 0) {
        const yearsToMaturity = daysBetween(settlementDate, maturityDate) / 365.25;
        const cleanPrice = faceValue / Math.pow(1 + ytm, yearsToMaturity);
        return [cleanPrice, cleanPrice];
    }
    
    const couponPayment = (couponRate * faceValue) / frequency;
    const yPerPeriod = ytm / frequency;
    
    let presentValue = 0.0;
    
    for (let i = 0; i < couponDates.length; i++) {
        const couponDate = couponDates[i];
        const yearsToCF = daysBetween(settlementDate, couponDate) / 365.25;
        const periodsToCF = yearsToCF * frequency;
        
        const discountFactor = Math.pow(1 + yPerPeriod, -periodsToCF);
        
        // Add coupon payment
        presentValue += couponPayment * discountFactor;
        
        // Add principal on last payment
        if (i === couponDates.length - 1) {
            presentValue += faceValue * discountFactor;
        }
    }
    
    const cleanPrice = presentValue;
    
    // Calculate accrued interest
    let lastCouponDate = null;
    let nextCouponDate = null;
    
    for (const couponDate of couponDates) {
        if (couponDate > settlementDate) {
            nextCouponDate = couponDate;
            break;
        }
        lastCouponDate = couponDate;
    }
    
    // If no last coupon found, calculate one period before the first coupon
    if (!lastCouponDate) {
        nextCouponDate = couponDates[0];
        lastCouponDate = addMonths(nextCouponDate, -(12 / frequency));
    }
    
    // If no next coupon found, use the last coupon date
    if (!nextCouponDate) {
        nextCouponDate = couponDates[couponDates.length - 1];
    }
    
    let accrued = 0;
    if (lastCouponDate && nextCouponDate && lastCouponDate < nextCouponDate) {
        accrued = calculateAccruedInterest(
            settlementDate, lastCouponDate, nextCouponDate,
            couponRate, faceValue, frequency
        );
    }
    
    const dirtyPrice = cleanPrice + accrued;
    
    return [cleanPrice, dirtyPrice];
}

/**
 * Calculate yield to maturity from bond price using Newton-Raphson method
 * 
 * @param {number} price - Bond price (clean or dirty based on priceType)
 * @param {Date} settlementDate - Settlement date
 * @param {Date} maturityDate - Maturity date
 * @param {number} couponRate - Annual coupon rate (as decimal, e.g., 0.045 for 4.5%)
 * @param {number} frequency - Coupon frequency per year (2 = semi-annual)
 * @param {number} faceValue - Face value of bond (default 100)
 * @param {string} priceType - 'clean' or 'dirty' to specify price type
 * @returns {number} Yield to maturity (as decimal)
 */
function yieldFromPrice(price, settlementDate, maturityDate, couponRate,
                       frequency = 2, faceValue = 100.0, priceType = 'clean') {
    
    // Objective function: find ytm where calculated_price - market_price = 0
    function objective(ytm) {
        const [cleanCalc, dirtyCalc] = bondPriceFromYield(
            ytm, settlementDate, maturityDate, couponRate, frequency, faceValue
        );
        const calcPrice = priceType === 'clean' ? cleanCalc : dirtyCalc;
        return calcPrice - price;
    }
    
    // Numerical derivative
    function derivative(ytm, h = 1e-6) {
        return (objective(ytm + h) - objective(ytm - h)) / (2 * h);
    }
    
    // Initial guess based on current yield approximation
    const yearsToMaturity = daysBetween(settlementDate, maturityDate) / 365.25;
    
    if (yearsToMaturity <= 0) {
        throw new Error("Maturity date must be after settlement date");
    }
    
    let initialGuess;
    if (price > 0) {
        initialGuess = couponRate + (faceValue - price) / (price * yearsToMaturity);
    } else {
        initialGuess = 0.05;
    }
    
    // Bound the initial guess
    initialGuess = Math.max(Math.min(initialGuess, 0.30), -0.02);
    
    // Newton-Raphson iteration
    let ytm = initialGuess;
    const maxIterations = 100;
    const tolerance = 1e-8;
    
    for (let i = 0; i < maxIterations; i++) {
        const f = objective(ytm);
        
        if (Math.abs(f) < tolerance) {
            return ytm;
        }
        
        const df = derivative(ytm);
        
        if (Math.abs(df) < 1e-10) {
            // Derivative too small, switch to bisection
            return bisectionMethod(objective, -0.02, 0.30, tolerance);
        }
        
        const ytmNew = ytm - f / df;
        
        // Bound the update
        if (ytmNew < -0.05 || ytmNew > 0.50) {
            // Out of bounds, switch to bisection
            return bisectionMethod(objective, -0.02, 0.30, tolerance);
        }
        
        if (Math.abs(ytmNew - ytm) < tolerance) {
            return ytmNew;
        }
        
        ytm = ytmNew;
    }
    
    // If Newton-Raphson didn't converge, use bisection
    return bisectionMethod(objective, -0.02, 0.30, tolerance);
}

/**
 * Bisection method fallback for robust root finding
 */
function bisectionMethod(func, a, b, tolerance = 1e-8, maxIterations = 100) {
    let fa = func(a);
    let fb = func(b);
    
    if (fa * fb > 0) {
        // Try wider bounds
        a = -0.05;
        b = 0.50;
        fa = func(a);
        fb = func(b);
        
        if (fa * fb > 0) {
            throw new Error("Bisection method failed: no root in interval");
        }
    }
    
    for (let i = 0; i < maxIterations; i++) {
        const c = (a + b) / 2;
        const fc = func(c);
        
        if (Math.abs(fc) < tolerance || Math.abs(b - a) < tolerance) {
            return c;
        }
        
        if (fa * fc < 0) {
            b = c;
            fb = fc;
        } else {
            a = c;
            fa = fc;
        }
    }
    
    return (a + b) / 2;
}

/**
 * Calculate yield for a security from database format
 * This integrates with your existing fetchMarketData function
 * 
 * @param {Object} security - Security object from database
 * @param {Date} settlementDate - Settlement date (defaults to today)
 * @returns {number} Yield to maturity as percentage (e.g., 4.5 for 4.5%)
 */
export function calculateYieldForSecurity(security, settlementDate = null) {
    if (!settlementDate) {
        settlementDate = new Date();
    }
    
    // Parse maturity date
    const maturityDate = new Date(security.maturityDate);
    
    // Convert percentage inputs to decimals
    const couponRate = parseFloat(security.couponRate) / 100.0;
    const price = parseFloat(security.price);
    const frequency = security.frequency || 2; // Default to semi-annual
    
    // Calculate yield
    const ytm = yieldFromPrice(
        price,
        settlementDate,
        maturityDate,
        couponRate,
        frequency,
        100.0,
        'clean'
    );
    
    // Return as percentage
    return ytm * 100.0;
}

/**
 * Enhanced fetchMarketData that calculates yields from prices
 * This replaces your original fetchMarketData function
 */
export async function fetchMarketDataWithYields(env) {
    const { results } = await env.DB.prepare(
        `SELECT maturityDate, couponRate, price, frequency 
         FROM securities 
         WHERE maturityDate IS NOT NULL 
         AND couponRate IS NOT NULL 
         AND price IS NOT NULL`
    ).all();

    if (!results || results.length === 0) {
        throw new Error("No security data available to build yield curve.");
    }

    const today = new Date();
    const marketData = [];

    for (const sec of results) {
        const maturity = new Date(sec.maturityDate);
        if (isNaN(maturity.getTime())) continue;

        // Calculate time to maturity in years
        const diffTime = maturity - today;
        const term = diffTime / (1000 * 60 * 60 * 24 * 365.25);

        // Filter out expired or extremely short-term bonds
        if (term <= 0.001) continue;

        try {
            // Calculate actual yield from price
            const yieldVal = calculateYieldForSecurity(sec, today);
            
            if (isNaN(yieldVal)) continue;

            marketData.push({ term: term, yield: yieldVal });
        } catch (error) {
            console.warn(`Failed to calculate yield for security: ${error.message}`);
            continue;
        }
    }

    // Sort by term
    marketData.sort((a, b) => a.term - b.term);
    return marketData;
}

// Export all functions for testing and use
export {
    yieldFromPrice,
    bondPriceFromYield,
    calculateAccruedInterest,
    getCouponDates,
    daysBetween
};
