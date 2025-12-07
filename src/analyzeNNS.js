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
 * Calculates SSE between Market Price and Model Price (Discounted Cashflows)
 */
const calculateNSSErrors = (bonds) => {
    return (X) => {
        // Unpack parameters
        const [theta0, theta1, theta2, theta3, lambda1, lambda2] = X;

        // Constraints: Lambdas must be positive
        if (lambda1 <= 0.1 || lambda2 <= 0.1) return 1e9;

        let totalError = 0;

        // Loop through every bond in the market data
        for (const bond of bonds) {
            let modelPrice = 0;

            // Discount every cashflow using the NSS Spot Rate for that specific time t
            for (const cf of bond.cashflows) {
                const t = cf.term;
                
                // Get Spot Rate (r) for this specific cashflow timing
                // Note: nssCurve returns decimal rate (e.g. 0.045)
                const r = nssCurve(t, theta0, theta1, theta2, theta3, lambda1, lambda2);

                // Continuous Compounding Discounting: PV = CF * e^(-r*t)
                modelPrice += cf.amount * Math.exp(-r * t);
            }

            // Optimization Goal: Minimize Squared Price Error
            // Weighting: You might optionally weight by duration, but raw price error is standard
            totalError += Math.pow(bond.price - modelPrice, 2);
        }

        return totalError;
    };
};

/**
 * Fetches security data from the DB and transforms it into yield curve terms.
 * @param {Object} env - The worker environment containing the DB binding.
 * @returns {Promise<Array>} - Array of { term: number, yield: number }
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

        // Generate Cashflows & Pricing
        const { cashflows, dirtyPrice } = generateCashflowsAndPrice(sec, today);
        
        // Only include bonds that are currently active (have future cashflows)
        if (cashflows.length > 0) {
            marketData.push({
                cusip: sec.cusip,
                price: dirtyPrice, // We fit to the Dirty Price (Clean + Accrued)
                cashflows: cashflows // Array of { term, amount }
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
export async function calculateSpotRate(t, params) {
    if (t < 0 || t > 30) throw new Error("Time T must be between 0 and 30 years.");

    // Calculate Spot Rate based on given NSS parameters
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
        spotRate: spotDecimal * 100, // Convert to Percentage
        type: "Zero-Coupon Spot Rate",
        parameters: params
    };
}

export async function getYieldCurve(numPoints = 100, params) {
    if (numPoints < 0 || numPoints > 100) {
        throw new Error("Number of points must be between 0 and 100");
    }

    // 1. fetch data again just for max maturity bounds
    const bonds = await fetchMarketData(env);

    // 2. Define Curve Bounds
    const minMaturity = 0.5;
    // Find the longest bond to define the curve end
    let maxMaturity = 30; 
    if (bonds.length > 0) {
        // Flatten cashflows to find max term
        const allTerms = bonds.flatMap(b => b.cashflows.map(c => c.term));
        maxMaturity = Math.max(...allTerms);
    }
    
    const step = maxMaturity / (numPoints - 1);
    const curve = [];

    // 3. Generate Points using the fitted Spot parameters
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
            rate: spotDecimal * 100 // Return as %
        });
    }
    
    return {
        curveType: "Spot / Zero-Coupon",
        curve: curve,
        parameters: params
    };
}