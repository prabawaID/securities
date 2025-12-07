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


function calculateTerm(referenceDate, targetDate) {
    const diffTime = targetDate - referenceDate;
    return diffTime / (1000 * 60 * 60 * 24 * 365.25);
}

/**
 * Nelson-Siegel-Svensson curve function
 */
function nssCurve(tau, theta0, theta1, theta2, theta3, lambda1, lambda2) {
    // Safeguard: prevent division by zero
    // If tau is 0 or very close to 0, use a small positive value
    if (tau < 0.0001) {
        tau = 0.0001;
    }
    
    // Also ensure lambdas are not zero
    if (lambda1 <= 0) lambda1 = 0.1;
    if (lambda2 <= 0) lambda2 = 0.1;

    const term1 = theta0;
    const term2 = theta1 * ((1 - Math.exp(-tau/lambda1)) / (tau/lambda1));
    const term3 = theta2 * (((1 - Math.exp(-tau/lambda1)) / (tau/lambda1)) - Math.exp(-tau/lambda1));
    const term4 = theta3 * (((1 - Math.exp(-tau/lambda2)) / (tau/lambda2)) - Math.exp(-tau/lambda2));
    
    return term1 + term2 + term3 + term4;
}

/**
 * Calculates the Sum of Squared Errors (SSE) between model and market yields.
 */
const calculateNSSErrors = (values) => {
    return (X) => {
        const theta0 = X[0];
        const theta1 = X[1];
        const theta2 = X[2];
        const theta3 = X[3];
        const lambda1 = X[4];
        const lambda2 = X[5];

        // Constraint: Lambdas must be positive to ensure convergence
        if (lambda1 <= 0.05 || lambda2 <= 0.05) {
            return 1e9; // Penalty for invalid parameters
        }

        let runningError = 0;

        for (let i = 0; i < values.length; i++) {
            const t = values[i].term;
            const marketYield = values[i].yield / 100;

            const modelYield = nssCurve(
                t,
                theta0,
                theta1,
                theta2,
                theta3,
                lambda1,
                lambda2);

            runningError += Math.pow(marketYield - modelYield, 2);
        }

        return runningError;
    };
};

/**
 * Fetches security data from the DB and transforms it into yield curve terms.
 * @param {Object} env - The worker environment containing the DB binding.
 * @returns {Promise<Array>} - Array of { term: number, yield: number }
 */
async function fetchMarketData(env) {
    // 1. Fetch all necessary columns, including pricing and dates for accrual calc
    const { results } = await env.DB.prepare(`
        SELECT 
            p.cusip, 
            p.security_type, 
            s.issueDate, 
            s.maturityDate,
            s.interestRate,
            s.interestPaymentFrequency,
            s.firstInterestPaymentDate,
            s.datedDate,
            p.end_of_day as cleanPrice
        FROM securities s
        JOIN prices p ON s.cusip = p.cusip
        ORDER BY s.issueDate DESC
    `).all();

    if (!results || results.length === 0) {
        throw new Error("No security data available.");
    }

    const today = new Date();
    const issuances = [];

    for (const sec of results) {
        const issueDate = new Date(sec.issueDate);
        const maturity = new Date(sec.maturityDate);
        
        if (isNaN(maturity.getTime()) || isNaN(issueDate.getTime())) continue;

        const cashflows = [];
        const faceValue = 100;
        let accruedInterest = 0;
        let cleanPrice = parseFloat(sec.cleanPrice) || 0;

        // --- Logic to Determine Cashflows and Accrued Interest ---

        // A. Bills (Zero Coupon)
        // Recognized by 'None' frequency or null interest rate
        if (sec.interestPaymentFrequency === 'None' || sec.interestRate == null) {
            cashflows.push({
                date: maturity,
                term: calculateTerm(today, maturity),
                amount: faceValue,
                type: 'Principal'
            });
            // Bills have no accrued interest; Dirty Price = Clean Price
            accruedInterest = 0;
        } 
        
        // B. Notes/Bonds (Coupon Bearing)
        else {
            const couponRateAnnual = parseFloat(sec.interestRate) / 100;
            
            // Map frequency string to number per year
            let frequency = 2; // Default to Semi-Annual
            if (sec.interestPaymentFrequency === 'Annual') frequency = 1;
            else if (sec.interestPaymentFrequency === 'Quarterly') frequency = 4;
            else if (sec.interestPaymentFrequency === 'Monthly') frequency = 12;

            const couponAmount = (couponRateAnnual * faceValue) / frequency;
            
            // 1. Generate Cashflow Schedule
            let nextPaymentDate = new Date(sec.firstInterestPaymentDate);
            
            // Fallback if first payment date is missing
            if (isNaN(nextPaymentDate.getTime())) {
                nextPaymentDate = new Date(issueDate);
                nextPaymentDate.setMonth(nextPaymentDate.getMonth() + (12 / frequency));
            }

            // Loop to generate coupons
            while (nextPaymentDate < maturity) {
                cashflows.push({
                    date: new Date(nextPaymentDate),
                    term: calculateTerm(today, nextPaymentDate),
                    amount: couponAmount,
                    type: 'Coupon'
                });
                nextPaymentDate.setMonth(nextPaymentDate.getMonth() + (12 / frequency));
            }

            // Final Principal + Coupon
            cashflows.push({
                date: maturity,
                term: calculateTerm(today, maturity),
                amount: faceValue + couponAmount,
                type: 'Principal + Coupon'
            });

            // 2. Calculate Accrued Interest
            // We need the start and end of the *current* coupon period relative to 'today'
            let datedDate = new Date(sec.datedDate);
            if (isNaN(datedDate.getTime())) datedDate = issueDate;

            let periodStart, periodEnd;

            // Check if we are in the very first period (Long/Short first coupon)
            const firstPayment = new Date(sec.firstInterestPaymentDate);
            
            if (today < firstPayment && !isNaN(firstPayment.getTime())) {
                periodStart = datedDate;
                periodEnd = firstPayment;
            } else {
                // Determine standard period windows looking backwards from maturity or forwards from first payment
                // Simple approach: Walk forward from first payment until we pass today
                let pointer = new Date(firstPayment);
                if (isNaN(pointer.getTime())) pointer = new Date(datedDate);
                
                while (pointer <= today) {
                    pointer.setMonth(pointer.getMonth() + (12 / frequency));
                }
                periodEnd = new Date(pointer);
                periodStart = new Date(pointer);
                periodStart.setMonth(periodStart.getMonth() - (12 / frequency));
            }

            // Calculate ratio
            const daysInPeriod = (periodEnd - periodStart) / (1000 * 60 * 60 * 24);
            const daysAccrued = (today - periodStart) / (1000 * 60 * 60 * 24);

            // Guard against division by zero or future dates logic errors
            if (daysInPeriod > 0 && daysAccrued > 0) {
                accruedInterest = couponAmount * (daysAccrued / daysInPeriod);
            }
        }

        const dirtyPrice = cleanPrice + accruedInterest;

        issuances.push({
            cusip: sec.cusip,
            securityType: sec.security_type,
            issueDate: issueDate,
            maturityDate: maturity,
            term: calculateTerm(today, maturity), // Term to maturity
            cleanPrice: cleanPrice,
            accruedInterest: accruedInterest,
            dirtyPrice: dirtyPrice,
            yield: dirtyPrice,
            cashflows: cashflows
        });
    }

    // Sort by term
    issuances.sort((a, b) => a.term - b.term);

    return issuances;
}

/**
 * Calculates the initial NSS parameters by fitting the curve to DB data.
 * @param {Object} env - Worker environment.
 * @returns {Promise<Object>} - The fitted parameters.
 */
export async function getNSSParameters(env) {
    const values = await fetchMarketData(env);

    const calculateErrors = calculateNSSErrors(values);

    const result = nelderMead(calculateErrors, [
        THETA0_SEARCH_START,
        THETA1_SEARCH_START,
        THETA2_SEARCH_START,
        THETA3_SEARCH_START,
        LAMBDA1_SEARCH_START,
        LAMBDA2_SEARCH_START,
    ]);

    return {
        theta0: result.x[0],
        theta1: result.x[1],
        theta2: result.x[2],
        theta3: result.x[3],
        lambda1: result.x[4],
        lambda2: result.x[5],
        squaredError: result.fx,
        iterations: result.iterations,
        dataPoints: values.length
    };
}

/**
 * Calculates the annualized spot rate for a specific time T.
 * Performs optimization first to ensure parameters are up to date with DB.
 * @param {number} t - Time in years.
 * @param {Object} env - Worker environment.
 * @returns {Promise<Object>} - The calculated spot rate and parameters used.
 */
export async function calculateSpotRate(t, env) {
    if (t < 0 || t > 30) {
        throw new Error("Time T must be between 0 and 30 years.");
    }

    // Get fresh parameters
    const params = await getNSSParameters(env);

    const yieldDecimal = nssCurve(
        t,
        params.theta0,
        params.theta1,
        params.theta2,
        params.theta3,
        params.lambda1,
        params.lambda2);

    // Validate the rate to catch any calculation errors
    if (!isFinite(yieldDecimal) || isNaN(yieldDecimal)) {
        console.warn(`Invalid yield at maturity ${t}: ${yieldDecimal}`);
    }

    const ratePercent = yieldDecimal * 100;

    return {
        t: t,
        spotRate: ratePercent,
        parameters: params
    };
}

export async function getYieldCurve(numPoints = 100, env) {
    if (numPoints < 0 || numPoints > 100) {
        throw new Error("Number of points must be between 0 and 100");
    }

    const marketData = await fetchMarketData(env);

    // Get fresh parameters
    const params = await getNSSParameters(env);

    // Generate curve points
    const minMaturity = 0.01;
    const maxMaturity = Math.max(...marketData.map(d => d.term));
    const step = maxMaturity / (numPoints - 1);
    
    const curve = [];
    for (let i = 0; i < numPoints; i++) {
        const t = minMaturity + (i * step);

        const yieldDecimal = nssCurve(
            t,
            params.theta0,
            params.theta1,
            params.theta2,
            params.theta3,
            params.lambda1,
            params.lambda2);

        // Validate the rate to catch any calculation errors
        if (!isFinite(yieldDecimal) || isNaN(yieldDecimal)) {
            console.warn(`Invalid yield at maturity ${t}: ${yieldDecimal}`);
            // Skip invalid points rather than including nulls
            continue;
        }
 
        const ratePercent = yieldDecimal * 100;

        curve.push({
            maturity: t,
            rate: ratePercent
        });
    }
    
    return {
        curve: curve,
        parameters: params
    };
}