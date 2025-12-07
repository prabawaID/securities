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
export async function fetchMarketData(env) {
    // 1. Fetch Raw Data
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

    // 2. Process Each Security
    for (const sec of results) {
        const issueDate = new Date(sec.issueDate);
        const maturity = new Date(sec.maturityDate);
        
        if (isNaN(maturity.getTime()) || isNaN(issueDate.getTime())) continue;

        // A. Generate Cashflows & Pricing
        const { cashflows, dirtyPrice } = generateCashflowsAndPrice(sec, today);
        const termToMaturity = calculateTerm(today, maturity);

        // B. Calculate Yield to Maturity
        let ytm = null;
        if (termToMaturity > 0.0) {
            ytm = calculateYTM(cashflows, dirtyPrice);
        }

        // Return exactly the fields requested
        if (ytm !== null) {
            marketData.push({
                cusip: sec.cusip,
                securityType: sec.security_type,
                term: termToMaturity,
                yield: ytm * 100 // return in percentage, convert it from decimal
            });
        }
    }

    return marketData;
}

function calculateYTM(cashflows, currentPrice) {
    if (currentPrice <= 0) return 0;
    
    // Objective: Minimize squared difference between PV and Price
    const objective = (params) => {
        const y = params[0]; 
        let pv = 0;
        for (const cf of cashflows) {
            // Continuous compounding for solver speed: PV = CF * e^(-yt)
            pv += cf.amount * Math.exp(-y * cf.term);
        }
        return Math.pow(pv - currentPrice, 2);
    };

    // Call imported Nelder-Mead
    const result = nelderMead(objective, [0.05], { 
        maxIterations: 100,
        minErrorDelta: 1e-6 
    });
    
    return result.x[0];
}

function generateCashflowsAndPrice(sec, today) {
    const faceValue = 100;
    const cleanPrice = parseFloat(sec.cleanPrice) || 0;
    const maturity = new Date(sec.maturityDate);
    const cashflows = [];
    let accruedInterest = 0;

    // Bill / Zero Coupon
    if (sec.interestPaymentFrequency === 'None' || sec.interestRate == null) {
        cashflows.push({
            date: maturity,
            term: calculateTerm(today, maturity),
            amount: faceValue,
            type: 'Principal'
        });
    } 
    // Note / Bond
    else {
        const couponRateAnnual = parseFloat(sec.interestRate) / 100;
        let frequency = 2; // Default Semi-Annual
        if (sec.interestPaymentFrequency === 'Annual') frequency = 1;
        else if (sec.interestPaymentFrequency === 'Quarterly') frequency = 4;
        else if (sec.interestPaymentFrequency === 'Monthly') frequency = 12;

        const couponAmount = (couponRateAnnual * faceValue) / frequency;
        
        // Generate Stream
        let nextPaymentDate = new Date(sec.firstInterestPaymentDate);
        if (isNaN(nextPaymentDate.getTime())) {
            nextPaymentDate = new Date(new Date(sec.issueDate).setMonth(new Date(sec.issueDate).getMonth() + (12/frequency)));
        }

        while (nextPaymentDate < maturity) {
            if (nextPaymentDate > today) {
                cashflows.push({
                    date: new Date(nextPaymentDate),
                    term: calculateTerm(today, nextPaymentDate),
                    amount: couponAmount,
                    type: 'Coupon'
                });
            }
            nextPaymentDate.setMonth(nextPaymentDate.getMonth() + (12 / frequency));
        }

        cashflows.push({
            date: maturity,
            term: calculateTerm(today, maturity),
            amount: faceValue + couponAmount,
            type: 'Principal + Coupon'
        });

        // Accrued Interest (Simplified Actual/Actual window)
        let periodStart = new Date(cashflows[0] ? cashflows[0].date : maturity);
        while(periodStart > today) periodStart.setMonth(periodStart.getMonth() - (12/frequency));
        const periodEnd = new Date(periodStart);
        periodEnd.setMonth(periodEnd.getMonth() + (12/frequency));

        const daysInPeriod = (periodEnd - periodStart) / (1000 * 60 * 60 * 24);
        const daysAccrued = (today - periodStart) / (1000 * 60 * 60 * 24);
        if (daysInPeriod > 0 && daysAccrued > 0) accruedInterest = couponAmount * (daysAccrued / daysInPeriod);
    }

    return { cashflows, dirtyPrice: cleanPrice + accruedInterest };
}

function calculateTerm(referenceDate, targetDate) {
    return (targetDate - referenceDate) / (1000 * 60 * 60 * 24 * 365.25);
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
    const minMaturity = 0.5; // previously 0.01
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