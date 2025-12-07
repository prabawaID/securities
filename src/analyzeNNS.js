import { addMonthsSafe, subtractMonthsSafe, daysBetween, calculateTerm } from './dateHelper.js';
import { nelderMead } from './nelderMead.js';

/**
 * Starting guesses for the NSS parameters
 */
const THETA0_SEARCH_START =  0.04;  //  4% long-term rate
const THETA1_SEARCH_START = -0.01;  // -1% short-term component
const THETA2_SEARCH_START = -0.01;  // -1% medium-term hump
const THETA3_SEARCH_START =  0.01;  //  1% second hump
const LAMBDA1_SEARCH_START = 1.50;
const LAMBDA2_SEARCH_START = 3.00;

/**
 * Nelson-Siegel-Svensson curve function
 */
function nssCurve(tau, theta0, theta1, theta2, theta3, lambda1, lambda2) {
    // Safeguard: prevent division by zero
    if (tau < 0.0001) {
        tau = 0.0001;
    }
    
    // Also ensure lambdas are not zero
    if (lambda1 <= 0.1) lambda1 = 0.11;
    if (lambda2 <= 0.1) lambda2 = 0.11;

    const term1 = theta0;
    const term2 = theta1 * ((1 - Math.exp(-tau/lambda1)) / (tau/lambda1));
    const term3 = theta2 * (((1 - Math.exp(-tau/lambda1)) / (tau/lambda1)) - Math.exp(-tau/lambda1));
    const term4 = theta3 * (((1 - Math.exp(-tau/lambda2)) / (tau/lambda2)) - Math.exp(-tau/lambda2));
    
    return term1 + term2 + term3 + term4;
}

/**
 * Calculates SSE between Market Price and Model Price (Discounted Cashflows)
 */
const calculateNSSErrors = (bonds) => {
    return (X) => {
        const [theta0, theta1, theta2, theta3, lambda1, lambda2] = X;

        // Constraints: Lambdas must be positive
        if (lambda1 <= 0.1 || lambda2 <= 0.1) return 1e9;

        let totalError = 0;

        for (const bond of bonds) {
            let modelPrice = 0;

            for (const cf of bond.cashflows) {
                const t = cf.term;
                const r = nssCurve(t, theta0, theta1, theta2, theta3, lambda1, lambda2);
                modelPrice += cf.amount * Math.exp(-r * t);
            }

            totalError += Math.pow(bond.price - modelPrice, 2);
        }

        return totalError;
    };
};

// ============================================================================
// CASHFLOW GENERATION FUNCTIONS
// ============================================================================

/**
 * Generates cashflows for a zero-coupon security (T-Bills)
 * @param {Date} maturity
 * @param {Date} today
 * @param {number} faceValue
 * @returns {Array} - Array of cashflow objects
 */
function generateZeroCouponCashflows(maturity, today, faceValue) {
    return [{
        date: maturity,
        term: calculateTerm(today, maturity),
        amount: faceValue,
        type: 'Principal'
    }];
}

/**
 * Determines the first coupon payment date
 * @param {string|null} firstPaymentDateStr - Database field (could be null)
 * @param {Date} issueDate
 * @param {number} frequency - Annual payment frequency (1, 2, 4, 12)
 * @returns {Date} - First payment date
 */
function determineFirstPaymentDate(firstPaymentDateStr, issueDate, frequency) {
    let firstPaymentDate = new Date(firstPaymentDateStr);
    
    if (isNaN(firstPaymentDate.getTime())) {
        // Fallback: estimate first payment as one period after issue
        const issueDay = issueDate.getDate();
        const monthsToAdd = 12 / frequency;
        firstPaymentDate = addMonthsSafe(issueDate, monthsToAdd, issueDay);
    }
    
    return firstPaymentDate;
}

/**
 * Generates all future coupon cashflows and final principal payment
 * @param {Object} params - Parameters object
 * @returns {Array} - Array of cashflow objects
 */
function generateCouponCashflows({
    firstPaymentDate,
    maturity,
    today,
    couponAmount,
    faceValue,
    frequency
}) {
    const cashflows = [];
    const paymentDay = firstPaymentDate.getDate();
    const monthsToAdd = 12 / frequency;
    let nextPaymentDate = new Date(firstPaymentDate);

    // Generate all coupon payments before maturity
    while (nextPaymentDate < maturity) {
        if (nextPaymentDate > today) {
            cashflows.push({
                date: new Date(nextPaymentDate),
                term: calculateTerm(today, nextPaymentDate),
                amount: couponAmount,
                type: 'Coupon'
            });
        }
        
        nextPaymentDate = addMonthsSafe(nextPaymentDate, monthsToAdd, paymentDay);
    }

    // Add final payment (principal + final coupon)
    cashflows.push({
        date: maturity,
        term: calculateTerm(today, maturity),
        amount: faceValue + couponAmount,
        type: 'Principal + Coupon'
    });

    return cashflows;
}

// ============================================================================
// ACCRUED INTEREST CALCULATION
// ============================================================================

/**
 * Finds the last coupon payment date before today
 * @param {Date} maturity
 * @param {Date} today
 * @param {Date} issueDate
 * @param {number} frequency
 * @param {number} paymentDay - Day of month for coupon payments
 * @returns {Date} - Last coupon payment date (period start)
 */
function findLastCouponDate(maturity, today, issueDate, frequency, paymentDay) {
    const monthsToSubtract = 12 / frequency;
    let periodStart = new Date(maturity);

    // Work backward from maturity to find the period containing today
    while (periodStart > today) {
        const newPeriodStart = subtractMonthsSafe(periodStart, monthsToSubtract, paymentDay);
        
        // Don't go before issue date
        if (newPeriodStart < issueDate) {
            return issueDate;
        }
        
        periodStart = newPeriodStart;
    }

    return periodStart;
}

/**
 * Calculates accrued interest for a coupon-bearing security
 * @param {Object} params - Parameters object
 * @returns {number} - Accrued interest amount
 */
function calculateAccruedInterest({
    maturity,
    today,
    issueDate,
    frequency,
    couponAmount,
    paymentDay
}) {
    const periodStart = findLastCouponDate(maturity, today, issueDate, frequency, paymentDay);
    
    // Calculate period end (next coupon date)
    const monthsToAdd = 12 / frequency;
    const periodEnd = addMonthsSafe(periodStart, monthsToAdd, paymentDay);

    // Calculate accrued interest using Actual/Actual convention
    const daysInPeriod = daysBetween(periodStart, periodEnd);
    const daysAccrued = daysBetween(periodStart, today);

    // Only calculate accrued if we're in a valid period
    if (daysInPeriod > 0 && daysAccrued >= 0 && daysAccrued <= daysInPeriod) {
        return couponAmount * (daysAccrued / daysInPeriod);
    }

    return 0;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Generates cashflows and calculates dirty price for a security
 * @param {Object} sec - Security data from database
 * @param {Date} today - Reference date
 * @returns {Object} - { cashflows, dirtyPrice }
 */
function generateCashflowsAndPrice(sec, today) {
    const faceValue = 100;
    const cleanPrice = parseFloat(sec.cleanPrice) || 0;
    const maturity = new Date(sec.maturityDate);
    const issueDate = new Date(sec.issueDate);
    
    // Zero-coupon securities (T-Bills)
    if (sec.interestPaymentFrequency === 'None' || sec.interestRate == null) {
        return {
            cashflows: generateZeroCouponCashflows(maturity, today, faceValue),
            dirtyPrice: cleanPrice  // No accrued interest for zero-coupon
        };
    }

    // Coupon-bearing securities (Notes & Bonds)
    const couponRateAnnual = parseFloat(sec.interestRate) / 100;
    
    // Determine payment frequency
    let frequency = 2; // Default Semi-Annual
    if (sec.interestPaymentFrequency === 'Annual') frequency = 1;
    else if (sec.interestPaymentFrequency === 'Quarterly') frequency = 4;
    else if (sec.interestPaymentFrequency === 'Monthly') frequency = 12;

    const couponAmount = (couponRateAnnual * faceValue) / frequency;
    
    // Determine first payment date
    const firstPaymentDate = determineFirstPaymentDate(
        sec.firstInterestPaymentDate,
        issueDate,
        frequency
    );
    
    const paymentDay = firstPaymentDate.getDate();

    // Generate all cashflows
    const cashflows = generateCouponCashflows({
        firstPaymentDate,
        maturity,
        today,
        couponAmount,
        faceValue,
        frequency
    });

    // Calculate accrued interest
    const accruedInterest = calculateAccruedInterest({
        maturity,
        today,
        issueDate,
        frequency,
        couponAmount,
        paymentDay
    });

    return {
        cashflows,
        dirtyPrice: cleanPrice + accruedInterest
    };
}

/**
 * Fetches security data from the DB and transforms it into yield curve terms.
 * @param {Object} env - The worker environment containing the DB binding.
 * @returns {Promise<Array>} - Array of bond data with cashflows and prices
 */
export async function fetchMarketData(env) {
    const { results } = await env.DB.prepare(`
        SELECT 
            p.cusip, p.security_type, s.issueDate, s.maturityDate,
            s.interestRate, s.interestPaymentFrequency,
            s.firstInterestPaymentDate, p.end_of_day as cleanPrice
        FROM securities s
        JOIN prices p ON s.cusip = p.cusip
        ORDER BY s.issueDate DESC
    `).all();

    if (!results || results.length === 0) throw new Error("No security data available.");

    const today = new Date();
    const marketData = [];

    for (const sec of results) {
        const issueDate = new Date(sec.issueDate);
        const maturity = new Date(sec.maturityDate);
        
        // Skip invalid dates
        if (isNaN(maturity.getTime()) || isNaN(issueDate.getTime())) continue;

        const { cashflows, dirtyPrice } = generateCashflowsAndPrice(sec, today);
        
        // Only include bonds that are currently active (have future cashflows)
        if (cashflows.length > 0) {
            marketData.push({
                cusip: sec.cusip,
                price: dirtyPrice,
                cashflows: cashflows
            });
        }
    }

    return marketData;
}

// ============================================================================
// NSS PARAMETER FITTING
// ============================================================================

/**
 * Calculates the initial NSS parameters by fitting the curve to DB data.
 * @param {Object} env - Worker environment.
 * @returns {Promise<Object>} - The fitted parameters.
 */
export async function getNSSParameters(env) {
    const values = await fetchMarketData(env);

    // Calculate max maturity for yield curve generation
    const allTerms = values.flatMap(b => b.cashflows.map(c => c.term));
    const maxMaturity = allTerms.length > 0 ? Math.max(...allTerms) : 30;

    const calculateErrors = calculateNSSErrors(values);

    const result = nelderMead(calculateErrors, [
        THETA0_SEARCH_START,
        THETA1_SEARCH_START,
        THETA2_SEARCH_START,
        THETA3_SEARCH_START,
        LAMBDA1_SEARCH_START,
        LAMBDA2_SEARCH_START,
    ], { 
        maxIterations: 10000,
        minErrorDelta: 1e-6 
    });

    return {
        theta0: result.x[0],
        theta1: result.x[1],
        theta2: result.x[2],
        theta3: result.x[3],
        lambda1: result.x[4],
        lambda2: result.x[5],
        squaredError: result.fx,
        iterations: result.iterations,
        dataPoints: values.length,
        maxMaturity: maxMaturity
    };
}

/**
 * Calculates the annualized spot rate for a specific time T.
 * @param {number} t - Time in years.
 * @param {Object} params - NSS parameters
 * @returns {Promise<Object>} - The calculated spot rate
 */
export async function getSpotRate(t, params) {
    if (t < 0 || t > 30) throw new Error("Time T must be between 0 and 30 years.");

    const spotDecimal = nssCurve(
        t,
        params.theta0,
        params.theta1,
        params.theta2,
        params.theta3,
        params.lambda1,
        params.lambda2
    );

    return {
        t: t,
        spotRate: spotDecimal * 100, // Convert to percentage
        type: "Zero-Coupon Spot Rate",
        parameters: params
    };
}

/**
 * Generates yield curve data points
 * @param {number} numPoints - Number of points to generate
 * @param {Object} params - NSS parameters
 * @param {Object} env - Worker environment
 * @returns {Promise<Object>} - Yield curve data
 */
export async function getYieldCurve(numPoints = 100, params, env) {
    if (numPoints < 2 || numPoints > 100) {
        throw new Error("Number of points must be an integer between 2 and 100");
    }

    const minMaturity = 0.01;
    const maxMaturity = params.maxMaturity;
    const step = maxMaturity / (numPoints - 1);
    const curve = [];

    for (let i = 0; i < numPoints; i++) {
        const t = minMaturity + (i * step);

        const spotDecimal = nssCurve(
            t,
            params.theta0,
            params.theta1,
            params.theta2,
            params.theta3,
            params.lambda1,
            params.lambda2
        );

        if (!isFinite(spotDecimal)) continue;

        curve.push({
            maturity: t,
            rate: spotDecimal * 100 // Convert to percentage
        });
    }
    
    return {
        curveType: "Spot / Zero-Coupon",
        curve: curve,
        parameters: params
    };
}
